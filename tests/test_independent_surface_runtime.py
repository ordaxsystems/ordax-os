import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BUILDER_PATH = ROOT / "bootstrap/independent-surface-runtime/build.py"
SOURCE_PATH = ROOT / "bootstrap/independent-surface-runtime/source.json"
CONFIG_PATH = ROOT / "bootstrap/independent-surface-runtime/configs/ordax_surface_defconfig"


def load_builder():
    spec = importlib.util.spec_from_file_location("independent_surface_runtime_build", BUILDER_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class IndependentSurfaceRuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.builder = load_builder()
        cls.source = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))

    def make_tar(self, paths):
        tmp = tempfile.TemporaryDirectory()
        path = Path(tmp.name) / "rootfs.tar"
        with tarfile.open(path, "w") as archive:
            for name in sorted(paths):
                data = b"x"
                info = tarfile.TarInfo(name)
                info.size = len(data)
                info.mode = 0o755 if "/bin/" in f"/{name}" or name.startswith(("bin/", "sbin/", "usr/bin/")) else 0o644
                archive.addfile(info, io.BytesIO(data))
        self.addCleanup(tmp.cleanup)
        return path

    def buildroot_like_paths(self, *, omit=(), extra=()):
        required = set(self.source["required_runtime_paths"])
        required.discard("bin/udevadm")
        required.add("usr/bin/udevadm")
        required.difference_update(omit)
        required.update(extra)
        return required

    def test_contract_is_buildroot_musl_and_non_promotable(self):
        source, base = self.builder.contracts()
        self.assertEqual(source["libc"], "musl")
        self.assertEqual(source["buildroot_source_contract"], "bootstrap/independent-base/source.json")
        self.assertEqual(base["buildroot"]["version"], "2026.08")
        self.assertFalse(source["artifact"]["physical_artifact_authorized"])
        self.assertFalse(source["artifact"]["stable_promotion_authorized"])
        self.assertFalse(source["package_manager_in_runtime_allowed"])
        self.assertIn("bin/udevadm", source["required_runtime_paths"])
        self.assertIn("usr/lib/udev/rules.d/60-input-id.rules", source["required_runtime_paths"])

    def test_profile_selects_full_graphical_parity_without_package_manager(self):
        text = CONFIG_PATH.read_text(encoding="utf-8")
        for marker in (
            "BR2_TOOLCHAIN_BUILDROOT_MUSL=y",
            "BR2_SHARED_LIBS=y",
            "BR2_PACKAGE_EUDEV=y",
            "BR2_PACKAGE_CAGE=y",
            "BR2_PACKAGE_WEBKITGTK=y",
            "BR2_PACKAGE_WEBKITGTK_WAYLAND=y",
            "BR2_PACKAGE_WEBKITGTK_HTTPS=y",
            "BR2_PACKAGE_WEBKITGTK_SANDBOX=y",
            "BR2_PACKAGE_WEBKITGTK_MULTIMEDIA=y",
            "BR2_PACKAGE_LIBGTK3=y",
            "BR2_PACKAGE_LIBGTK3_WAYLAND=y",
            "BR2_PACKAGE_PYTHON_GOBJECT=y",
            "BR2_PACKAGE_XWAYLAND=y",
            "BR2_PACKAGE_SEATD=y",
        ):
            self.assertIn(marker, text)
        upper = text.upper()
        self.assertNotIn("BR2_PACKAGE_OPKG", upper)
        self.assertNotIn("BR2_PACKAGE_RPM", upper)
        self.assertNotIn("BR2_STATIC_LIBS=Y", upper)

    def test_builder_preserves_existing_surface_eudev_path_abi(self):
        tar_path = self.make_tar(self.buildroot_like_paths())
        links = self.builder.ensure_surface_runtime_path_compatibility(tar_path)
        self.assertEqual(links, self.builder.SURFACE_COMPAT_LINKS)
        with tarfile.open(tar_path, "r:") as archive:
            by_name = {
                self.builder.normalized_member_name(member.name): member
                for member in archive.getmembers()
            }
        self.assertTrue(by_name["usr/bin/udevadm"].isfile())
        self.assertTrue(by_name["usr/lib/udev/rules.d/60-input-id.rules"].isfile())
        self.assertTrue(by_name["bin/udevadm"].issym())
        self.assertEqual(by_name["bin/udevadm"].linkname, "../usr/bin/udevadm")

    def test_rootfs_inventory_accepts_required_paths_and_rejects_apk(self):
        required = set(self.source["required_runtime_paths"])
        good = self.make_tar(self.buildroot_like_paths(extra={"etc/os-release"}))
        self.builder.ensure_surface_runtime_path_compatibility(good)
        result = self.builder.inspect_rootfs_tar(good, self.source)
        self.assertTrue(result["apk_runtime_absent"])
        self.assertEqual(result["required_runtime_paths"], sorted(required))
        self.assertEqual(result["compatibility_links"], self.builder.SURFACE_COMPAT_LINKS)

        bad = self.make_tar(self.buildroot_like_paths(extra={"sbin/apk", "lib/apk/db/installed"}))
        self.builder.ensure_surface_runtime_path_compatibility(bad)
        with self.assertRaisesRegex(self.builder.SurfaceBuildError, "Alpine/APK payload leaked"):
            self.builder.inspect_rootfs_tar(bad, self.source)

    def test_rootfs_inventory_fails_when_surface_dependency_is_missing(self):
        tar_path = self.make_tar(self.buildroot_like_paths(omit={"usr/bin/cage"}))
        self.builder.ensure_surface_runtime_path_compatibility(tar_path)
        with self.assertRaisesRegex(self.builder.SurfaceBuildError, "missing required paths"):
            self.builder.inspect_rootfs_tar(tar_path, self.source)

    def test_eudev_abi_fails_closed_if_native_targets_are_missing(self):
        for missing in ("usr/bin/udevadm", "usr/lib/udev/rules.d/60-input-id.rules"):
            with self.subTest(missing=missing):
                tar_path = self.make_tar(self.buildroot_like_paths(omit={missing}))
                with self.assertRaisesRegex(self.builder.SurfaceBuildError, "Buildroot eudev did not provide"):
                    self.builder.ensure_surface_runtime_path_compatibility(tar_path)

    def test_check_is_side_effect_free(self):
        self.builder.check()


if __name__ == "__main__":
    unittest.main()
