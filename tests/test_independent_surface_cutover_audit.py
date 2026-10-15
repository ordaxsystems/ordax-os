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

        launcher = base / "system/surface/bin/ordax-surface"
        launcher.parent.mkdir(parents=True, exist_ok=True)
        if cutover:
            launcher.write_text(
                "#!/bin/sh\nRUNTIME_ROOT=${ORDAX_SURFACE_RUNTIME_ROOT:?verified runtime required}\n",
                encoding="utf-8",
            )
        else:
            launcher.write_text(
                "#!/bin/sh\nRUNTIME_ID=alpine-v3.22-cage-webkitgtk-v1\n"
                "run_bounded_apk() { /sbin/apk \"$@\"; }\n",
                encoding="utf-8",
            )

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
            self.assertTrue(result.checks["surface_contract_uses_musl"])
            self.assertTrue(result.checks["surface_contract_forbids_runtime_package_manager"])
            self.assertTrue(result.checks["legacy_surface_launcher_still_present"])
            self.assertTrue(result.checks["stable_base_alpine_owner_preserved"])

    def test_generated_python_cache_is_not_treated_as_operational_surface_source(self):
        with tempfile.TemporaryDirectory() as td:
            root = self.make_tree(Path(td), cutover=False)
            cache = root / "bootstrap/independent-surface-runtime/__pycache__/build.cpython-312.pyc"
            cache.parent.mkdir(parents=True)
            cache.write_bytes(b"\xcb\x00apk add deliberately-not-source")
            result = AUDIT.audit_pre(root)
            self.assertEqual(result.status, "pass")

    def test_pre_cutover_rejects_alpine_apk_leak_in_independent_owner(self):
        with tempfile.TemporaryDirectory() as td:
            root = self.make_tree(Path(td), cutover=False)
            (root / "bootstrap/independent-surface-runtime/build.py").write_text(
                "apk add webkitgtk\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(AUDIT.AuditError, "pre-cutover"):
                AUDIT.audit_pre(root)

    def test_pre_cutover_rejects_non_musl_or_runtime_package_manager_contract(self):
        for source in (
            {"libc": "glibc", "package_manager_in_runtime_allowed": False},
            {"libc": "musl", "package_manager_in_runtime_allowed": True},
        ):
            with self.subTest(source=source), tempfile.TemporaryDirectory() as td:
                root = self.make_tree(Path(td), cutover=False)
                (root / "bootstrap/independent-surface-runtime/source.json").write_text(
                    json.dumps(source) + "\n", encoding="utf-8"
                )
                with self.assertRaisesRegex(AUDIT.AuditError, "pre-cutover"):
                    AUDIT.audit_pre(root)

    def test_post_cutover_is_intentionally_red_for_current_legacy_shape(self):
        with tempfile.TemporaryDirectory() as td:
            root = self.make_tree(Path(td), cutover=False)
            with self.assertRaisesRegex(AUDIT.AuditError, "post-cutover"):
                AUDIT.audit_post(root)

    def test_post_cutover_rejects_leftover_alpine_launcher_provisioning(self):
        with tempfile.TemporaryDirectory() as td:
            root = self.make_tree(Path(td), cutover=True)
            (root / "system/surface/bin/ordax-surface").write_text(
                "RUNTIME_ID=alpine-v3.22-cage-webkitgtk-v1\nrun_bounded_apk() { /sbin/apk \"$@\"; }\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(AUDIT.AuditError, "post-cutover"):
                AUDIT.audit_post(root)

    def test_post_cutover_accepts_buildroot_surface_but_preserves_stable_base_alpine(self):
        with tempfile.TemporaryDirectory() as td:
            root = self.make_tree(Path(td), cutover=True)
            result = AUDIT.audit_post(root)
            self.assertEqual(result.status, "pass")
            self.assertTrue(result.checks["canonical_surface_no_operational_alpine_apk_dependency"])
            self.assertTrue(result.checks["surface_contract_uses_musl"])
            self.assertTrue(result.checks["surface_contract_forbids_runtime_package_manager"])
            self.assertTrue(result.checks["surface_launcher_alpine_provisioning_removed"])
            self.assertTrue(result.checks["stable_base_alpine_owner_preserved_for_later_gate"])

    def test_real_repository_is_valid_pre_cutover(self):
        result = AUDIT.audit_pre(ROOT)
        self.assertEqual(result.status, "pass")


if __name__ == "__main__":
    unittest.main()
