from __future__ import annotations

import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
REFRESH = ROOT / "system" / "services" / "base-update" / "dev-helpers.sh"
MANIFEST = ROOT / "system" / "services" / "base-update" / "dev-helper-manifest.tsv"
RUN = ROOT / "bootstrap" / "dev-base" / "ordax-run"
PULL = (ROOT / "bootstrap" / "dev-base" / "ordax-pull").read_text(encoding="utf-8")


def load_source_to_target() -> dict[str, str]:
    entries: dict[str, str] = {}
    for raw in MANIFEST.read_text(encoding="utf-8").splitlines():
        if not raw or raw.startswith("#"):
            continue
        source, target = raw.split("\t")
        entries[source] = target
    return entries


SOURCE_TO_TARGET = load_source_to_target()
SOURCE_SHA = "a" * 40


class DevBaseHelperRefreshTests(unittest.TestCase):
    def make_fixture(self, root: Path) -> tuple[Path, Path, Path]:
        worktree = root / "worktree"
        target = root / "target"
        state = root / "state"
        target.mkdir()
        state.mkdir()
        for relative in SOURCE_TO_TARGET:
            source = ROOT / relative
            destination = worktree / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
        manifest_destination = worktree / MANIFEST.relative_to(ROOT)
        manifest_destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(MANIFEST, manifest_destination)
        return worktree, target, state

    def run_refresh(
        self,
        worktree: Path,
        target: Path,
        state: Path,
    ) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env.update(
            {
                "ORDAX_WORKTREE": str(worktree),
                "ORDAX_DEV_HELPER_TARGET_ROOT": str(target),
                "ORDAX_STATE_DIR": str(state),
                "ORDAX_SOURCE_SHA": SOURCE_SHA,
            }
        )
        return subprocess.run(
            ["/bin/sh", str(REFRESH)],
            check=False,
            capture_output=True,
            text=True,
            env=env,
        )

    def test_refreshes_only_fixed_helpers_with_executable_mode(self):
        self.assertIn("/bootstrap/dev-base/", PULL)
        self.assertNotIn("/bootstrap/dev-base/ordax-remote", PULL)
        self.assertIn("/bootstrap/base-update/", PULL)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            worktree, target, state = self.make_fixture(root)
            extra = worktree / "bootstrap/dev-base/not-owned"
            extra.write_text("#!/bin/sh\necho extra\n", encoding="utf-8")

            result = self.run_refresh(worktree, target, state)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(f"ORDAX_DEV_HELPERS_SHA={SOURCE_SHA}", result.stdout)

            expected_targets = set()
            for source_relative, target_relative in SOURCE_TO_TARGET.items():
                source = worktree / source_relative
                installed = target / target_relative
                expected_targets.add(installed)
                self.assertTrue(installed.is_file(), target_relative)
                self.assertFalse(installed.is_symlink(), target_relative)
                self.assertEqual(installed.read_bytes(), source.read_bytes())
                self.assertEqual(stat.S_IMODE(installed.stat().st_mode), 0o755)

            actual_files = {
                path
                for path in target.rglob("*")
                if path.is_file()
            }
            self.assertEqual(actual_files, expected_targets)
            self.assertFalse((target / "bootstrap/dev-base/not-owned").exists())

            receipt = state / "dev-helpers-sha"
            self.assertEqual(receipt.read_text(encoding="utf-8").strip(), SOURCE_SHA)
            self.assertEqual(stat.S_IMODE(receipt.stat().st_mode), 0o600)
            self.assertFalse(list(target.rglob("*.ordax-refresh.*")))

    def test_second_refresh_repairs_a_modified_helper(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            worktree, target, state = self.make_fixture(root)
            first = self.run_refresh(worktree, target, state)
            self.assertEqual(first.returncode, 0, first.stderr)

            installed = target / "usr/local/bin/ordax-pull"
            installed.write_text("#!/bin/sh\necho damaged\n", encoding="utf-8")

            second = self.run_refresh(worktree, target, state)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual(
                installed.read_bytes(),
                (worktree / "bootstrap/dev-base/ordax-pull").read_bytes(),
            )

    def test_source_symlink_is_rejected_before_any_helper_is_committed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            worktree, target, state = self.make_fixture(root)
            source = worktree / "bootstrap/dev-base/ordax-dev-init"
            source.unlink()
            source.symlink_to("ordax-network")

            result = self.run_refresh(worktree, target, state)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("source is missing or unsafe", result.stderr)
            self.assertFalse((target / "sbin/ordax-dev-init").exists())
            self.assertFalse((state / "dev-helpers-sha").exists())

    def test_invalid_shell_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            worktree, target, state = self.make_fixture(root)
            source = worktree / "bootstrap/dev-base/ordax-dev-init"
            source.write_text("#!/bin/sh\nif then\n", encoding="utf-8")

            result = self.run_refresh(worktree, target, state)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("shell syntax is invalid", result.stderr)
            self.assertFalse((target / "sbin/ordax-dev-init").exists())
            self.assertFalse((state / "dev-helpers-sha").exists())

    def test_existing_target_symlink_is_never_followed_or_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            worktree, target, state = self.make_fixture(root)
            outside = root / "outside"
            outside.write_text("keep\n", encoding="utf-8")
            installed = target / "sbin/ordax-dev-init"
            installed.parent.mkdir(parents=True, exist_ok=True)
            installed.symlink_to(outside)

            result = self.run_refresh(worktree, target, state)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("target is not a regular file", result.stderr)
            self.assertTrue(installed.is_symlink())
            self.assertEqual(outside.read_text(encoding="utf-8"), "keep\n")
            self.assertFalse((state / "dev-helpers-sha").exists())

    def test_ordax_run_streams_guardian_status_and_exact_sha_provisioning(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            worktree = root / "worktree"
            entrypoint = worktree / "system" / "entrypoint"
            entrypoint.parent.mkdir(parents=True)
            run_dir = root / "run" / "ordax-update"
            state_dir = root / "state" / "ordax"
            state_dir.mkdir(parents=True)
            (state_dir / "current-commit").write_text(SOURCE_SHA + "\n", encoding="ascii")
            marker = root / "run" / "ordax-surface" / "runtime-provisioning-source-sha"
            fake_git = root / "git"

            fake_git.write_text(
                "#!/bin/sh\n"
                "case \"$*\" in\n"
                f"  *'rev-parse HEAD'*) printf '%s\\n' '{SOURCE_SHA}' ;;\n"
                "  *'status --porcelain'*) exit 0 ;;\n"
                "  *) exit 2 ;;\n"
                "esac\n",
                encoding="utf-8",
            )
            fake_git.chmod(0o755)
            entrypoint.write_text(
                "#!/bin/sh\n"
                "set -eu\n"
                "printf '%s\\n' '2026-10-15T00:00:00Z ordax-guardian: fake-start' >>\"$ORDAX_UPDATE_RUN_DIR/guardian.log\"\n"
                "mkdir -p \"$(dirname \"$ORDAX_SURFACE_RUNTIME_PROVISION_MARKER\")\"\n"
                "printf '%s\\n' \"$ORDAX_SOURCE_SHA\" >\"$ORDAX_SURFACE_RUNTIME_PROVISION_MARKER\"\n"
                "sleep 2\n"
                "rm -f \"$ORDAX_SURFACE_RUNTIME_PROVISION_MARKER\"\n"
                "printf '%s\\n' 'ordax-system: cold-boot Surface acknowledged healthy state' >>\"$ORDAX_UPDATE_RUN_DIR/guardian.log\"\n"
                "sleep 2\n",
                encoding="utf-8",
            )
            entrypoint.chmod(0o755)

            env = os.environ.copy()
            env.update(
                {
                    "ORDAX_WORKTREE": str(worktree),
                    "ORDAX_STATE_DIR": str(state_dir),
                    "ORDAX_GIT_BIN": str(fake_git),
                    "ORDAX_UPDATE_RUN_DIR": str(run_dir),
                    "ORDAX_SURFACE_RUNTIME_PROVISION_MARKER": str(marker),
                }
            )
            result = subprocess.run(
                ["/bin/sh", str(RUN)],
                check=False,
                capture_output=True,
                text=True,
                env=env,
                timeout=12,
            )
            combined = result.stdout + result.stderr
            self.assertEqual(result.returncode, 0, combined)
            self.assertIn(f"starting Owner/Development runtime at {SOURCE_SHA}", combined)
            self.assertIn(f"canonical log: {run_dir / 'guardian.log'}", combined)
            self.assertIn("ordax-guardian: fake-start", combined)
            self.assertIn("first-boot Surface runtime provisioning is in progress", combined)
            self.assertIn("cold-boot Surface acknowledged healthy state", combined)
            self.assertFalse(marker.exists())


if __name__ == "__main__":
    unittest.main()
