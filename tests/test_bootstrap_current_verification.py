"""Exercise the transitional offline handoff without executing an unverified tree."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
ENTRY = ROOT / "bootstrap/entrypoint"
COMMIT = "1" * 40


class BootstrapCurrentVerificationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shell = shutil.which("sh")
        if cls.shell is None:
            raise unittest.SkipTest("POSIX shell is unavailable")

    def boot(self, *, verifier_status="0", mutate="0", verifier_missing=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            identity = root / "current-sha"
            identity.write_text(COMMIT + "\n")
            agent = root / "release-agent"
            agent.write_text(
                '#!/bin/sh\n'
                'printf "%s\\n" "$*" >"$AUDIT_LOG"\n'
                'if [ "$MUTATE" = 1 ]; then printf "%040d\\n" 2 >"$CURRENT_SHA_FILE"; fi\n'
                'exit "$VERIFIER_STATUS"\n',
                encoding="utf-8",
            )
            current = root / "entrypoint"
            current.write_text(
                '#!/bin/sh\n'
                'printf "BOOTED %s %s %s\\n" "$ORDAX_SOURCE_SHA" "$ORDAX_DISTRIBUTION_PROFILE" "$ORDAX_PRODUCT_MODE"\n',
                encoding="utf-8",
            )
            agent.chmod(0o755)
            current.chmod(0o755)
            source = ENTRY.read_text(encoding="utf-8")
            body = source.split("boot_current() {", 1)[1].split("\n}", 1)[0]
            script = (
                "set -eu\n"
                'current_release_sha() { cat "$CURRENT_SHA_FILE"; }\n'
                'product_mode() { printf usb; }\n'
                'account_gateway_base_url() { return 1; }\n'
                'log() { :; }\n'
                'recovery() { printf "RECOVERY %s\\n" "$*"; exit 93; }\n'
                + "boot_current() {" + body + "\n}\nboot_current\n"
            )
            environment = dict(os.environ, **{
                "CURRENT_SHA_FILE": identity.as_posix(),
                "CURRENT_ENTRYPOINT": current.as_posix(),
                "RELEASE_AGENT": (root / "missing-verifier").as_posix() if verifier_missing else agent.as_posix(),
                "RELEASE_TRUST": "bootstrap-owned-public-trust.json",
                "AUDIT_LOG": (root / "calls").as_posix(),
                "VERIFIER_STATUS": verifier_status,
                "MUTATE": mutate,
            })
            result = subprocess.run([self.shell, "-c", script], env=environment, text=True, capture_output=True)
            calls = (root / "calls").read_text() if (root / "calls").exists() else ""
            return result, calls

    def test_current_handoff_requires_existing_exact_verifier_for_selected_commit(self):
        result, calls = self.boot()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), f"BOOTED {COMMIT} stable-mvp usb")
        self.assertEqual(calls.strip(), f"activate-exact --root /ordax --trust bootstrap-owned-public-trust.json --expected-commit {COMMIT}")
        self.assertNotIn("--envelope-url", calls)

    def test_rejected_release_never_executes_current(self):
        result, _ = self.boot(verifier_status="1")
        self.assertEqual(result.returncode, 93)
        self.assertIn("exact offline verification", result.stdout)
        self.assertNotIn("BOOTED", result.stdout)

    def test_missing_verifier_never_executes_current(self):
        result, calls = self.boot(verifier_missing=True)
        self.assertEqual(result.returncode, 93)
        self.assertIn("offline release verifier is missing", result.stdout)
        self.assertEqual(calls, "")
        self.assertNotIn("BOOTED", result.stdout)

    def test_current_identity_change_during_verification_is_rejected(self):
        result, _ = self.boot(mutate="1")
        self.assertEqual(result.returncode, 93)
        self.assertIn("changed during verification", result.stdout)
        self.assertNotIn("BOOTED", result.stdout)


if __name__ == "__main__":
    unittest.main()
