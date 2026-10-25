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
WORKFLOW_PATH = ROOT / ".github/workflows/independent-surface-runtime.yml"


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

    def make_tar(self, paths, *, empty=(), nonexec=(), symlinks=None):
        tmp = tempfile.TemporaryDirectory()
        path = Path(tmp.name) / "rootfs.tar"
        symlinks = symlinks or {}
        with tarfile.open(path, "w") as archive:
            for name in sorted(paths):
                info = tarfile.TarInfo(name)
                info.mode = 0o755 if "/bin/" in f"/{name}" or name.startswith(("bin/", "sbin/", "usr/bin/")) else 0o644
                if name in nonexec:
                    info.mode = 0o644
                if name in symlinks:
                    info.type = tarfile.SYMTYPE
                    info.linkname = symlinks[name]
                    archive.addfile(info)
                else:
                    data = b"" if name in empty else b"x"
                    info.size = len(data)
                    archive.addfile(info, io.BytesIO(data))
        self.addCleanup(tmp.cleanup)
        return path

    def buildroot_like_paths(self, *, omit=(), extra=()):
        required = set(self.source["required_runtime_paths"])
        required.discard("bin/udevadm")
        required.discard("usr/lib/udev/rules.d/60-input-id.rules")
        required.add("usr/bin/udevadm")
        required.add("lib/udev/rules.d/60-input-id.rules")
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

    def test_ssot_paths_remain_posix_when_host_paths_are_windows_style(self):
        # Signed contracts use slash-separated paths on Linux and Windows.
        from pathlib import PureWindowsPath
        from unittest import mock

        with mock.patch.object(
            Path, "relative_to",
            return_value=PureWindowsPath(r"bootstrap\independent-base\source.json"),
        ):
            source, _ = self.builder.contracts()
        self.assertEqual(
            source["buildroot_source_contract"],
            "bootstrap/independent-base/source.json",
        )

        config_path = ROOT / "bootstrap/independent-surface-runtime/prepare_config.py"
        spec = importlib.util.spec_from_file_location("surface_ssot_config", config_path)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with mock.patch.object(
            Path, "relative_to",
            return_value=PureWindowsPath(r"bootstrap\kernel\source.json"),
        ):
            self.assertRegex(module.kernel_version(), r"^\d+\.\d+\.\d+$")

    def test_profile_selects_full_graphical_parity_without_package_manager(self):
        text = CONFIG_PATH.read_text(encoding="utf-8")
        for marker in (
            "BR2_TOOLCHAIN_BUILDROOT_MUSL=y",
            "BR2_SHARED_LIBS=y",
            "BR2_CCACHE=y",
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
            "BR2_PACKAGE_GSTREAMER1=y",
            "BR2_PACKAGE_GSTREAMER1_INSTALL_TOOLS=y",
            "BR2_PACKAGE_GST1_PLUGINS_BASE=y",
            "BR2_PACKAGE_GST1_PLUGINS_GOOD=y",
            "BR2_PACKAGE_GST1_PLUGINS_GOOD_PLUGIN_PULSE=y",
            "BR2_PACKAGE_GST1_LIBAV=y",
            "BR2_PACKAGE_PIPEWIRE=y",
            "BR2_PACKAGE_PIPEWIRE_GSTREAMER=y",
            "BR2_PACKAGE_PULSEAUDIO=y",
            "BR2_PACKAGE_LUA=y",
            "BR2_PACKAGE_LUA_5_4=y",
            "BR2_PACKAGE_WIREPLUMBER=y",
            "BR2_PACKAGE_DBUS=y",
        ):
            self.assertIn(marker, text)
        upper = text.upper()
        self.assertNotIn("BR2_ROOTFS_MERGED_USR=Y", upper)
        self.assertNotIn("BR2_PACKAGE_OPKG", upper)
        self.assertNotIn("BR2_PACKAGE_RPM", upper)
        self.assertNotIn("BR2_STATIC_LIBS=Y", upper)

    def test_buildroot_runtime_preserves_media_probe_dependencies(self):
        # Audio/video capabilities formerly provided by APK must be part
        # of the same immutable Buildroot Surface artifact.
        expected = {
            "usr/bin/gst-inspect-1.0",
            "usr/bin/gst-launch-1.0",
            "usr/bin/pipewire",
            "usr/bin/wireplumber",
            "usr/bin/pactl",
            "usr/lib/gstreamer-1.0/libgstpipewire.so",
            "usr/lib/gstreamer-1.0/libgstpulse.so",
            "usr/lib/gstreamer-1.0/libgstlibav.so",
        }
        self.assertTrue(expected.issubset(self.source["required_runtime_paths"]))
        config = CONFIG_PATH.read_text(encoding="utf-8")
        # Buildroot's python-gobject Kconfig selects GObject Introspection;
        # its derived symbol belongs in the resolved-Kconfig verifier, not
        # necessarily in the source defconfig.
        self.assertIn("BR2_PACKAGE_PYTHON_GOBJECT=y", config)
        self.assertIn(
            "BR2_PACKAGE_GOBJECT_INTROSPECTION=y",
            self.builder.GRAPHICAL_KCONFIG_REQUIRED,
        )
        self.assertNotIn("BR2_PACKAGE_PULSEAUDIO_DAEMON=y", config)

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
        self.assertTrue(by_name["lib/udev/rules.d/60-input-id.rules"].isfile())
        self.assertTrue(by_name["bin/udevadm"].issym())
        self.assertEqual(by_name["bin/udevadm"].linkname, "../usr/bin/udevadm")
        self.assertTrue(by_name["usr/lib/udev/rules.d/60-input-id.rules"].issym())
        self.assertEqual(
            by_name["usr/lib/udev/rules.d/60-input-id.rules"].linkname,
            "../../../../lib/udev/rules.d/60-input-id.rules",
        )

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
        for missing in ("usr/bin/udevadm", "lib/udev/rules.d/60-input-id.rules"):
            with self.subTest(missing=missing):
                tar_path = self.make_tar(self.buildroot_like_paths(omit={missing}))
                with self.assertRaisesRegex(self.builder.SurfaceBuildError, "Buildroot eudev did not provide"):
                    self.builder.ensure_surface_runtime_path_compatibility(tar_path)

    def test_runtime_rejects_empty_or_nonexecutable_graphical_dependencies(self):
        required = self.buildroot_like_paths()
        cases = (
            ({"usr/lib/girepository-1.0/WebKit2-4.1.typelib"}, (), "empty"),
            ({"usr/bin/cage"}, (), "empty"),
            ((), {"usr/bin/cage"}, "not executable"),
        )
        for empty, nonexec, reason in cases:
            with self.subTest(empty=empty, nonexec=nonexec):
                tar_path = self.make_tar(required, empty=empty, nonexec=nonexec)
                self.builder.ensure_surface_runtime_path_compatibility(tar_path)
                with self.assertRaisesRegex(self.builder.SurfaceBuildError, reason):
                    self.builder.inspect_rootfs_tar(tar_path, self.source)

    def test_runtime_rejects_dangling_symlink_and_tar_shadowing(self):
        required = self.buildroot_like_paths()
        tar_path = self.make_tar(required, symlinks={"usr/bin/cage": "../../../../outside"})
        self.builder.ensure_surface_runtime_path_compatibility(tar_path)
        with self.assertRaises(self.builder.SurfaceBuildError):
            self.builder.inspect_rootfs_tar(tar_path, self.source)

        tar_path = self.make_tar(required)
        with tarfile.open(tar_path, "a:") as archive:
            info = tarfile.TarInfo("usr/bin/cage")
            data = b"replacement"
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
        with self.assertRaisesRegex(self.builder.SurfaceBuildError, "duplicate Surface runtime tar member"):
            self.builder.ensure_surface_runtime_path_compatibility(tar_path)

    def test_runtime_rejects_unsafe_absolute_and_parent_tar_paths(self):
        for injected in ("/etc/alpine-release", "../outside"):
            with self.subTest(injected=injected):
                tar_path = self.make_tar(self.buildroot_like_paths())
                with tarfile.open(tar_path, "a:") as archive:
                    data = b"unexpected"
                    entry = tarfile.TarInfo(injected)
                    entry.size = len(data)
                    archive.addfile(entry, io.BytesIO(data))
                with self.assertRaisesRegex(self.builder.SurfaceBuildError, "unsafe Surface runtime tar member"):
                    self.builder.ensure_surface_runtime_path_compatibility(tar_path)

    def test_resolved_kconfig_only_counts_exact_active_unique_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".config"
            path.write_text(
                "# BR2_PACKAGE_CAGE=y\n"
                "BR2_PACKAGE_CAGE=n\n"
                "BR2_PACKAGE_WEBKITGTK=y\n",
                encoding="utf-8",
            )
            settings = self.builder.resolved_kconfig(path)
            self.assertEqual(settings["BR2_PACKAGE_CAGE"], "n")
            self.assertEqual(settings["BR2_PACKAGE_WEBKITGTK"], "y")
            path.write_text(
                "BR2_PACKAGE_CAGE=y\nBR2_PACKAGE_CAGE=n\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(self.builder.SurfaceBuildError, "duplicate resolved Buildroot option"):
                self.builder.resolved_kconfig(path)

    def test_workflow_reuses_buildroot_downloads_and_compiler_outputs(self):
        text = WORKFLOW_PATH.read_text(encoding="utf-8")
        for marker in (
            "Restore exact Surface compiler cache on durable artifact miss",
            "ordax-independent-surface-ccache-v1-",
            "Restore Surface Buildroot source downloads on durable artifact miss",
            "ordax-independent-surface-dl-v1-",
            "BR2_CCACHE_DIR:",
            "BR2_DL_DIR:",
            "Save Surface Buildroot source download cache",
            "Sanitize reusable Surface download cache",
        ):
            self.assertIn(marker, text)
        self.assertIn("restore-keys:", text)
        self.assertIn("-name '*.tmp'", text)
        self.assertIn("-name '*.part'", text)
        self.assertIn("-name '*.lock'", text)

    def test_long_build_is_not_cancelled_by_noncausal_pr_updates(self):
        workflow = (ROOT / ".github/workflows/independent-surface-runtime.yml").read_text()
        self.assertIn("  cancel-in-progress: false", workflow)
        self.assertIn("needs: buildroot-surface", workflow)
        self.assertIn("Verify Surface reuse against current integration commit", workflow)

    def test_workflow_reuses_canonical_qemu_with_same_buildroot_artifact(self):
        text = WORKFLOW_PATH.read_text(encoding="utf-8")
        self.assertIn("if-no-files-found: error", text)
        self.assertIn("portable-qemu:", text)
        self.assertIn("needs: buildroot-surface", text)
        self.assertIn("uses: ./.github/workflows/portable-v2-qemu-boot-proof.yml", text)
        self.assertIn("base_source: independent", text)
        self.assertIn("surface_source: independent", text)
        self.assertIn("force_run: true", text)
        self.assertIn("actions: read", text)
        self.assertNotIn("qemu-system-x86_64", text)

    def test_check_is_side_effect_free(self):
        self.builder.check()


if __name__ == "__main__":
    unittest.main()
