import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isSportsbookSnapshot,
  type SportsbookMilestoneLine,
  type SportsbookOverUnderLine,
  type SportsbookSnapshot,
} from '@fantasy-draft/shared';

const SNAPSHOT_PATH = resolve(
  process.cwd(),
  process.cwd().endsWith('/scripts') ? '..' : '.',
  'data/sportsbook-snapshot.json'
);

describe('sportsbook snapshot', () => {
  it('contains the complete normalized PDF import', async () => {
    const parsed: unknown = JSON.parse(await readFile(SNAPSHOT_PATH, 'utf8'));
    expect(isSportsbookSnapshot(parsed)).toBe(true);

    const snapshot = parsed as SportsbookSnapshot;
    expect(snapshot.overUnder).toHaveLength(428);
    expect(snapshot.milestones).toHaveLength(847);
    expect(
      snapshot.overUnder.filter(
        (line: SportsbookOverUnderLine) => line.sportsbook === 'fanduel'
      )
    ).toHaveLength(144);
    expect(
      snapshot.overUnder.filter(
        (line: SportsbookOverUnderLine) => line.sportsbook === 'draftkings'
      )
    ).toHaveLength(284);
  });

  it('retains the DraftKings 1,000-yard watchlist prices', async () => {
    const snapshot = JSON.parse(
      await readFile(SNAPSHOT_PATH, 'utf8')
    ) as SportsbookSnapshot;
    const oddsByPlayer = new Map(
      snapshot.milestones
        .filter(
          (line: SportsbookMilestoneLine) =>
            line.market === 'receivingYards' &&
            line.threshold === 1_000
        )
        .map((line: SportsbookMilestoneLine) => [
          line.playerName,
          line.americanOdds,
        ])
    );

    expect(oddsByPlayer.get('Alec Pierce')).toBe(120);
    expect(oddsByPlayer.get('Jordyn Tyson')).toBe(225);
    expect(oddsByPlayer.get('Parker Washington')).toBe(230);
    expect(oddsByPlayer.get('Tucker Kraft')).toBe(240);
    expect(oddsByPlayer.get('Oronde Gadsden II')).toBe(320);
  });
});
