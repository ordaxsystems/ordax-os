"""Source and fail-closed regression tests for Owner/Development Local AI lifecycle."""
from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
import os


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "system/services/local-ai/owner-dev-runtime.sh"
RUN = ROOT / "bootstrap/dev-base/ordax-run"
PROOF = ROOT / "docs/evidence/canonical-v4-release-proof.json"
SOURCE_LOCK = ROOT / "system/services/local-ai/source-lock.json"


class OwnerDevLocalAiLifecycleTests(unittest.TestCase):
    def test_script_has_valid_posix_shell_syntax(self):
        result = subprocess.run(["/bin/sh", "-n", str(SCRIPT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_image_binding_matches_exact_signed_release_evidence(self):
        proof = json.loads(PROOF.read_text(encoding="utf-8"))
        lock = json.loads(SOURCE_LOCK.read_text(encoding="utf-8"))
        source = SCRIPT.read_text(encoding="utf-8")
        image = proof["artifacts"]["local-ai-runtime.erofs"]
        self.assertTrue(proof["signed_handoff_verified"])
        self.assertTrue(proof["canonical_materialization_verified"])
        self.assertRegex(source, r"(?m)^IMAGE_SHA256=" + re.escape(image["sha256"]) + r"$")
        self.assertRegex(source, r"(?m)^IMAGE_SIZE=" + str(image["size"]) + r"$")
        self.assertEqual(lock["engine"]["artifact"]["platform"], "linux-x86_64")
        self.assertTrue(lock["distribution"]["signed_release_artifact_required"])
        self.assertFalse(lock["distribution"]["network_download_required_at_runtime"])
        self.assertIn('bb cmp -s "$WORKTREE/system/services/local-ai/source-lock.json"', source)

    def test_activation_rejects_unsupported_profile_without_side_effects(self):
        with tempfile.TemporaryDirectory() as state:
            env = dict(os.environ, ORDAX_STATE_DIR=state,
                       ORDAX_DISTRIBUTION_PROFILE="stable-mvp", ORDAX_PRODUCT_MODE="usb")
            result = subprocess.run(["/bin/sh", str(SCRIPT), "start"], env=env,
                                    capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("unsupported distribution profile", result.stderr)
            self.assertEqual(list(Path(state).iterdir()), [])

    def test_missing_payload_degrades_instead_of_blocking_surface(self):
        with tempfile.TemporaryDirectory() as state:
            env = dict(os.environ, ORDAX_STATE_DIR=state,
                       ORDAX_DISTRIBUTION_PROFILE="owner-development",
                       ORDAX_PRODUCT_MODE="usb")
            result = subprocess.run(["/bin/sh", str(SCRIPT), "start"], env=env,
                                    capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("artifact not staged", result.stderr)
            self.assertEqual(list(Path(state).iterdir()), [])

    def test_incomplete_or_corrupted_staging_degrades_without_mount(self):
        proof = json.loads(PROOF.read_text(encoding="utf-8"))
        digest = proof["artifacts"]["local-ai-runtime.erofs"]["sha256"]
        with tempfile.TemporaryDirectory() as state:
            directory = Path(state) / "local-ai" / "sha256" / digest
            directory.mkdir(parents=True)
            directory.chmod(0o700)
            image = directory / "local-ai-runtime.erofs"
            image.write_bytes(b"not-a-verified-erofs")
            image.chmod(0o600)
            env = dict(os.environ, ORDAX_STATE_DIR=state,
                       ORDAX_DISTRIBUTION_PROFILE="owner-development",
                       ORDAX_PRODUCT_MODE="usb")
            result = subprocess.run(["/bin/sh", str(SCRIPT), "start"], env=env,
                                    capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertRegex(result.stderr, r"(artifact size mismatch|untrusted local AI artifact)")
            self.assertEqual(image.read_bytes(), b"not-a-verified-erofs")
            self.assertFalse((Path(state) / "local-ai.pid").exists())

    def test_private_service_state_does_not_modify_shared_run_permissions(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("SERVICE_DIR=$RUN_DIR/local-ai-service", source)
        self.assertIn("PID_FILE=$SERVICE_DIR/pid", source)
        self.assertIn("LOG_FILE=$SERVICE_DIR/llama-server.log", source)
        self.assertNotIn('bb chmod 700 "$RUN_DIR"', source)
        self.assertIn('if [ -e "$PID_FILE" ] || [ -L "$PID_FILE" ]; then', source)
        self.assertIn('report "unsafe service PID path"', source)
        self.assertIn('report "unsafe local AI service ownership or log"', source)
        self.assertIn('report "unsafe shared runtime directory"', source)
        self.assertIn('report "unsafe runtime mount parent"', source)

    def test_surface_starts_before_optional_full_image_verification(self):
        source = RUN.read_text(encoding="utf-8")
        spawn = source.index('    "$ENTRYPOINT" &')
        start = source.index("local_ai_lifecycle start", spawn)
        traps = source.index("trap cleanup_runtime EXIT", spawn)
        self.assertLess(spawn, traps)
        self.assertLess(traps, start)
        self.assertIn("Native's bounded probe supervisor discovers readiness", source)

    def test_liveness_status_is_read_only_and_fail_closed_without_service(self):
        with tempfile.TemporaryDirectory() as state:
            env = dict(os.environ, ORDAX_STATE_DIR=state,
                       ORDAX_DISTRIBUTION_PROFILE="owner-development",
                       ORDAX_PRODUCT_MODE="usb")
            result = subprocess.run(["/bin/sh", str(SCRIPT), "status"], env=env,
                                    capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertEqual(list(Path(state).iterdir()), [])

    def test_liveness_requires_actual_owned_process_mount_and_ephemeral_key(self):
        source = SCRIPT.read_text(encoding="utf-8")
        watcher = RUN.read_text(encoding="utf-8")
        self.assertIn("    status) status ;;", source)
        self.assertIn('owned_process "$pid" || return 1', source)
        self.assertIn('mounted_here || return 1', source)
        self.assertIn('safe_file "$KEY_FILE" || return 1', source)
        self.assertIn("= 0:600 ] || return 1", source)
        self.assertIn("local_ai_running() {", watcher)
        self.assertIn('/bin/sh "$LOCAL_AI_LIFECYCLE" status >/dev/null 2>&1', watcher)
        self.assertIn("inference readiness is Native-probed", watcher)

    def test_watcher_retries_failed_or_crashed_backend_without_busy_rehash(self):
        watcher = RUN.read_text(encoding="utf-8")
        self.assertIn('aura_retry_seconds=60', watcher)
        self.assertIn('if [ "$aura_retry_seconds" -ge 60 ]; then', watcher)
        self.assertIn("bb sleep 10 &", watcher)
        self.assertIn("watch_sleep_pid=$!", watcher)
        self.assertIn('trap \'stop_observer "$watch_sleep_pid"; exit 0\' HUP INT TERM', watcher)
        self.assertNotIn("SURFACE_RUNTIME_PROVISION_MARKER", watcher)
        self.assertNotIn("watch_owner_provisioning", watcher)
        self.assertNotRegex(watcher, r"(?m)^\\s*bb sleep 1\\s*$")
        self.assertIn('if [ "$aura_seen_hash" != "$ready_hash" ]; then', watcher)
        self.assertIn('bb grep -qx "IMAGE_SHA256=$ready_hash" "$LOCAL_AI_LIFECYCLE"', watcher)
        self.assertRegex(watcher, r'local_ai_lifecycle stop\\n[ ]+local_ai_lifecycle start')
        self.assertIn('if local_ai_running; then', watcher)
        self.assertIn('aura_retry_seconds=0', watcher)
        self.assertIn('if [ "$aura_retry_seconds" -lt 60 ]; then', watcher)
        self.assertIn('aura_retry_seconds=$((aura_retry_seconds + 10))', watcher)
        self.assertIn('Aura process exited; attempting bounded Native restart', watcher)
        self.assertNotIn('if [ "$aura_announced" = no ] && [ -f "$AURA_READY_MARKER" ]', watcher)
        self.assertIn("while process_alive \"$ENTRY_PID\"; do", watcher)
        self.assertIn("trap cleanup_runtime EXIT", watcher)
        syntax = subprocess.run(["/bin/sh", "-n", str(RUN)],
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(syntax.returncode, 0, syntax.stderr)

    @unittest.skipUnless(os.name == "posix" and Path("/proc").is_dir(), "Linux procfs required")
    def test_aura_observer_reaps_sleep_child_on_shutdown(self):
        """Run the actual launcher observer functions; SIGTERM must not orphan sleep."""
        import signal
        import time

        source = RUN.read_text(encoding="utf-8")
        def function(name, next_name):
            start = source.index(name + "() {")
            end = source.index("\\n" + next_name + "() {", start)
            return source[start:end]

        helpers = "\\n".join((
            function("process_alive", "stop_observer"),
            function("stop_observer", "cleanup_observers"),
            function("watch_optional_aura", "start_guardian_tail"),
        ))
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            pid_path = root / "watch.pid"
            shell = root / "observer.sh"
            shell.write_text(
                "#!/bin/sh\\nset -eu\\n"
                "ENTRY_PID=$\\n"
                f"AURA_READY_MARKER='{root / 'not-staged'}'\\n"
                f"LOCAL_AI_LIFECYCLE='{root / 'not-installed'}'\\n"
                "bb() { /bin/sleep \\"$2\\"; }\\n"
                + helpers
                + "\\nwatch_optional_aura &\\n"
                + f"printf '%s\\\\n' \\"$!\\" >'{pid_path}'\\n"
                + 'wait "$!"\\n',
                encoding="utf-8",
            )
            process = subprocess.Popen(
                ["/bin/sh", str(shell)], start_new_session=True,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            )
            watcher_pid = None
            sleep_pid = None
            try:
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    if pid_path.exists() and pid_path.read_text().strip():
                        watcher_pid = int(pid_path.read_text().strip())
                        children = Path(f"/proc/{watcher_pid}/task/{watcher_pid}/children")
                        if children.exists() and children.read_text().strip():
                            sleep_pid = int(children.read_text().split()[0])
                            break
                    time.sleep(0.02)
                self.assertIsNotNone(sleep_pid, "Aura watcher must own one sleep child")
                command = Path(f"/proc/{sleep_pid}/cmdline").read_bytes()
                self.assertIn(b"10", command.split(b"\\0"))
                os.kill(watcher_pid, signal.SIGTERM)
                stdout, stderr = process.communicate(timeout=4)
                self.assertEqual(process.returncode, 0, stdout + stderr)
                self.assertFalse(Path(f"/proc/{sleep_pid}").exists(),
                                 "sleep child survived observer shutdown")
            finally:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                if process.poll() is None:
                    process.communicate(timeout=4)

    def test_ordax_run_owns_start_and_stop_not_bootstrap_or_surface(self):
        text = RUN.read_text(encoding="utf-8")
        self.assertIn("LOCAL_AI_LIFECYCLE=$WORKTREE/system/services/local-ai/owner-dev-runtime.sh", text)
        self.assertIn("local_ai_lifecycle start", text)
        self.assertIn("local_ai_lifecycle stop", text)
        self.assertIn("trap cleanup_runtime EXIT", text)
        self.assertIn('ORDAX_DISTRIBUTION_PROFILE=owner-development ORDAX_PRODUCT_MODE=usb', text)
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('bb mount -t erofs -o ro,loop,nosuid,nodev "$IMAGE"', source)
        self.assertIn('LLAMA_ARG_API_KEY_FILE="$KEY_FILE"', source)
        self.assertIn('"$RUNTIME_ROOT/bin/llama-server"', source)
        self.assertNotIn("wget ", source)
        self.assertNotIn("curl ", source)
        self.assertNotIn("git clone", source)


if __name__ == "__main__":
    unittest.main()
