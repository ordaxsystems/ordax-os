"""Optional native Product Runtime lifecycle library: no boot or media writes.

The mocked verifier and binary below exercise only shell ownership and
fail-closed transitions. They are NOT signed slots, ABI proof or real MCP E2E.
"""
from __future__ import annotations

import os
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "system/services/device-agent/native-product-lifecycle.sh"
SOURCE_COMMIT = "a" * 40


class NativeProductLifecycleTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = pathlib.Path(folder.name)
        self.system = self.root / "system"
        self.worktree = self.root
        self.state = self.root / "state"
        self.channel = self.system / "bin/ordax-runtime-component-channel"
        self.trust = self.system / "trust/runtime-components-ed25519.json"
        self.policy = self.root / "docs/contracts/runtime-component-trust-policy.json"
        self.eligibility = self.root / "gate"
        self.consent = self.root / "consent"
        self.started = self.root / "started"
        self.bad = self.root / "bad"
        self.executable = (
            self.state / "native-state/components/product-runtime/versions"
            / "0.3.0" / SOURCE_COMMIT
            / "system/components/product-runtime/ordax-product-agent"
        )
        for path in (self.channel, self.trust, self.policy, self.executable,
                     self.system / "services/device-agent/studio-runtime-source-lock.json"):
            path.parent.mkdir(parents=True, exist_ok=True)
        self.trust.write_text("test-not-a-real-trust-anchor")
        self.policy.write_text("test-not-a-real-signature-policy")
        (self.system / "services/device-agent/studio-runtime-source-lock.json").write_text("{}")
        self.consent.write_text("on")
        self.executable.write_text(
            "#!/bin/sh\n"
            "case \"$1\" in\n"
            "  --local-access-status)\n"
            "    if [ \"$(cat \"$NATIVE_TEST_CONSENT\")\" = on ]; then\n"
            "      printf 'NATIVE_PRODUCT_LOCAL_ACCESS=ENABLED\\n'; exit 0\n"
            "    fi\n"
            "    printf 'NATIVE_PRODUCT_LOCAL_ACCESS=DISABLED\\n'; exit 3 ;;\n"
            "  --run)\n"
            "    printf '%s\\n' \"$$\" >> \"$NATIVE_TEST_STARTED\"\n"
            "    trap 'exit 0' TERM INT\n"
            "    while :; do sleep 1; done ;;\n"
            "  *) exit 2 ;;\n"
            "esac\n"
        )
        self.executable.chmod(0o755)
        self.channel.write_text(
            "#!/bin/sh\n"
            "[ -f \"$NATIVE_TEST_GATE\" ] || exit 1\n"
            "if [ -f \"$NATIVE_TEST_BAD\" ]; then\n"
            " printf 'PRODUCT_RUNTIME_HANDOFF_VERIFIED=YES\\n'\n"
            " exit 0\n"
            "fi\n"
            "cat <<'EOF'\n"
            "PRODUCT_RUNTIME_HANDOFF_VERIFIED=YES\n"
            "SOURCE_COMMIT=" + SOURCE_COMMIT + "\n"
            "VERSION=0.3.0\n"
            "REVISION=1\n"
            "EXECUTABLE=" + str(self.executable) + "\n"
            "RUNTIME_STARTED=NO\n"
            "CENTRAL_SESSION_ATTESTED=NO\n"
            "EOF\n"
        )
        self.channel.chmod(0o755)

    def run_lifecycle(self, shell_body, *, grant=True, profile="owner-development", mode="usb"):
        if grant:
            self.eligibility.touch()
        elif self.eligibility.exists():
            self.eligibility.unlink()
        env = {
            **os.environ,
            "NATIVE_TEST_GATE": str(self.eligibility),
            "NATIVE_TEST_CONSENT": str(self.consent),
            "NATIVE_TEST_STARTED": str(self.started),
            "NATIVE_TEST_BAD": str(self.bad),
        }
        script = (
            "set -eu\n"
            "SYSTEM_ROOT=" + self.system.as_posix() + "\n"
            "WORKTREE=" + self.worktree.as_posix() + "\n"
            "STATE_DIR=" + self.state.as_posix() + "\n"
            "DISTRIBUTION_PROFILE=" + profile + "\n"
            "PRODUCT_MODE=" + mode + "\n"
            ". " + LIBRARY.as_posix() + "\n"
            + shell_body + "\n"
        )
        return subprocess.run(["sh", "-c", script], env=env, text=True,
                              capture_output=True, timeout=20)

    def test_supervisor_owns_runtime_and_restarts_on_lifecycle_source_update(self):
        supervisor = (ROOT / "system/supervisor").read_text(encoding="utf-8")
        self.assertIn('. "$native_product_lifecycle"', supervisor)
        self.assertIn('command -v native_product_reconcile', supervisor)
        self.assertIn('if ! native_product_reconcile;', supervisor)
        self.assertIn('if ! native_product_stop;', supervisor)
        self.assertIn(
            'system/entrypoint|system/supervisor|system/services/device-agent/native-product-lifecycle.sh)',
            supervisor,
        )
        self.assertLess(
            supervisor.index('if ! native_product_stop;'),
            supervisor.index('if [ -n "$SURFACE_PID" ]; then', supervisor.index('stop_surface() {')),
        )
        self.assertIn('[ "$OWNER_INITIAL_HEALTH_PENDING" -eq 0 ]', supervisor)

    def test_shell_syntax(self):
        check = subprocess.run(["sh", "-n", str(LIBRARY)], capture_output=True)
        self.assertEqual(check.returncode, 0, check.stderr)

    def test_no_verified_current_does_not_launch(self):
        result = self.run_lifecycle(
            "native_product_reconcile\n[ -z \"$NATIVE_PRODUCT_PID\" ]", grant=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.started.exists())

    def test_wrong_profile_never_launches(self):
        for profile, mode in (("stable-mvp", "usb"), ("owner-development", "native-disk")):
            with self.subTest(profile=profile, mode=mode):
                result = self.run_lifecycle(
                    "native_product_reconcile\n[ -z \"$NATIVE_PRODUCT_PID\" ]",
                    profile=profile, mode=mode,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.started.exists())

    def test_partial_verifier_reply_does_not_launch(self):
        self.bad.touch()
        result = self.run_lifecycle(
            "native_product_reconcile\n[ -z \"$NATIVE_PRODUCT_PID\" ]",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.started.exists())

    def test_local_opt_out_stops_only_owned_process(self):
        result = self.run_lifecycle(
            "native_product_reconcile\n"
            "[ -n \"$NATIVE_PRODUCT_PID\" ] || exit 5\n"
            "native_product_original=$NATIVE_PRODUCT_PID\n"
            "sleep 1\n"
            "printf 'off\\n' > \"$NATIVE_TEST_CONSENT\"\n"
            "native_product_reconcile\n"
            "[ -z \"$NATIVE_PRODUCT_PID\" ] || exit 6\n"
            "! kill -0 \"$native_product_original\" 2>/dev/null\n",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.started.exists())
        self.assertEqual(len(self.started.read_text().splitlines()), 1)

    def test_signed_gate_retraction_stops_owned_process(self):
        result = self.run_lifecycle(
            "native_product_reconcile\n"
            "[ -n \"$NATIVE_PRODUCT_PID\" ] || exit 5\n"
            "native_product_original=$NATIVE_PRODUCT_PID\n"
            "sleep 1\n"
            "rm -f \"$NATIVE_TEST_GATE\"\n"
            "native_product_reconcile\n"
            "[ -z \"$NATIVE_PRODUCT_PID\" ] || exit 6\n"
            "! kill -0 \"$native_product_original\" 2>/dev/null\n",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.started.exists())

    def test_no_new_process_if_signed_and_local_status_unchanged(self):
        result = self.run_lifecycle(
            "native_product_reconcile\n"
            "[ -n \"$NATIVE_PRODUCT_PID\" ] || exit 5\n"
            "native_product_original=$NATIVE_PRODUCT_PID\n"
            "sleep 1\n"
            "native_product_reconcile\n"
            "[ \"$NATIVE_PRODUCT_PID\" = \"$native_product_original\" ] || exit 6\n"
            "native_product_stop\n"
            "[ -z \"$NATIVE_PRODUCT_PID\" ]\n",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.started.read_text().splitlines()), 1)


if __name__ == "__main__":
    unittest.main()
