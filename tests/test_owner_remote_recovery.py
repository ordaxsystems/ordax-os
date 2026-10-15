from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
OWNER_ROOT = ROOT / "bootstrap/base-update/owner-development"
CONTRACT_PATH = OWNER_ROOT / "owner-recovery-source.json"
HELPER_PATH = OWNER_ROOT / "ordax-remote"
REFRESH_PATH = ROOT / "system/services/base-update/dev-helpers.sh"
PULL_PATH = ROOT / "bootstrap/dev-base/ordax-pull"
STABLE_SOURCE_PATH = ROOT / "bootstrap/stable-base/source.json"

SOURCE_SHA = "810c894af12d2049e9f69a94ea92c99df807ab82"
ARTIFACT_SHA256 = "21209da403ee8f96a1b3dd986cd7120095fa2d92bbc5e4eddc1e58db2abebeb2"
ARTIFACT_SIZE = 6008984
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
        self.helper = HELPER_PATH.read_text(encoding="utf-8")
        self.refresh = REFRESH_PATH.read_text(encoding="utf-8")
        self.pull = PULL_PATH.read_text(encoding="utf-8")

    def run_helper(
        self,
        command: str,
        *,
        state: Path,
        profile: str | None = "owner-development",
    ) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env.update(
            {
                "ORDAX_WORKTREE": str(ROOT),
                "ORDAX_OWNER_REMOTE_STATE_DIR": str(state),
            }
        )
        if profile is None:
            env.pop("ORDAX_DISTRIBUTION_PROFILE", None)
        else:
            env["ORDAX_DISTRIBUTION_PROFILE"] = profile
        return subprocess.run(
            ["/bin/sh", str(HELPER_PATH), command],
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
        self.assertIn("restricted to explicit owner-development profile", self.helper)
        self.assertIn("artifact digest mismatch", self.helper)
        self.assertIn("artifact size mismatch", self.helper)
        self.assertIn("PID ownership proof failed", self.helper)

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

            status = self.run_helper("status", state=state)
            self.assertEqual(status.returncode, 0, status.stderr)
            self.assertIn("ORDAX_OWNER_REMOTE_INSTALLED=no", status.stdout)
            self.assertIn("ORDAX_OWNER_REMOTE_PAIRED=no", status.stdout)
            self.assertIn("ORDAX_OWNER_REMOTE_RUNNING=no", status.stdout)
            self.assertIn("ORDAX_OWNER_REMOTE_BOOT_CRITICAL=no", status.stdout)
            self.assertFalse(state.exists(), "status must not create persistent state")

    def test_non_owner_or_missing_profile_is_rejected_before_activation(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            for profile in ("stable-mvp", None):
                result = self.run_helper(
                    "verify-contract",
                    state=state,
                    profile=profile,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("explicit owner-development profile", result.stderr)

    def test_current_physical_usb_can_receive_helper_without_new_sparse_rule(self):
        self.assertIn("/bootstrap/base-update/", self.pull)
        self.assertNotIn("/bootstrap/dev-base/ordax-remote", self.pull)
        self.assertIn(
            "stage_helper bootstrap/base-update/owner-development/ordax-remote usr/local/bin/ordax-remote",
            self.refresh,
        )
        self.assertNotIn("system/services/device-agent/owner-remote", self.refresh)

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
