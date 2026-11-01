"""Fast contract and filesystem proof for the shared Stable layout SSOT."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "bootstrap/base/stable_runtime_layout.py"
STABLE_SOURCE = ROOT / "bootstrap/stable-base/source.json"
LEGACY = ROOT / "bootstrap/stable-base/build.py"
POST_BUILD = ROOT / "bootstrap/independent-base/post-build.sh"


def load_module():
    spec = importlib.util.spec_from_file_location("ordax_stable_runtime_layout_test", HELPER)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class StableRuntimeLayoutTests(unittest.TestCase):
    def contract(self) -> dict:
        return json.loads(STABLE_SOURCE.read_text(encoding="utf-8"))

    def test_canonical_stable_directories_are_declared_once(self):
        contract = self.contract()
        expected = (
            "state", "system", "ordax", "ordax-data", "ordax-esp",
            "home", "run", "tmp", "proc", "sys", "dev", "root",
        )
        self.assertEqual(load_module().runtime_directories(contract), expected)
        old_builder = LEGACY.read_text(encoding="utf-8")
        self.assertIn("LAYOUT.ensure_runtime_directories(rootfs, contract, create=True)", old_builder)
        self.assertNotIn('for relative in (\n        "state",', old_builder)
        self.assertNotIn("bootstrap/independent-base/build.py", old_builder)
        self.assertIn("LAYOUT.verify_stable_size(rootfs, contract)", old_builder)
        self.assertNotIn("CORE.unique_regular_bytes(rootfs)", old_builder)

    def test_buildroot_stable_uses_same_layout_and_validates_real_target(self):
        script = POST_BUILD.read_text(encoding="utf-8")
        builder = (ROOT / "bootstrap/independent-base/build.py").read_text(encoding="utf-8")
        self.assertIn(
            '"$ORDAX_HOST_PYTHON" "$ROOT/bootstrap/base/stable_runtime_layout.py" install',
            script,
        )
        self.assertIn(
            'run(sys.executable, str(STABLE_RUNTIME_LAYOUT), "check", "--target", str(target))',
            builder,
        )
        self.assertNotIn('mkdir -p "$TARGET_DIR/ordax-data"', script)

    def test_install_and_check_use_same_contract_and_sticky_tmp(self):
        layout = load_module()
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "target"
            target.mkdir()
            actual = layout.ensure_runtime_directories(target, self.contract(), create=True)
            self.assertEqual(actual, layout.ensure_runtime_directories(target, self.contract(), create=False))
            self.assertEqual(stat.S_IMODE((target / "tmp").stat().st_mode), 0o1777)

    def test_missing_directory_and_nonsticky_tmp_fail_closed(self):
        layout = load_module()
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "target"
            target.mkdir()
            with self.assertRaisesRegex(layout.StableRuntimeLayoutError, "missing Stable runtime directory"):
                layout.ensure_runtime_directories(target, self.contract(), create=False)
            layout.ensure_runtime_directories(target, self.contract(), create=True)
            (target / "tmp").chmod(0o755)
            with self.assertRaisesRegex(layout.StableRuntimeLayoutError, "mode 1777"):
                layout.ensure_runtime_directories(target, self.contract(), create=False)

    def test_symlink_directory_is_never_followed(self):
        layout = load_module()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / "target"
            outside = root / "outside"
            target.mkdir()
            outside.mkdir()
            (target / "run").symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(layout.StableRuntimeLayoutError, "unsafe Stable directory"):
                layout.ensure_runtime_directories(target, self.contract(), create=True)
            self.assertEqual(list(outside.iterdir()), [])

    def test_size_budget_counts_hardlinked_regular_inodes_only(self):
        layout = load_module()
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "target"
            target.mkdir()
            layout.ensure_runtime_directories(target, self.contract(), create=True)
            (target / "system/payload").write_bytes(b"stable-payload")
            (target / "home/payload-link").hardlink_to(target / "system/payload")
            self.assertEqual(layout.unique_regular_bytes(target), len(b"stable-payload"))
            self.assertEqual(layout.verify_stable_size(target, self.contract()), len(b"stable-payload"))

    def test_size_budget_rejects_oversize_and_invalid_limits(self):
        layout = load_module()
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "target"
            target.mkdir()
            layout.ensure_runtime_directories(target, self.contract(), create=True)
            (target / "system/payload").write_bytes(b"size-capped")
            contract = self.contract()
            contract["rootfs"]["maximum_unique_regular_bytes"] = 4
            with self.assertRaisesRegex(layout.StableRuntimeLayoutError, "Stable Base too large"):
                layout.verify_stable_size(target, contract)
            for unsafe in (True, -1, 0, "1024"):
                contract["rootfs"]["maximum_unique_regular_bytes"] = unsafe
                with self.assertRaisesRegex(layout.StableRuntimeLayoutError, "size limit"):
                    layout.verify_stable_size(target, contract)

    def test_real_cli_install_check_and_mode_rejection(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "target"
            target.mkdir()

            def run(action: str):
                return subprocess.run(
                    [sys.executable, str(HELPER), action, "--target", str(target)],
                    capture_output=True, text=True, check=False,
                )

            installed = run("install")
            self.assertEqual(installed.returncode, 0, installed.stderr)
            checked = run("check")
            self.assertEqual(checked.returncode, 0, checked.stderr)
            (target / "tmp").chmod(0o755)
            rejected = run("check")
            self.assertEqual(rejected.returncode, 2)
            self.assertIn("/tmp must have mode 1777", rejected.stderr)

    def test_duplicate_traversal_and_dev_workspace_are_rejected(self):
        layout = load_module()
        for unsafe in ("../etc", "/etc", "workspace", "a/b", "dup"):
            contract = self.contract()
            contract["rootfs"]["runtime_directories"].append(unsafe)
            if unsafe == "dup":
                contract["rootfs"]["runtime_directories"].append("dup")
            with self.assertRaises(layout.StableRuntimeLayoutError):
                layout.runtime_directories(contract)
        contract = self.contract()
        contract["rootfs"]["runtime_directories"].remove("tmp")
        with self.assertRaisesRegex(layout.StableRuntimeLayoutError, "volatile mounts"):
            layout.runtime_directories(contract)


if __name__ == "__main__":
    unittest.main()
