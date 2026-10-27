import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
BUILDER_PATH = ROOT / "bootstrap/surface-runtime/build.py"
SOURCE_PATH = ROOT / "bootstrap/surface-runtime/source.json"
CONFIG_PATH = ROOT / "bootstrap/surface-runtime/configs/ordax_surface_defconfig"
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

    def test_bounded_build_streams_progress_and_retains_only_failure_tail(self):
        output = io.StringIO()
        program = (
            "import sys;"
            "print('BEGIN_TOOLCHAIN', flush=True);"
            "print('x' * 30000, flush=True);"
            "print('END_TOOLCHAIN', flush=True)"
        )
        with contextlib.redirect_stdout(output):
            tail = self.builder.run([sys.executable, "-c", program], bounded=True)
        self.assertIn("BEGIN_TOOLCHAIN", output.getvalue())
        self.assertIn("END_TOOLCHAIN", output.getvalue())
        self.assertLessEqual(len(tail.encode("utf-8")), 20000)
        self.assertNotIn("BEGIN_TOOLCHAIN", tail)
        self.assertIn("END_TOOLCHAIN", tail)

        failure = io.StringIO()
        with contextlib.redirect_stdout(failure):
            with self.assertRaisesRegex(self.builder.SurfaceBuildError, r"failed \(7\)") as raised:
                self.builder.run(
                    [sys.executable, "-c",
                     "import sys;print('COMPILER_FAILED', flush=True);sys.exit(7)"],
                    bounded=True,
                )
        self.assertIn("COMPILER_FAILED", failure.getvalue())
        self.assertIn("COMPILER_FAILED", str(raised.exception))

    def test_persistent_buildroot_workspace_resume_uses_exact_native_inputs(self):
        builder = self.builder
        with tempfile.TemporaryDirectory() as td:
            work = Path(td) / "native-buildroot"
            # Production creates the dedicated directory under its flock.
            work.mkdir(mode=0o700)
            archive = Path(td) / "fake-pinned-source.tar.xz"
            archive.write_bytes(b"test-only")
            _, base = builder.contracts()
            extraction_count = []

            def fake_extract(_archive, where, version):
                extraction_count.append(1)
                path = where / f"buildroot-{version}"
                path.mkdir()
                (path / "Makefile").write_text("all:\n\t@true\n", encoding="utf-8")
                return path

            with mock.patch.object(builder, "safe_unpack", side_effect=fake_extract):
                first = builder.materialize_surface_workspace(archive, base, work)
                self.assertTrue((first / "Makefile").exists())
                self.assertEqual(
                    builder.materialize_surface_workspace(archive, base, work), first
                )
                self.assertEqual(len(extraction_count), 1)
                with mock.patch.object(builder, "workspace_identity", return_value={"modified": True}):
                    with self.assertRaisesRegex(builder.SurfaceBuildError, "inputs changed"):
                        builder.materialize_surface_workspace(archive, base, work)

    def test_incomplete_or_symlinked_workspace_is_rejected_without_cleanup(self):
        builder = self.builder
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            work = root / "incomplete"
            work.mkdir()
            (work / "incomplete-build").write_text("preserve", encoding="utf-8")
            _, base = builder.contracts()
            with self.assertRaisesRegex(builder.SurfaceBuildError, "unsealed"):
                builder.materialize_surface_workspace(root / "dummy", base, work)
            self.assertTrue((work / "incomplete-build").exists())
            marker = work / ".ordax-surface-workspace.json"
            marker.symlink_to(work / "incomplete-build")
            with self.assertRaisesRegex(builder.SurfaceBuildError, "unsafe"):
                builder.materialize_surface_workspace(root / "dummy", base, work)

    def test_verified_workspace_can_resume_without_reopening_buildroot_upstream(self):
        builder = self.builder
        with tempfile.TemporaryDirectory() as td:
            work = Path(td) / "work"
            work.mkdir()
            _, base = builder.contracts()
            version = base["buildroot"]["version"]
            source = work / f"buildroot-{version}"
            source.mkdir()
            (source / "Makefile").write_text("all:\n\t@true\n", encoding="utf-8")
            receipt = work / ".ordax-surface-workspace.json"
            receipt.write_text(json.dumps(builder.workspace_identity(base)), encoding="utf-8")
            with mock.patch.object(builder, "source_archive", side_effect=AssertionError("network download forbidden")):
                self.assertEqual(builder.materialize_surface_workspace(None, base, work), source)
            build_code = (ROOT / "bootstrap/surface-runtime/build.py").read_text(encoding="utf-8")
            self.assertIn(
                "archive = None if receipt.exists() or receipt.is_symlink() else source_archive(base, cache_dir)",
                build_code,
            )
            receipt.unlink()
            with self.assertRaisesRegex(builder.SurfaceBuildError, "unsealed"):
                builder.materialize_surface_workspace(None, base, work)
        # First extraction still requires an archive whose SHA-256 was verified
        # by source_archive, regardless of whether a persistent root was set.
        with tempfile.TemporaryDirectory() as td:
            work = Path(td)
            with self.assertRaisesRegex(builder.SurfaceBuildError, "requires a pinned archive"):
                builder.materialize_surface_workspace(None, base, work)

    def test_resumed_surface_config_skips_defconfig_and_keeps_build_stamps(self):
        builder = self.builder
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            work = root / "trusted-work"
            work.mkdir()
            tree = root / "buildroot"
            tree.mkdir()
            build_dir = work / "build"
            build_dir.mkdir()
            source = root / "source.defconfig"
            source.write_text("BR2_x86_64=y\n", encoding="utf-8")
            config = build_dir / ".config"
            # Isolate the generated Buildroot content from the runner itself.
            with mock.patch.object(builder, "run") as make, mock.patch.object(
                builder, "verify_build_config", side_effect=lambda _: builder.sha256_file(config)
            ):
                make.side_effect = lambda *_: config.write_text("BR2_x86_64=y\n", encoding="utf-8")
                first = builder.prepare_surface_config(tree, build_dir, source, work, persistent=True)
                stamp = build_dir / "build/host-webkit/.stamp_built"
                stamp.parent.mkdir(parents=True)
                stamp.write_text("keep", encoding="utf-8")
                second = builder.prepare_surface_config(tree, build_dir, source, work, persistent=True)
                self.assertEqual(first, second)
                make.assert_called_once()
                self.assertEqual(stamp.read_text(encoding="utf-8"), "keep")
                source.write_text("BR2_x86_64=y\nBR2_PACKAGE_WEBKITGTK=y\n", encoding="utf-8")
                with self.assertRaisesRegex(builder.SurfaceBuildError, "defconfig changed"):
                    builder.prepare_surface_config(tree, build_dir, source, work, persistent=True)
                self.assertEqual(make.call_count, 1)

    def test_resumed_surface_config_rejects_tampering_and_unsealed_state(self):
        builder = self.builder
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = root / "source.defconfig"
            source.write_text("BR2_x86_64=y\n", encoding="utf-8")
            tree, work, build_dir = root / "src", root / "work", root / "work/build"
            tree.mkdir()
            work.mkdir()
            build_dir.mkdir()
            config = build_dir / ".config"
            config.write_text("BR2_x86_64=y\n", encoding="utf-8")
            with self.assertRaisesRegex(builder.SurfaceBuildError, "unsealed"):
                builder.prepare_surface_config(tree, build_dir, source, work, persistent=True)
            config.unlink()
            with mock.patch.object(builder, "run") as make, mock.patch.object(
                builder, "verify_build_config", side_effect=lambda _: builder.sha256_file(config)
            ):
                make.side_effect = lambda *_: config.write_text("BR2_x86_64=y\n", encoding="utf-8")
                builder.prepare_surface_config(tree, build_dir, source, work, persistent=True)
                config.write_text("BR2_x86_64=y\nBR2_PACKAGE_CAGE=y\n", encoding="utf-8")
                with self.assertRaisesRegex(builder.SurfaceBuildError, "bytes changed"):
                    builder.prepare_surface_config(tree, build_dir, source, work, persistent=True)
                config.unlink()
                with self.assertRaisesRegex(builder.SurfaceBuildError, "missing"):
                    builder.prepare_surface_config(tree, build_dir, source, work, persistent=True)

    def test_surface_producer_build_step_has_one_environment_mapping(self):
        workflow = WORKFLOW_PATH.read_text(encoding="utf-8")
        build_step = workflow.split(
            "      - name: Build Buildroot/musl Surface runtime on durable artifact miss", 1
        )[1].split("      - name: Verify exact Independent Surface EROFS bytes", 1)[0]
        self.assertEqual(build_step.count("\n        env:\n"), 1)
        self.assertIn("ORDAX_SOURCE_COMMIT:", build_step)
        self.assertIn("ORDAX_SURFACE_BUILD_JOBS:", build_step)
        self.assertIn("work_args", build_step)
        self.assertIn("ORDAX_SURFACE_BUILD_JOBS", build_step)

    def test_persistent_graphical_cache_is_same_for_kconfig_and_make_and_not_uploaded(self):
        workflow = WORKFLOW_PATH.read_text(encoding="utf-8")
        resolver = workflow.split(
            "      - name: Resolve exact Surface artifact fingerprint", 1
        )[1].split("      - name: Restore verified Independent Surface EROFS component", 1)[0]
        self.assertIn('echo "BR2_CCACHE_DIR=$cache_root/ccache"', resolver)
        self.assertIn('echo "BR2_DL_DIR=$cache_root/downloads"', resolver)
        self.assertIn('echo "BR2_CCACHE_DIR=$cache_root/ordax-independent-surface-ccache"', resolver)
        self.assertIn('echo "BR2_DL_DIR=$cache_root/ordax-independent-surface-dl"', resolver)
        self.assertIn('if [ "${RUNNER_ENVIRONMENT:-}" != "self-hosted" ]; then', resolver)
        self.assertIn('if [ -z "${ORDAX_SURFACE_PRODUCER_ENVIRONMENT:-}" ]; then', resolver)
        self.assertIn('cache_root="$(realpath -m -- "$ORDAX_SURFACE_PERSISTENT_WORK_ROOT")"', resolver)
        self.assertIn("Surface persistent cache must be outside workspace and runner temp", resolver)
        config = workflow.split(
            "      - name: Resolve exact Kconfig before expensive graphical build", 1
        )[1].split("      - name: Build Buildroot/musl Surface runtime on durable artifact miss", 1)[0]
        build = workflow.split(
            "      - name: Build Buildroot/musl Surface runtime on durable artifact miss", 1
        )[1].split("      - name: Verify exact Independent Surface EROFS bytes", 1)[0]
        self.assertNotIn('BR2_CCACHE_DIR: ${{ runner.temp }}', config + build)
        self.assertNotIn('BR2_DL_DIR: ${{ runner.temp }}', config + build)
        for name in (
            "Restore exact Surface compiler cache on durable artifact miss",
            "Restore Surface Buildroot source downloads on durable artifact miss",
            "Save Surface Buildroot source download cache",
            "Save exact Surface compiler cache",
        ):
            section = workflow.split("      - name: " + name, 1)[1].split("\n      - name:", 1)[0]
            self.assertIn("env.ORDAX_SURFACE_PERSISTENT_WORK_ROOT == ''", section)
        self.assertIn('find "${BR2_DL_DIR:-$RUNNER_TEMP/ordax-independent-surface-dl}"', workflow)

    def test_builder_exposes_opt_in_persistent_workspace_without_changing_ephemeral_default(self):
        source = BUILDER_PATH.read_text(encoding="utf-8")
        self.assertIn('build_parser.add_argument("--work-dir"', source)
        self.assertIn('persistent_work_dir=args.work_dir', source)
        self.assertIn('if transient:', source)
        self.assertIn('if lock_fd is not None:', source)
        self.assertIn('fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)', source)
        self.assertIn('if transient:\n            shutil.rmtree(work, ignore_errors=True)', source)

    def test_buildroot_has_a_bounded_group_timeout_before_ci_job_deadline(self):
        source = BUILDER_PATH.read_text(encoding="utf-8")
        self.assertIn('"timeout", "--signal=TERM", "--kill-after=60s", "330m"', source)
        self.assertIn('for program in ("make", "timeout",', source)
        self.assertNotIn('process.stdout.read(65536)', source)

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
        self.assertTrue({"usr/share/X11/xkb/rules/evdev", "usr/share/X11/xkb/symbols/br",
                         "usr/share/X11/xkb/symbols/us"}.issubset(source["required_runtime_paths"]))

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

        config_path = ROOT / "bootstrap/surface-runtime/prepare_config.py"
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
            "BR2_PACKAGE_XKEYBOARD_CONFIG=y",
            "BR2_PACKAGE_MESA3D_LLVM=y",
            "BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_I915=y",
            "BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_CROCUS=y",
            "BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_IRIS=y",
            "BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_SOFTPIPE=y",
            "BR2_PACKAGE_MESA3D_OPENGL_GLX=y",
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
            "usr/lib/gstreamer-1.0/libgstpulseaudio.so",
            "usr/lib/gstreamer-1.0/libgstlibav.so",
        }
        self.assertNotIn("usr/lib/gstreamer-1.0/libgstpulse.so", self.source["required_runtime_paths"])
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

    def test_buildroot_xkb_database_missing_or_empty_rejects_surface_image(self):
        # A linked libxkbcommon alone is not enough for Cage. Missing
        # /usr/share/X11/xkb caused a real QEMU SIGSEGV before WebKit.
        required = self.buildroot_like_paths()
        for missing in ("usr/share/X11/xkb/rules/evdev",
                        "usr/share/X11/xkb/keycodes/evdev",
                        "usr/share/X11/xkb/symbols/br",
                        "usr/share/X11/xkb/symbols/us"):
            with self.subTest(missing=missing):
                bad = self.make_tar(required - {missing})
                self.builder.ensure_surface_runtime_path_compatibility(bad)
                with self.assertRaisesRegex(self.builder.SurfaceBuildError, "missing required paths"):
                    self.builder.inspect_rootfs_tar(bad, self.source)
                empty = self.make_tar(required, empty={missing})
                self.builder.ensure_surface_runtime_path_compatibility(empty)
                with self.assertRaisesRegex(self.builder.SurfaceBuildError, "empty"):
                    self.builder.inspect_rootfs_tar(empty, self.source)

    def test_buildroot_opengl_runtime_missing_or_empty_rejects_surface_image(self):
        # QEMU proved libepoxy abort(134) when Mesa EGL/GLES was present
        # but libGL.so.1 was absent; softpipe is the supported virtio fallback.
        required = self.buildroot_like_paths()
        for missing in ("usr/lib/libGL.so.1", "usr/lib/dri/swrast_dri.so"):
            with self.subTest(missing=missing):
                absent = self.make_tar(required - {missing})
                self.builder.ensure_surface_runtime_path_compatibility(absent)
                with self.assertRaisesRegex(self.builder.SurfaceBuildError, "missing required paths"):
                    self.builder.inspect_rootfs_tar(absent, self.source)
                empty = self.make_tar(required, empty={missing})
                self.builder.ensure_surface_runtime_path_compatibility(empty)
                with self.assertRaisesRegex(self.builder.SurfaceBuildError, "empty"):
                    self.builder.inspect_rootfs_tar(empty, self.source)

    def test_intel_i915_drm_requires_real_mesa_dri_drivers(self):
        # On the physical Intel notebook, /dev/dri/card0 (i915) exists but
        # Cage EGL fails with EGL_NOT_INITIALIZED / DRI2 screen creation.
        # A softpipe-only Mesa package passes the VirtIO/Pixman QEMU proof
        # yet cannot provide native Intel GPU EGL. Guard all generations.
        drivers = (
            "usr/lib/dri/i915_dri.so",
            "usr/lib/dri/crocus_dri.so",
            "usr/lib/dri/iris_dri.so",
        )
        required = set(self.source["required_runtime_paths"])
        for driver in drivers:
            self.assertIn(driver, required)
            with self.subTest(driver=driver):
                absent = self.make_tar(self.buildroot_like_paths(omit={driver}))
                self.builder.ensure_surface_runtime_path_compatibility(absent)
                with self.assertRaisesRegex(self.builder.SurfaceBuildError, "missing required paths"):
                    self.builder.inspect_rootfs_tar(absent, self.source)
                empty = self.make_tar(self.buildroot_like_paths(), empty={driver})
                self.builder.ensure_surface_runtime_path_compatibility(empty)
                with self.assertRaisesRegex(self.builder.SurfaceBuildError, "empty"):
                    self.builder.inspect_rootfs_tar(empty, self.source)

        # Kernel i915 alone is not proof of EGL userspace capability.
        profile = CONFIG_PATH.read_text(encoding="utf-8")
        for setting in (
            "BR2_PACKAGE_MESA3D_LLVM=y",
            "BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_I915=y",
            "BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_CROCUS=y",
            "BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_IRIS=y",
            "BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_SOFTPIPE=y",
        ):
            self.assertEqual(profile.splitlines().count(setting), 1)
            self.assertIn(setting, self.builder.GRAPHICAL_KCONFIG_REQUIRED)

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
            'echo "BR2_CCACHE_DIR=$cache_root/ccache"',
            'echo "BR2_DL_DIR=$cache_root/downloads"',
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
