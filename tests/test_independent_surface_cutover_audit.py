from pathlib import Path
import importlib.util
import json
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools/ci/independent_surface_cutover_audit.py"
SPEC = importlib.util.spec_from_file_location("independent_surface_cutover_audit", MODULE_PATH)
assert SPEC and SPEC.loader
AUDIT = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = AUDIT
SPEC.loader.exec_module(AUDIT)


class IndependentSurfaceCutoverAuditTests(unittest.TestCase):
    def make_tree(self, base: Path, *, cutover: bool) -> Path:
        for relative in (
            "bootstrap/base/alpine_core.py",
            "bootstrap/stable-base/build.py",
            "bootstrap/stable-base/source.json",
        ):
            path = base / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("stable alpine owner intentionally preserved\n", encoding="utf-8")

        cache = base / "tools/ci/portable_component_cache.py"
        cache.parent.mkdir(parents=True, exist_ok=True)

        canonical = base / "bootstrap/surface-runtime"
        canonical.mkdir(parents=True, exist_ok=True)
        if cutover:
            (canonical / "build.py").write_text("# buildroot musl surface\n", encoding="utf-8")
            (canonical / "source.json").write_text(
                json.dumps({"libc": "musl", "package_manager_in_runtime_allowed": False}) + "\n",
                encoding="utf-8",
            )
            cache.write_text(
                '"surface": {"inputs": ("bootstrap/surface-runtime/build.py",)}\n',
                encoding="utf-8",
            )
        else:
            (canonical / "build.py").write_text("apk add cage webkitgtk\n", encoding="utf-8")
            (canonical / "source.json").write_text(
                json.dumps({"apk_package_lock": {"cage": "x"}}) + "\n",
                encoding="utf-8",
            )
            discover = canonical / "discover_lock.py"
            discover.write_text("# apk lock discovery\n", encoding="utf-8")
            workflow = base / ".github/workflows/surface-runtime-lock-discovery.yml"
            workflow.parent.mkdir(parents=True, exist_ok=True)
            workflow.write_text("name: Surface APK lock\n", encoding="utf-8")
            cache.write_text(
                '"surface": {"inputs": ("bootstrap/base/alpine_core.py",)}\n',
                encoding="utf-8",
            )

        independent = base / "bootstrap/independent-surface-runtime"
        if not cutover:
            independent.mkdir(parents=True, exist_ok=True)
            (independent / "build.py").write_text("# buildroot musl\n", encoding="utf-8")
            (independent / "source.json").write_text(
                json.dumps({"libc": "musl", "package_manager_in_runtime_allowed": False}) + "\n",
                encoding="utf-8",
            )
        return base

    def test_pre_cutover_accepts_clean_independent_owner_and_preserved_legacy(self):
        with tempfile.TemporaryDirectory() as td:
            root = self.make_tree(Path(td), cutover=False)
            result = AUDIT.audit_pre(root)
            self.assertEqual(result.status, "pass")
            self.assertTrue(result.checks["stable_base_alpine_owner_preserved"])

    def test_pre_cutover_rejects_alpine_apk_leak_in_independent_owner(self):
        with tempfile.TemporaryDirectory() as td:
            root = self.make_tree(Path(td), cutover=False)
            (root / "bootstrap/independent-surface-runtime/build.py").write_text(
                "apk add webkitgtk\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(AUDIT.AuditError, "pre-cutover"):
                AUDIT.audit_pre(root)

    def test_post_cutover_is_intentionally_red_for_current_legacy_shape(self):
        with tempfile.TemporaryDirectory() as td:
            root = self.make_tree(Path(td), cutover=False)
            with self.assertRaisesRegex(AUDIT.AuditError, "post-cutover"):
                AUDIT.audit_post(root)

    def test_post_cutover_accepts_buildroot_surface_but_preserves_stable_base_alpine(self):
        with tempfile.TemporaryDirectory() as td:
            root = self.make_tree(Path(td), cutover=True)
            result = AUDIT.audit_post(root)
            self.assertEqual(result.status, "pass")
            self.assertTrue(result.checks["canonical_surface_alpine_apk_free"])
            self.assertTrue(result.checks["stable_base_alpine_owner_preserved_for_later_gate"])

    def test_real_repository_is_valid_pre_cutover(self):
        result = AUDIT.audit_pre(ROOT)
        self.assertEqual(result.status, "pass")


if __name__ == "__main__":
    unittest.main()
