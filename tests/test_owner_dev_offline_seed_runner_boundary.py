#!/usr/bin/env python3
"""Prevent Owner Development USB seeding from writing to the CI host runtime."""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/creator-owner-dev-git.yml"
PULL = ROOT / "bootstrap/dev-base/ordax-pull"


class OwnerDevOfflineSeedRunnerBoundaryTests(unittest.TestCase):
    def test_owner_dev_seed_has_separate_runner_lock_and_target_root(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")
        seed = workflow.split(
            "- name: Build boot initramfs and Git development base", 1
        )[1].split("- name: Create ephemeral prototype trust", 1)[0]

        self.assertIn('ORDAX_WORKTREE="$rootfs/workspace/ordax"', seed)
        self.assertIn('ORDAX_STATE_DIR="$rootfs/state/ordax"', seed)
        self.assertIn('ORDAX_UPDATE_RUN_DIR="$RUNNER_TEMP/ordax-owner-dev-seed-run"', seed)
        self.assertIn('ORDAX_DEV_HELPER_TARGET_ROOT="$(realpath "$rootfs")"', seed)
        self.assertIn('--seed-from-local "$GITHUB_WORKSPACE" "$GITHUB_SHA"', seed)
        self.assertIn('test "$(cat "$rootfs/state/ordax/current-commit")" = "$GITHUB_SHA"', seed)
        self.assertIn('test -x out/dev-base/rootfs/usr/local/bin/ordax-pull', seed)

    def test_device_runtime_default_remains_strict(self) -> None:
        pull = PULL.read_text(encoding="utf-8")
        self.assertIn("RUN_DIR=${ORDAX_UPDATE_RUN_DIR:-/run/ordax-update}", pull)
        self.assertIn('mkdir -p "$WORKSPACE_ROOT" "$STATE_DIR" "$RUN_DIR"', pull)


if __name__ == "__main__":
    unittest.main()
