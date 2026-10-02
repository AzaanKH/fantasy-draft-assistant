#!/usr/bin/env python3
"""Start, inspect, and stop one isolated Fantasy Draft Assistant verification run."""

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from secrets import token_hex

ROOT = Path(__file__).resolve().parents[4]
EVIDENCE_ROOT = ROOT / "artifacts" / "verification"
DEFAULT_PORTS = (3100, 3101)


def listener_pids(port: int) -> set[int]:
    result = subprocess.run(
        ["lsof", "-nP", f"-tiTCP:{port}", "-sTCP:LISTEN"],
        capture_output=True, text=True, check=False,
    )
    return {int(line) for line in result.stdout.splitlines() if line.isdecimal()}


def fetch(url: str, headers: dict[str, str] | None = None) -> tuple[int, str]:
    request = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            return response.status, response.read().decode("utf-8")
    except (urllib.error.URLError, TimeoutError, ConnectionError):
        return 0, ""


def state_path(run_id: str) -> Path:
    if not run_id.startswith("fda-") or "/" in run_id or ".." in run_id:
        raise ValueError("Pass the run ID printed by start")
    return EVIDENCE_ROOT / run_id / "run.json"


def read_state(run_id: str) -> dict:
    path = state_path(run_id)
    if not path.is_file():
        raise ValueError(f"No run state at {path}")
    return json.loads(path.read_text())


def save_state(state: dict) -> None:
    path = state_path(state["run_id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2) + "\n")


def group_alive(pid: int) -> bool:
    try:
        return os.getpgid(pid) == pid
    except ProcessLookupError:
        return False


def stop_process(state: dict) -> None:
    pid = state.get("pid")
    if not isinstance(pid, int) or not group_alive(pid):
        return
    os.killpg(pid, signal.SIGTERM)
    for _ in range(50):
        if not group_alive(pid):
            return
        time.sleep(0.1)
    if group_alive(pid):
        os.killpg(pid, signal.SIGKILL)


def remove_copy(state: dict) -> None:
    copy = Path(state["copy"])
    if copy.name != "checkout" or not copy.parent.name.startswith("fda-verify-"):
        raise ValueError(f"Refusing to remove unexpected copy path: {copy}")
    shutil.rmtree(copy.parent, ignore_errors=True)


def cli_environment(copy: Path) -> dict[str, str]:
    env = os.environ.copy()
    for name in tuple(env):
        if name.startswith("DRAFT_") or name in ("SYNC_REQUEST_TOKEN", "FANTASYPROS_API_KEY"):
            env.pop(name)
    env["DRAFT_ROOT"] = str(copy)
    return env


def run_ports(state: dict) -> tuple[int, int]:
    # Older evidence predates configurable ports.
    return state.get("web_port", 3000), state.get("api_port", 3001)


def start(offline: bool = False, web_port: int = 3100, api_port: int = 3101,
          trusted_credentials: bool = False) -> None:
    if not all(1 <= port <= 65535 for port in (web_port, api_port)) or web_port == api_port:
        raise ValueError("Use two different ports from 1 to 65535")
    occupied = {} if offline else {port: sorted(listener_pids(port)) for port in (web_port, api_port) if listener_pids(port)}
    if occupied:
        raise RuntimeError(f"Requested verification ports are occupied; leave the existing instance alone: {occupied}")
    run_id = f"fda-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{token_hex(3)}"
    evidence = EVIDENCE_ROOT / run_id
    evidence.mkdir(parents=True, exist_ok=False)
    private_parent = Path(tempfile.mkdtemp(prefix="fda-verify-"))
    private_parent.chmod(0o700)
    copy = private_parent / "checkout"
    state = {"run_id": run_id, "copy": str(copy), "pid": None, "status": "preparing",
             "mode": "offline" if offline else "app", "web_port": web_port, "api_port": api_port,
             "url": f"http://127.0.0.1:{web_port}/draft", "api_url": f"http://127.0.0.1:{api_port}",
             "browser_profile": str(private_parent / "browser-profile")}
    Path(state["browser_profile"]).mkdir(mode=0o700)
    save_state(state)
    try:
        with (evidence / "setup.log").open("w") as setup_log:
            subprocess.run([
                "rsync", "-a", "--exclude=.git", "--exclude=node_modules",
                "--exclude=dist", "--exclude=*.tsbuildinfo", "--exclude=.local",
                "--exclude=.env", "--exclude=.env.local", "--exclude=artifacts",
                "--exclude=tmp", "--exclude=temp", f"{ROOT}/", str(copy),
            ], stdout=setup_log, stderr=subprocess.STDOUT, check=True)
            subprocess.run(
                ["pnpm", "install", "--frozen-lockfile", "--prefer-offline"],
                cwd=copy, env=cli_environment(copy), stdout=setup_log, stderr=subprocess.STDOUT, check=True,
            )
            subprocess.run(
                ["pnpm", "build:cli"], cwd=copy, env=cli_environment(copy),
                stdout=setup_log, stderr=subprocess.STDOUT, check=True,
            )
        if offline:
            state["status"] = "running"
            save_state(state)
            print(json.dumps({"run_id": run_id, "mode": "offline", "copy": str(copy),
                              "evidence": str(evidence)}))
            return
        env = cli_environment(copy)
        if trusted_credentials and "FANTASYPROS_API_KEY" in os.environ:
            env["FANTASYPROS_API_KEY"] = os.environ["FANTASYPROS_API_KEY"]
        for name in ("PORT", "SYNC_ALLOWED_ORIGINS"):
            env.pop(name, None)
        env.update(DRAFT_WEB_PORT=str(web_port), DRAFT_API_PORT=str(api_port))
        with (evidence / "app.log").open("w") as app_log:
            process = subprocess.Popen(
                ["pnpm", "dev:live"], cwd=copy, env=env,
                stdout=app_log, stderr=subprocess.STDOUT, start_new_session=True,
            )
        state.update(pid=process.pid, status="starting")
        save_state(state)
        deadline = time.monotonic() + 300
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(f"pnpm dev:live exited {process.returncode}; read {evidence / 'app.log'}")
            web_status, web_body = fetch(state["url"])
            health_status, _ = fetch(f"{state['api_url']}/api/health")
            if web_status == 200 and "Fantasy Draft Assistant" in web_body and health_status == 200:
                state["status"] = "running"
                save_state(state)
                print(json.dumps({"run_id": run_id, "url": state["url"], "api_url": state["api_url"], "copy": str(copy),
                                  "browser_profile": state["browser_profile"], "evidence": str(evidence)}))
                return
            time.sleep(1)
        raise RuntimeError(f"Startup timed out; read {evidence / 'app.log'}")
    except Exception:
        stop_process(state)
        remove_copy(state)
        state["status"] = "failed"
        save_state(state)
        raise


def doctor(run_id: str, output=None) -> None:
    state = read_state(run_id)
    pid = state.get("pid")
    copy = Path(state["copy"])
    checks: dict[str, object] = {
        "run_status": state["status"],
        "private_copy": copy.is_dir() and copy.parent.name.startswith("fda-verify-")
        and copy.resolve() != ROOT.resolve() and (copy / "data").is_dir(),
        "shared_build": (copy / "shared" / "dist" / "index.js").is_file(),
        "cli_build": (copy / "cli" / "dist" / "draft.js").is_file(),
    }
    if checks["private_copy"] and checks["cli_build"]:
        probe = subprocess.run(["node", "cli/bin/draft.mjs", "--help"], cwd=copy,
                               env=cli_environment(copy), capture_output=True, text=True, timeout=15)
        checks["cli_help"] = probe.returncode == 0 and "Usage: draft COMMAND" in probe.stdout
    else:
        checks["cli_help"] = False
    if state.get("mode") == "offline":
        print(json.dumps(checks, indent=2), file=output)
        if state["status"] != "running" or not all(value is True for key, value in checks.items() if key != "run_status"):
            raise RuntimeError("Doctor failed; inspect setup.log and do not drive this run")
        return
    checks["process_group"] = isinstance(pid, int) and group_alive(pid)
    web_port, api_port = run_ports(state)
    for port in (web_port, api_port):
        owners = listener_pids(port)
        checks[f"port_{port}_owned_by_run"] = bool(owners) and all(
            os.getpgid(owner) == pid for owner in owners
        ) if isinstance(pid, int) else False
    checks["web_200"] = fetch(f"http://127.0.0.1:{web_port}/draft")[0] == 200
    checks["api_health_200"] = fetch(f"http://127.0.0.1:{api_port}/api/health")[0] == 200
    token_file = copy / ".local" / "sync-token"
    token = token_file.read_text().strip() if token_file.is_file() else ""
    checks["private_auth_token"] = token_file.is_file() and len(token) == 43
    original_token = ROOT / ".local" / "sync-token"
    checks["separate_pairing"] = bool(token) and (not original_token.is_file() or token != original_token.read_text().strip())
    if state.get("browser_profile"):
        profile = Path(state["browser_profile"])
        checks["private_browser_profile"] = profile.is_dir() and profile.parent == copy.parent and profile.stat().st_mode & 0o077 == 0
    checks["authenticated_data_200"] = fetch(
        f"http://127.0.0.1:{api_port}/api/draft-data/current-keepers",
        {"Origin": f"http://localhost:{web_port}", "X-Sync-Token": token},
    )[0] == 200 if token else False
    print(json.dumps(checks, indent=2), file=output)
    if state["status"] != "running" or not all(value is True for key, value in checks.items() if key != "run_status"):
        raise RuntimeError("Doctor failed; inspect app.log and do not drive this run")


def stop(run_id: str) -> None:
    state = read_state(run_id)
    if state.get("status") == "stopped":
        print(f"{run_id} is already stopped; evidence retained at {state_path(run_id).parent}")
        return
    try:
        if state.get("mode") != "offline" and shutil.which("agent-browser"):
            subprocess.run(["agent-browser", "--session", run_id, "close"], timeout=15,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        print(f"Browser close failed; continuing owned-process cleanup: {error}", file=sys.stderr)
    finally:
        stop_process({"pid": state.get("browser_pid")})
        stop_process(state)
        remove_copy(state)
    state.update(status="stopped", pid=None, browser_pid=None)
    save_state(state)
    print(f"Stopped {run_id}; evidence retained at {state_path(run_id).parent}")


def cli(run_id: str, argv: list[str]) -> None:
    state = read_state(run_id)
    doctor(run_id, output=sys.stderr)
    if state.get("mode") == "offline":
        # Never let an offline run accidentally attach to another local server.
        command = argv[0] if argv else "--help"
        replay = command == "replay" or any(arg == "--replay" or arg.startswith("--replay=") for arg in argv)
        connected_option = any(arg.split("=", 1)[0] in ("--session", "--server-url") for arg in argv)
        if connected_option or not (replay or command in ("readiness", "--help", "-h")):
            raise ValueError("Offline runs support local readiness, help, and replay only; start an app run for connected commands")
    copy = Path(state["copy"])
    env = cli_environment(copy)
    if state.get("mode") != "offline":
        env["DRAFT_SERVER_URL"] = f"http://127.0.0.1:{run_ports(state)[1]}"
    result = subprocess.run(["node", "cli/bin/draft.mjs", *argv], cwd=copy, env=env)
    if result.returncode:
        doctor(run_id, output=sys.stderr)
    sys.exit(result.returncode if result.returncode >= 0 else 128 - result.returncode)


def extension_browser(run_id: str, executable: str | None) -> None:
    state = read_state(run_id)
    doctor(run_id)
    if state.get("mode") == "offline":
        raise ValueError("Extension verification requires an app run")
    if not executable or not Path(executable).is_file():
        raise ValueError("Pass --browser-executable with a Chromium or Chrome for Testing binary that supports --load-extension")
    if state.get("browser_pid") and group_alive(state["browser_pid"]):
        raise ValueError("This run already has an extension browser")
    extension = Path(state["copy"]) / "extension" / "dist"
    if not (extension / "manifest.json").is_file():
        raise ValueError("Wait for the extension watcher to finish building")
    profile = Path(state["browser_profile"])
    if profile.parent != Path(state["copy"]).parent:
        raise ValueError("Browser profile must belong to this run")
    with (state_path(run_id).parent / "extension-browser.log").open("a") as log:
        process = subprocess.Popen([
            executable, f"--user-data-dir={profile}", "--profile-directory=Default", f"--load-extension={extension}",
            f"--disable-extensions-except={extension}", "--no-first-run", "--no-default-browser-check",
            "chrome://extensions/",
        ], stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    state["browser_pid"] = process.pid
    save_state(state)
    print(json.dumps({"browser_pid": process.pid, "browser_profile": str(profile),
                      "extension": str(extension), "url": state["url"]}))


def main() -> None:
    if len(sys.argv) >= 3 and sys.argv[1] == "cli":
        argv = sys.argv[3:]
        cli(sys.argv[2], argv[1:] if argv[:1] == ["--"] else argv)
        return
    parser = argparse.ArgumentParser(description=__doc__, epilog="CLI usage: control.py cli RUN_ID -- COMMAND [options]")
    parser.add_argument("command", choices=("start", "doctor", "stop", "cli", "extension-browser"))
    parser.add_argument("run_id", nargs="?", help="ID printed by start")
    parser.add_argument("--offline", action="store_true", help="Build an isolated CLI without starting or contacting servers")
    parser.add_argument("--trusted-credentials", action="store_true",
                        help="Pass the environment's FANTASYPROS_API_KEY to app startup only for trusted code")
    parser.add_argument("--web-port", type=int, default=DEFAULT_PORTS[0])
    parser.add_argument("--api-port", type=int, default=DEFAULT_PORTS[1])
    parser.add_argument("--browser-executable", help="Chromium/Chrome for Testing executable for extension-browser")
    args = parser.parse_args()
    if args.offline and args.command != "start":
        parser.error("--offline is only supported by start")
    if args.trusted_credentials and (args.command != "start" or args.offline):
        parser.error("--trusted-credentials is only supported by app start")
    if args.command == "start":
        if args.run_id:
            parser.error("start takes no run ID")
        start(args.offline, args.web_port, args.api_port, args.trusted_credentials)
    elif not args.run_id:
        parser.error(f"{args.command} requires the run ID printed by start")
    elif args.command == "doctor":
        doctor(args.run_id)
    elif args.command == "extension-browser":
        extension_browser(args.run_id, args.browser_executable)
    else:
        stop(args.run_id)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"verify control: {error}", file=sys.stderr)
        sys.exit(1)
