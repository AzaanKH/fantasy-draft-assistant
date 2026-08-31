"""Import the July 30 FanDuel and DraftKings PDF exports into normalized JSON."""

from __future__ import annotations

import json
import re
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pypdf import PdfReader


REPO_ROOT = Path(__file__).resolve().parent.parent
PDF_DIR = REPO_ROOT / "betting-lines-pdfs"
OUTPUT_FILE = REPO_ROOT / "data" / "sportsbook-snapshot.json"
SEASON = 2026
CAPTURED_AT = "2026-07-30T14:39:00-07:00"

MARKET_LABELS = {
    "Regular Season Passing Yards": "passingYards",
    "Regular Season Passing TDs": "passingTouchdowns",
    "Regular Season Rushing Yards": "rushingYards",
    "Regular Season Rushing TDs": "rushingTouchdowns",
    "Regular Season Receiving Yards": "receivingYards",
    "Regular Season Receiving TDs": "receivingTouchdowns",
    "Regular Season Receptions": "receptions",
}

DRAFTKINGS_OVER_UNDER_FILES = {
    "July 30 Over Under Passing Yards.pdf": "passingYards",
    "July 30 Over Under Passing TDs.pdf": "passingTouchdowns",
    "July 30 O:U Rushing Yards.pdf": "rushingYards",
    "July 30 O:U Rush TDs.pdf": "rushingTouchdowns",
    "July 30 Rec Yards.pdf": "receivingYards",
    "July 30 O:U Rec TDs.pdf": "receivingTouchdowns",
    "July 30 O:U Receptions.pdf": "receptions",
}

DRAFTKINGS_MILESTONE_FILES = {
    "July 30 Player Milestones Pass Yards.pdf": "passingYards",
    "July 30 Milestones Pass TDs.pdf": "passingTouchdowns",
    "July 30 Player Milestones Rush Yards.pdf": "rushingYards",
    "July 30 Player Milestones Rush TDs.pdf": "rushingTouchdowns",
    "July 30 Player Milestones Rec Yards.pdf": "receivingYards",
    "July 30 Player Milestones Rec TDs.pdf": "receivingTouchdowns",
}


def normalize_text(value: str) -> str:
    return (
        unicodedata.normalize("NFKC", value)
        .replace("\u2212", "-")
        .replace("\u2013", "-")
    )


def extract_pages(path: Path) -> list[str]:
    return [normalize_text(page.extract_text() or "") for page in PdfReader(path).pages]


def extract_draftkings_over_under(
    path: Path, market: str, warnings: list[str]
) -> list[dict[str, Any]]:
    text = "\n".join(extract_pages(path))
    headers = [
        match.group(1).strip()
        for match in re.finditer(r"^NFL 2026/27 - (.+)$", text, re.MULTILINE)
        if "Regular Season" not in match.group(1)
    ]
    outcomes = [
        (
            float(over_line),
            int(over_odds),
            float(under_line),
            int(under_odds),
        )
        for over_line, over_odds, under_line, under_odds in re.findall(
            (
                r"^Over ([0-9.]+)\n([+-][0-9]+)\n"
                r"Under ([0-9.]+)\n([+-][0-9]+)$"
            ),
            text,
            re.MULTILINE,
        )
    ]

    if len(headers) < len(outcomes):
        raise ValueError(
            f"{path.name}: found {len(headers)} player headings for "
            f"{len(outcomes)} over/under outcomes"
        )

    if len(headers) > len(outcomes):
        unpriced = headers[len(outcomes) :]
        warnings.append(
            f"DraftKings {market}: unpriced headings omitted: {', '.join(unpriced)}."
        )

    records: list[dict[str, Any]] = []
    for player_name, (over_line, over_odds, under_line, under_odds) in zip(
        headers, outcomes, strict=False
    ):
        if over_line != under_line:
            warnings.append(
                f"{path.name}: {player_name} has mismatched over/under thresholds "
                f"({over_line} and {under_line}); using their midpoint."
            )
        records.append(
            {
                "sportsbook": "draftkings",
                "playerName": player_name,
                "market": market,
                "line": (over_line + under_line) / 2,
                "overOdds": over_odds,
                "underOdds": under_odds,
                "sourceFile": path.name,
            }
        )

    return records


def extract_draftkings_milestones(
    path: Path, market: str
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    current_threshold: int | None = None

    for page_text in extract_pages(path):
        lines = [line.strip() for line in page_text.splitlines()]
        for index, line in enumerate(lines):
            heading = re.fullmatch(
                r"Player to Have ([0-9]+)\+ Regular Season .+", line
            )
            if heading:
                current_threshold = int(heading.group(1))
                continue

            if current_threshold is None or not re.fullmatch(r"[+-][0-9]+", line):
                continue

            player_name = lines[index - 1].strip() if index > 0 else ""
            if not player_name:
                raise ValueError(f"{path.name}: milestone odds without a player name")
            records.append(
                {
                    "sportsbook": "draftkings",
                    "playerName": player_name,
                    "market": market,
                    "threshold": current_threshold,
                    "americanOdds": int(line),
                    "sourceFile": path.name,
                }
            )

    return records


def extract_fanduel_over_under(
    path: Path, warnings: list[str]
) -> list[dict[str, Any]]:
    selections: list[dict[str, Any]] = []
    incomplete: list[dict[str, Any]] = []
    orphan_odds: list[int] = []
    current_market: str | None = None

    for page_text in extract_pages(path):
        for raw_line in page_text.splitlines():
            line = raw_line.strip()
            if line in MARKET_LABELS:
                current_market = MARKET_LABELS[line]
                continue

            priced = re.fullmatch(
                r"(.+?) (Over|Under) ([0-9.]+) ([+-][0-9]+)", line
            )
            if priced and current_market:
                selections.append(
                    {
                        "playerName": priced.group(1).strip(),
                        "market": current_market,
                        "side": priced.group(2).lower(),
                        "line": float(priced.group(3)),
                        "odds": int(priced.group(4)),
                    }
                )
                continue

            split_selection = re.fullmatch(
                r"(.+?) (Over|Under) ([0-9.]+)", line
            )
            if split_selection and current_market:
                incomplete.append(
                    {
                        "playerName": split_selection.group(1).strip(),
                        "market": current_market,
                        "side": split_selection.group(2).lower(),
                        "line": float(split_selection.group(3)),
                    }
                )
                continue

            if re.fullmatch(r"[+-][0-9]+", line):
                orphan_odds.append(int(line))

    if len(incomplete) != len(orphan_odds):
        raise ValueError(
            f"{path.name}: {len(incomplete)} split selections and "
            f"{len(orphan_odds)} orphan prices"
        )

    for selection, odds in zip(incomplete, orphan_odds, strict=True):
        selections.append({**selection, "odds": odds})
        warnings.append(
            f"FanDuel: recovered {selection['playerName']} "
            f"{selection['side'].title()} {selection['line']} {odds:+d} "
            "across a PDF page break."
        )

    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for selection in selections:
        grouped[(selection["playerName"], selection["market"])].append(selection)

    records: list[dict[str, Any]] = []
    for (player_name, market), player_selections in grouped.items():
        sides = {selection["side"]: selection for selection in player_selections}
        if set(sides) != {"over", "under"}:
            warnings.append(
                f"FanDuel {market}: incomplete priced market omitted for {player_name}."
            )
            continue
        over = sides["over"]
        under = sides["under"]
        records.append(
            {
                "sportsbook": "fanduel",
                "playerName": player_name,
                "market": market,
                "line": (over["line"] + under["line"]) / 2,
                "overOdds": over["odds"],
                "underOdds": under["odds"],
                "sourceFile": path.name,
            }
        )

    full_text = "\n".join(extract_pages(path))
    if (
        "Justin Herbert Regular Season Passing TDs 2026-27" in full_text
        and not any(
            record["playerName"] == "Justin Herbert"
            and record["market"] == "passingTouchdowns"
            for record in records
        )
    ):
        warnings.append(
            "FanDuel passingTouchdowns: Justin Herbert has a heading but no price."
        )
    if "Most Regular Season Rookie Receiving Yards" in full_text:
        warnings.append(
            "FanDuel: Most Regular Season Rookie Receiving Yards has a heading "
            "but no priced selections."
        )

    return records


def main() -> None:
    warnings: list[str] = []
    over_under: list[dict[str, Any]] = []
    milestones: list[dict[str, Any]] = []

    for file_name, market in DRAFTKINGS_OVER_UNDER_FILES.items():
        over_under.extend(
            extract_draftkings_over_under(PDF_DIR / file_name, market, warnings)
        )

    for file_name, market in DRAFTKINGS_MILESTONE_FILES.items():
        milestones.extend(
            extract_draftkings_milestones(PDF_DIR / file_name, market)
        )

    over_under.extend(
        extract_fanduel_over_under(
            PDF_DIR / "July 30 Fan Duel Player Props.pdf", warnings
        )
    )

    over_under.sort(
        key=lambda row: (
            row["sportsbook"],
            row["market"],
            row["playerName"].lower(),
        )
    )
    milestones.sort(
        key=lambda row: (
            row["market"],
            row["threshold"],
            row["playerName"].lower(),
        )
    )

    if len(over_under) != 428:
        raise ValueError(f"Expected 428 over/under markets, found {len(over_under)}")
    if len(milestones) != 847:
        raise ValueError(f"Expected 847 milestone prices, found {len(milestones)}")

    snapshot = {
        "metadata": {
            "season": SEASON,
            "capturedAt": CAPTURED_AT,
            "importedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "sourceDirectory": "betting-lines-pdfs",
            "overUnderCount": len(over_under),
            "milestoneCount": len(milestones),
        },
        "overUnder": over_under,
        "milestones": milestones,
        "warnings": warnings,
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(f"{json.dumps(snapshot, indent=2)}\n", encoding="utf-8")
    print(
        f"Wrote {len(over_under)} over/under markets and "
        f"{len(milestones)} milestone prices to {OUTPUT_FILE}"
    )


if __name__ == "__main__":
    main()
