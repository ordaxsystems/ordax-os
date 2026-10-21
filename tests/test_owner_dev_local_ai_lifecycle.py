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
