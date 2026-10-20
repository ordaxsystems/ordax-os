from __future__ import annotations

import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
OWNER_ROOT = ROOT / "bootstrap/base-update/owner-development"
CONTRACT_PATH = OWNER_ROOT / "owner-recovery-source.json"
HELPER_PATH = OWNER_ROOT / "ordax-remote"
REFRESH_PATH = ROOT / "system/services/base-update/dev-helpers.sh"
HELPER_MANIFEST_PATH = ROOT / "system/services/base-update/dev-helper-manifest.tsv"
PULL_PATH = ROOT / "bootstrap/dev-base/ordax-pull"
STABLE_SOURCE_PATH = ROOT / "bootstrap/stable-base/source.json"
INITRAMFS_SOURCE_PATH = ROOT / "bootstrap/initramfs/source.json"

SOURCE_SHA = "810c894af12d2049e9f69a94ea92c99df807ab82"
ARTIFACT_SHA256 = "21209da403ee8f96a1b3dd986cd7120095fa2d92bbc5e4eddc1e58db2abebeb2"
ARTIFACT_SIZE = 6008984
OWNER_BOOT_TOKEN = "ordax.distribution_profile=owner-development"
CAPABILITIES = [
    "agent.owner.snapshot",
    "agent.owner.git_status",
    "agent.owner.pull",
    "agent.owner.runtime_stop",
    "agent.owner.runtime_start",
]


class OwnerRemoteRecoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
        self.initramfs_source = json.loads(INITRAMFS_SOURCE_PATH.read_text(encoding="utf-8"))
        self.helper = HELPER_PATH.read_text(encoding="utf-8")
        self.refresh = REFRESH_PATH.read_text(encoding="utf-8")
        self.helper_manifest = HELPER_MANIFEST_PATH.read_text(encoding="utf-8")
        self.pull = PULL_PATH.read_text(encoding="utf-8")

    def run_helper(
        self,
        command: str,
        *,
        state: Path,
        cmdline: str | None = f"quiet {OWNER_BOOT_TOKEN}",
    ) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        cmdline_file = state.parent / "proc-cmdline"
        helper_copy = state.parent / "ordax-remote-test"
        if cmdline is None:
            cmdline_file.unlink(missing_ok=True)
        else:
            cmdline_file.write_text(cmdline + "\n", encoding="utf-8")

        marker = "CMDLINE_FILE=/proc/cmdline"
        self.assertEqual(self.helper.count(marker), 1)
        instrumented = self.helper.replace(
            marker,
            f"CMDLINE_FILE={shlex.quote(str(cmdline_file))}",
            1,
        )
        helper_copy.write_text(instrumented, encoding="utf-8")

        env.update(
            {
                "ORDAX_WORKTREE": str(ROOT),
                "ORDAX_OWNER_REMOTE_STATE_DIR": str(state),
            }
        )
        env.pop("ORDAX_DISTRIBUTION_PROFILE", None)
        env.pop("ORDAX_CMDLINE_FILE", None)
        return subprocess.run(
            ["/bin/sh", str(helper_copy), command],
            check=False,
            capture_output=True,
            text=True,
            env=env,
        )

    def test_exact_runtime_artifact_is_content_addressed_and_owner_only(self):
        self.assertEqual(
            self.contract["$schema"],
            "prototype-ordax.owner-recovery-source/1",
        )
        self.assertEqual(self.contract["distribution_profile"], "owner-development")
        self.assertFalse(self.contract["boot_critical"])
        self.assertFalse(self.contract["stable_mvp_included"])

        runtime = self.contract["runtime"]
        self.assertEqual(runtime["repository"], "https://github.com/ordaxsystems/ordax-runtime")
        self.assertEqual(runtime["source_sha"], SOURCE_SHA)
        self.assertRegex(runtime["source_sha"], r"^[0-9a-f]{40}$")
        self.assertEqual(runtime["release_tag"], f"owner-recovery-{SOURCE_SHA}")
        self.assertEqual(
            runtime["asset_url"],
            "https://github.com/ordaxsystems/ordax-runtime/releases/download/"
            f"owner-recovery-{SOURCE_SHA}/ordax-owner-recovery-agent",
        )
        self.assertEqual(runtime["sha256"], ARTIFACT_SHA256)
        self.assertRegex(runtime["sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(runtime["size_bytes"], ARTIFACT_SIZE)
        self.assertEqual(runtime["architecture"], "linux-amd64")
        self.assertEqual(runtime["linkage"], "static")
        self.assertEqual(self.contract["capabilities"], CAPABILITIES)
        self.assertTrue(all(self.contract["forbidden"].values()))

    def test_owner_boot_identity_is_bound_to_initramfs_ssot(self):
        canonical = self.initramfs_source[
            "owner_development_media_discovery"
        ]["cmdline_token"]
        self.assertEqual(canonical, OWNER_BOOT_TOKEN)
        self.assertEqual(
            self.contract["activation"]["boot_cmdline_token"],
            canonical,
        )
        self.assertIn('PIN_BOOT_TOKEN=$(pin_string boot_cmdline_token)', self.helper)
        self.assertIn("CMDLINE_FILE=/proc/cmdline", self.helper)
        self.assertNotIn("ORDAX_CMDLINE_FILE", self.helper)
        self.assertNotIn("ORDAX_DISTRIBUTION_PROFILE", self.helper)

    def test_controller_has_no_generic_remote_execution_surface(self):
        syntax = subprocess.run(
            ["/bin/sh", "-n", str(HELPER_PATH)],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(syntax.returncode, 0, syntax.stderr)

        forbidden_fragments = [
            "terminal.exec",
            "git push",
            "--no-check-certificate",
            "wget --no-check-certificate",
            "eval ",
            "sh -c",
            "/dev/sd",
            "/dev/nvme",
        ]
        for fragment in forbidden_fragments:
            self.assertNotIn(fragment, self.helper)
        self.assertIn("physical owner-development boot identity is missing or ambiguous", self.helper)
        self.assertIn("artifact digest mismatch", self.helper)
        self.assertIn("artifact size mismatch", self.helper)
        self.assertIn("PID ownership proof failed", self.helper)
        self.assertIn('bb setsid "$BIN_PATH" </dev/null', self.helper)
        self.assertNotIn('/bin/setsid "$BIN_PATH"', self.helper)

    def test_contract_parser_and_unpaired_status_are_safe(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            verified = self.run_helper("verify-contract", state=state)
            self.assertEqual(verified.returncode, 0, verified.stderr)
            self.assertIn(f"ORDAX_OWNER_REMOTE_SOURCE_SHA={SOURCE_SHA}", verified.stdout)
            self.assertIn(
                f"ORDAX_OWNER_REMOTE_ARTIFACT_SHA256={ARTIFACT_SHA256}",
                verified.stdout,
            )
            self.assertIn(f"ORDAX_OWNER_REMOTE_ARTIFACT_SIZE={ARTIFACT_SIZE}", verified.stdout)
            self.assertIn(f"ORDAX_OWNER_REMOTE_BOOT_TOKEN={OWNER_BOOT_TOKEN}", verified.stdout)

            status = self.run_helper("status", state=state)
            self.assertEqual(status.returncode, 0, status.stderr)
            self.assertIn("ORDAX_OWNER_REMOTE_INSTALLED=no", status.stdout)
            self.assertIn("ORDAX_OWNER_REMOTE_PAIRED=no", status.stdout)
            self.assertIn("ORDAX_OWNER_REMOTE_RUNNING=no", status.stdout)
            self.assertIn("ORDAX_OWNER_REMOTE_BOOT_CRITICAL=no", status.stdout)
            self.assertFalse(state.exists(), "status must not create persistent state")

    def test_explicit_paired_owner_autostart_can_be_enabled_and_revoked(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            self.assertNotEqual(
                self.run_helper("enable-auto", state=state).returncode, 0
            )
            self.assertFalse((state / "auto-start-enabled").exists())
            state.mkdir()
            (state / "device-id").write_text("only-disposable-test-device\n")
            token = state / "device-token"
            token.write_text("dummy-secret-test-token\n")
            token.chmod(0o600)
            (state / "control-plane-url").write_text("https://control.example.invalid\n")
            enabled = self.run_helper("enable-auto", state=state)
            self.assertEqual(enabled.returncode, 0, enabled.stderr)
            marker = state / "auto-start-enabled"
            self.assertEqual(marker.read_text().strip(), "enabled")
            self.assertEqual(marker.stat().st_mode & 0o777, 0o600)
            status = self.run_helper("status", state=state)
            self.assertEqual(status.returncode, 0, status.stderr)
            self.assertIn("ORDAX_OWNER_REMOTE_AUTO_START=yes", status.stdout)
            self.assertNotIn("dummy-secret-test-token", status.stdout)
            disabled = self.run_helper("disable-auto", state=state)
            self.assertEqual(disabled.returncode, 0, disabled.stderr)
            self.assertFalse(marker.exists())
            state.chmod(0o700)

    def test_owner_launcher_starts_optional_runtime_only_with_consent(self):
        launcher = (ROOT / "bootstrap/dev-base/ordax-run").read_text(encoding="utf-8")
        self.assertIn("start_optional_owner_remote()", launcher)
        self.assertIn("auto-start-enabled", launcher)
        self.assertIn('"$first_line" = enabled', launcher)
        self.assertIn('/bin/sh "$remote" ensure', launcher)
        self.assertLess(launcher.index("ENTRY_PID=$!"), launcher.index("\nstart_optional_owner_remote\n"))
        self.assertNotIn("ORDAX_OWNER_REMOTE_AUTOSTART=1", launcher)

    def test_non_owner_missing_or_ambiguous_boot_identity_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            invalid_cmdlines = (
                "quiet ordax.distribution_profile=stable-mvp",
                "quiet",
                None,
                f"{OWNER_BOOT_TOKEN} {OWNER_BOOT_TOKEN}",
                f"{OWNER_BOOT_TOKEN} ordax.distribution_profile=stable-mvp",
            )
            for cmdline in invalid_cmdlines:
                with self.subTest(cmdline=cmdline):
                    result = self.run_helper(
                        "verify-contract",
                        state=state,
                        cmdline=cmdline,
                    )
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(
                        "physical owner-development boot identity is missing or ambiguous",
                        result.stderr,
                    )

    def test_current_physical_usb_can_receive_helper_without_new_sparse_rule(self):
        self.assertIn("/bootstrap/base-update/", self.pull)
        self.assertNotIn("/bootstrap/dev-base/ordax-remote", self.pull)
        self.assertIn(
            "bootstrap/base-update/owner-development/ordax-remote\tusr/local/bin/ordax-remote",
            self.helper_manifest,
        )
        self.assertIn("HELPER_MANIFEST=$WORKTREE/system/services/base-update/dev-helper-manifest.tsv", self.refresh)
        self.assertNotIn("system/services/device-agent/owner-remote", self.helper_manifest)

    def test_owner_recovery_bytes_are_not_in_releasable_system_tree(self):
        self.assertFalse((ROOT / "system/services/device-agent/owner-remote.sh").exists())
        self.assertFalse((ROOT / "system/services/device-agent/owner-recovery-source.json").exists())
        self.assertTrue(HELPER_PATH.is_file())
        self.assertTrue(CONTRACT_PATH.is_file())

    def test_stable_base_does_not_include_owner_recovery(self):
        stable_source = STABLE_SOURCE_PATH.read_text(encoding="utf-8")
        self.assertNotIn("owner-recovery", stable_source)
        self.assertNotIn("ordax-remote", stable_source)
        self.assertFalse(self.contract["stable_mvp_included"])

    def test_source_pin_has_no_secret_material(self):
        serialized = json.dumps(self.contract, sort_keys=True).lower()
        for secret_marker in (
            "authorization: bearer",
            "private_key",
            "operator_token",
        ):
            self.assertNotIn(secret_marker, serialized)
        self.assertEqual(
            self.contract["activation"]["device_token_file"],
            "device-token",
        )
        self.assertTrue(self.contract["activation"]["paired_required"])
        self.assertFalse(self.contract["activation"]["automatic_start"])


if __name__ == "__main__":
    unittest.main()
