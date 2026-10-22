"""Opt-in Owner Dev signed v4 preview must not activate or touch live Git."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "system/services/update/owner-signed-preview.sh"
SHELL = os.environ.get("ORDAX_TEST_POSIX_SH", "/bin/sh")
SHA = "0123456789abcdef0123456789abcdef01234567"

def shell_path(path):
    value = str(path)
    if os.name != "nt":
        return value
    drive, rest = os.path.splitdrive(value)
    if not drive:
        return value.replace(chr(92), "/")
    return "/" + drive[0].lower() + rest.replace(chr(92), "/")


class OwnerSignedPreviewTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.checkout = self.root / "checkout"
        self.checkout.mkdir()
        self.marker = self.checkout / "keep-current"
        self.marker.write_text("untouched", encoding="utf-8")
        self.trust = self.root / "trust.json"
        self.trust.write_text("canonical-fixture-anchor", encoding="utf-8")
        self.channel = self.root / "channel"
        self.channel.write_text("https://example.invalid/release-envelope.json\n", encoding="utf-8", newline="\n")
        self.agent = self.root / "agent"
        self.agent.write_text(
            '#!/bin/sh\n'
            'printf "%s\\n" "$*" >> "$ORDAX_TEST_RECORD"\n'
            'case "$1" in\n'
            ' inspect) printf \'{"status":"verified","source_commit":"'
            + SHA + '"}\\n\' ;;\n'
            ' materialize-portable-v4) [ "${ORDAX_TEST_FAIL_STAGE:-0}" != 1 ] ;;\n'
            ' verify-portable-v4-exact) printf \'{"status":"verified","source_commit":"'
            + SHA + '"}\\n\' ;;\n'
            ' *) exit 94 ;;\n'
            'esac\n', encoding="utf-8", newline="\n",
        )
        self.agent.chmod(0o755)
        self.record = self.root / "agent-invocations"
        self.stage = self.root / "owner-signed-preview"
        self.stage.mkdir()
        self.env = dict(os.environ,
            ORDAX_DISTRIBUTION_PROFILE="owner-development",
            ORDAX_WORKTREE=shell_path(self.checkout),
            ORDAX_OWNER_SIGNED_AGENT=shell_path(self.agent),
            ORDAX_OWNER_SIGNED_TRUST_FILE=shell_path(self.trust),
            ORDAX_OWNER_SIGNED_CHANNEL_FILE=shell_path(self.channel),
            ORDAX_OWNER_SIGNED_STAGE_ROOT=shell_path(self.stage),
            ORDAX_TEST_RECORD=shell_path(self.record),
        )

    def call(self, *args, env=None):
        return subprocess.run(
            [SHELL, str(SCRIPT), *args],
            env=env or self.env, capture_output=True, text=True,
            check=False, timeout=15,
        )

    def invoked(self):
        return self.record.read_text(encoding="utf-8").splitlines() if self.record.exists() else []

    def assert_preserved(self):
        self.assertEqual(self.marker.read_text(encoding="utf-8"), "untouched")
        self.assertFalse((self.checkout / "releases").exists())

    def test_shell_syntax(self):
        subprocess.run([SHELL, "-n", str(SCRIPT)], check=True)

    def test_inspect_uses_the_canonical_release_agent_without_mutation(self):
        result = self.call("inspect")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('"status":"verified"', result.stdout)
        commands = self.invoked()
        self.assertEqual(len(commands), 1)
        self.assertTrue(commands[0].startswith("inspect --envelope-url https://example.invalid/"))
        self.assertIn("--trust " + shell_path(self.trust), commands[0])
        self.assertIn("--repository ordaxsystems/ordax-os", commands[0])
        self.assertNotIn("--root", commands[0])
        self.assert_preserved()

    def test_stage_requires_exact_pin_and_reverifies_same_isolated_root(self):
        result = self.call("stage", SHA)
        self.assertEqual(result.returncode, 0, result.stderr)
        commands = self.invoked()
        self.assertEqual(len(commands), 2)
        self.assertTrue(commands[0].startswith("materialize-portable-v4 "))
        self.assertTrue(commands[1].startswith("verify-portable-v4-exact "))
        for cmd in commands:
            self.assertIn("--expected-commit " + SHA, cmd)
            self.assertIn("--root " + shell_path(self.stage), cmd)
            self.assertNotIn("activate-exact", cmd)
            self.assertNotIn(" install ", " " + cmd + " ")
        self.assert_preserved()

    def test_stage_failure_never_runs_verifier_or_fallback(self):
        env = dict(self.env, ORDAX_TEST_FAIL_STAGE="1")
        result = self.call("stage", SHA, env=env)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(self.invoked()), 1)
        self.assert_preserved()

    def test_non_owner_profile_and_malformed_sha_are_denied(self):
        result = self.call("inspect", env=dict(self.env, ORDAX_DISTRIBUTION_PROFILE="stable-mvp"))
        self.assertNotEqual(result.returncode, 0)
        self.assertNotEqual(self.call("stage", "A" * 40).returncode, 0)
        self.assertNotEqual(self.call("stage", SHA[:-1]).returncode, 0)
        self.assertEqual(self.invoked(), [])
        self.assert_preserved()

    def test_invalid_channel_and_unsafe_trust_are_denied_before_agent(self):
        self.channel.write_text("http://example.invalid/unsigned\n", encoding="utf-8", newline="\n")
        self.assertNotEqual(self.call("inspect").returncode, 0)
        self.channel.write_text("https://example.invalid/release-envelope.json\n", encoding="utf-8", newline="\n")
        self.trust.unlink()
        self.trust.symlink_to(self.channel)
        self.assertNotEqual(self.call("inspect").returncode, 0)
        self.assertEqual(self.invoked(), [])

    def test_cannot_stage_on_live_or_unapproved_root(self):
        for root in (self.checkout, self.root, Path("/"), Path("/state"),
                     Path("/ordax"), Path("/workspace")):
            result = self.call("stage", SHA, env=dict(self.env, ORDAX_OWNER_SIGNED_STAGE_ROOT=shell_path(root)))
            self.assertNotEqual(result.returncode, 0, str(root))
        self.assertEqual(self.invoked(), [])

    def test_symlink_stage_directory_is_denied(self):
        alias = self.root / "alternate"
        alias.symlink_to(self.stage, target_is_directory=True)
        result = self.call("stage", SHA, env=dict(self.env, ORDAX_OWNER_SIGNED_STAGE_ROOT=shell_path(alias)))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.invoked(), [])


if __name__ == "__main__":
    unittest.main()
