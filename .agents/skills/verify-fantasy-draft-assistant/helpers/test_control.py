"""Regression checks for CLI isolation and cleanup, without application listeners."""

import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import control


class CliIsolationTests(unittest.TestCase):
    def test_environment_does_not_inherit_connection_or_credentials(self):
        with patch.dict(os.environ, {"DRAFT_ROOT": "/user", "DRAFT_SLOT": "9",
                                    "DRAFT_SESSION": "sleeper:user", "DRAFT_SERVER_URL": "http://localhost:9999",
                                    "SYNC_REQUEST_TOKEN": "secret", "FANTASYPROS_API_KEY": "provider-secret"}):
            env = control.cli_environment(Path("/private/checkout"))
        self.assertEqual(env["DRAFT_ROOT"], "/private/checkout")
        self.assertNotIn("SYNC_REQUEST_TOKEN", env)
        self.assertNotIn("FANTASYPROS_API_KEY", env)
        self.assertEqual([key for key in env if key.startswith("DRAFT_")], ["DRAFT_ROOT"])

    def test_offline_rejects_connected_commands_before_execution(self):
        state = {"mode": "offline", "copy": "/private/checkout"}
        for argv in (["sessions", "--json"], ["status", "--session=x"],
                     ["readiness", "--server-url", "http://localhost:3001"],
                     ["connect", "sleeper:x"]):
            with self.subTest(argv=argv), patch.object(control, "read_state", return_value=state), \
                    patch.object(control, "doctor"), patch.object(control.subprocess, "run") as run:
                with self.assertRaises(ValueError):
                    control.cli("fda-test", argv)
                run.assert_not_called()

    def test_cli_preserves_readiness_exit_and_rechecks_doctor(self):
        with patch.object(control, "read_state", return_value={"mode": "offline", "copy": "/private/checkout"}), \
                patch.object(control, "doctor") as doctor, \
                patch.object(control.subprocess, "run", return_value=subprocess.CompletedProcess([], 3)) as run:
            with self.assertRaises(SystemExit) as result:
                control.cli("fda-test", ["readiness", "--json"])
            self.assertEqual(result.exception.code, 3)
            self.assertEqual(doctor.call_count, 2)
            self.assertEqual(run.call_args.args[0], ["node", "cli/bin/draft.mjs", "readiness", "--json"])
            self.assertEqual(run.call_args.kwargs["cwd"], Path("/private/checkout"))

    def test_offline_doctor_does_not_contact_existing_services(self):
        with tempfile.TemporaryDirectory(prefix="fda-verify-") as directory:
            copy = Path(directory) / "checkout"
            for file in ("data/.keep", "shared/dist/index.js", "cli/dist/draft.js"):
                path = copy / file
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            with patch.object(control, "read_state", return_value={"status": "running", "mode": "offline", "copy": str(copy)}), \
                    patch.object(control, "fetch") as fetch, patch.object(control, "listener_pids") as listeners, \
                    patch.object(control.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "Usage: draft COMMAND")):
                output = io.StringIO()
                control.doctor("fda-test", output=output)
                self.assertTrue(json.loads(output.getvalue())["cli_help"])
                fetch.assert_not_called()
                listeners.assert_not_called()

    def test_app_cli_uses_its_recorded_api_port(self):
        state = {"mode": "app", "copy": "/private/checkout", "web_port": 3100, "api_port": 3101}
        with patch.object(control, "read_state", return_value=state), patch.object(control, "doctor"), \
                patch.object(control.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as run:
            with self.assertRaises(SystemExit):
                control.cli("fda-test", ["sessions", "--json"])
            self.assertEqual(run.call_args.kwargs["env"]["DRAFT_SERVER_URL"], "http://127.0.0.1:3101")

    def test_start_refuses_occupied_test_ports_without_touching_local_app(self):
        with patch.object(control, "listener_pids", side_effect=lambda port: {123} if port == 3101 else set()) as listeners, \
                patch.object(control.subprocess, "run") as run:
            with self.assertRaisesRegex(RuntimeError, "3101"):
                control.start()
            self.assertEqual({call.args[0] for call in listeners.call_args_list}, {3100, 3101})
            run.assert_not_called()

    def test_start_excludes_credentials_before_executing_checkout_code(self):
        subprocess_run = subprocess.run
        subprocess_popen = subprocess.Popen
        for offline, trusted in ((True, False), (False, False), (False, True)):
            with self.subTest(offline=offline, trusted=trusted), tempfile.TemporaryDirectory() as directory:
                root = Path(directory) / "source"
                root.mkdir()
                for name in (".env", ".env.local", ".env.example", "package.json"):
                    (root / name).write_text("fixture")

                def check_copy(copy):
                    self.assertFalse((copy / ".env").exists())
                    self.assertFalse((copy / ".env.local").exists())
                    self.assertTrue((copy / ".env.example").is_file())
                    self.assertTrue((copy / "package.json").is_file())

                def setup_command(argv, **kwargs):
                    if argv[0] == "rsync":
                        with patch.object(control.subprocess, "Popen", subprocess_popen):
                            return subprocess_run(argv, **kwargs)
                    check_copy(kwargs["cwd"])
                    self.assertNotIn("FANTASYPROS_API_KEY", kwargs["env"])
                    return subprocess.CompletedProcess(argv, 0)

                with patch.object(control, "ROOT", root), \
                        patch.object(control, "EVIDENCE_ROOT", Path(directory) / "evidence"), \
                        patch.dict(os.environ, {"FANTASYPROS_API_KEY": "provider-secret"}), \
                        patch.object(control, "listener_pids", return_value=set()), \
                        patch.object(control.subprocess, "run", side_effect=setup_command) as run, \
                        patch.object(control.subprocess, "Popen") as popen, \
                        patch.object(control, "fetch", return_value=(200, "Fantasy Draft Assistant")), \
                        patch.object(control, "stop_process"), \
                        patch.object(control.shutil, "which", return_value=None), \
                        contextlib.redirect_stdout(io.StringIO()) as output:
                    popen.return_value.pid = 123
                    popen.return_value.poll.return_value = None
                    control.start(offline=offline, trusted_credentials=trusted)
                    state = json.loads(output.getvalue())
                    try:
                        check_copy(Path(state["copy"]))
                        self.assertEqual([call.args[0][1] for call in run.call_args_list if call.args[0][0] == "pnpm"],
                                         ["install", "build:cli"])
                        if offline:
                            popen.assert_not_called()
                        else:
                            self.assertEqual(popen.call_args.kwargs["env"].get("FANTASYPROS_API_KEY"),
                                             "provider-secret" if trusted else None)
                    finally:
                        control.stop(state["run_id"])

    def test_stop_already_stopped_does_not_attempt_cleanup(self):
        state = {"status": "stopped", "pid": 123, "browser_pid": 456}
        with patch.object(control, "read_state", return_value=state), \
                patch.object(control.shutil, "which") as which, \
                patch.object(control.subprocess, "run") as run, \
                patch.object(control, "stop_process") as stop_process, \
                patch.object(control, "remove_copy") as remove_copy, \
                patch.object(control, "save_state") as save_state, \
                contextlib.redirect_stdout(io.StringIO()):
            control.stop("fda-test")
            for cleanup in (which, run, stop_process, remove_copy, save_state):
                cleanup.assert_not_called()

    def test_stop_without_browser_preserves_evidence(self):
        with tempfile.TemporaryDirectory() as evidence, tempfile.TemporaryDirectory(prefix="fda-verify-") as directory:
            copy = Path(directory) / "checkout"
            copy.mkdir()
            state = {"run_id": "fda-test", "copy": str(copy), "pid": None, "status": "running", "mode": "app"}
            with patch.object(control, "EVIDENCE_ROOT", Path(evidence)), patch.object(control.shutil, "which", return_value=None):
                control.save_state(state)
                proof = Path(evidence) / "fda-test" / "proof.json"
                proof.write_text('{}\n')
                with contextlib.redirect_stdout(io.StringIO()):
                    control.stop("fda-test")
                self.assertFalse(copy.exists())
                self.assertTrue(proof.exists())
                self.assertEqual(control.read_state("fda-test")["status"], "stopped")

    def test_extension_browser_uses_only_private_build_and_profile(self):
        with tempfile.TemporaryDirectory() as evidence, tempfile.TemporaryDirectory(prefix="fda-verify-") as directory:
            parent = Path(directory)
            copy = parent / "checkout"
            extension = copy / "extension" / "dist"
            extension.mkdir(parents=True)
            (extension / "manifest.json").write_text('{}')
            profile = parent / "browser-profile"
            profile.mkdir(mode=0o700)
            executable = parent / "chromium"
            executable.touch()
            state = {"run_id": "fda-test", "copy": str(copy), "mode": "app", "status": "running",
                     "pid": 123, "browser_profile": str(profile), "url": "http://127.0.0.1:3100/draft"}
            with patch.object(control, "EVIDENCE_ROOT", Path(evidence)), patch.object(control, "doctor"), \
                    patch.object(control.subprocess, "Popen") as popen, \
                    patch.object(control, "stop_process") as stop_process, \
                    patch.object(control.shutil, "which", return_value=None), \
                    contextlib.redirect_stdout(io.StringIO()):
                popen.return_value.pid = 456
                stopped_pids = []
                stop_process.side_effect = lambda state: stopped_pids.append(state.get("pid"))
                control.save_state(state)
                control.extension_browser("fda-test", str(executable))
                args = popen.call_args.args[0]
                self.assertIn(f"--user-data-dir={profile}", args)
                self.assertIn("--profile-directory=Default", args)
                self.assertIn(f"--load-extension={extension}", args)
                self.assertTrue(popen.call_args.kwargs["start_new_session"])
                self.assertEqual(control.read_state("fda-test")["browser_pid"], 456)
                control.stop("fda-test")
                self.assertEqual(stopped_pids, [456, 123])
                stopped = control.read_state("fda-test")
                self.assertEqual(stopped["status"], "stopped")
                self.assertIsNone(stopped["pid"])
                self.assertIsNone(stopped["browser_pid"])
                control.stop("fda-test")
                self.assertEqual(stop_process.call_count, 2)
                self.assertFalse(profile.exists())
                self.assertTrue((Path(evidence) / "fda-test" / "extension-browser.log").exists())


if __name__ == "__main__":
    unittest.main()
