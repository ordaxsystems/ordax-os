"""Prove private Buildroot Python uses the same source but NOT the static OS base."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "bootstrap/independent-base"


def builder():
    spec = importlib.util.spec_from_file_location("ordax_native_component_builder", BASE / "build.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class NativeComponentBuildrootTests(unittest.TestCase):
    def setUp(self):
        self.mod = builder()
        self.source = json.loads((BASE / "source.json").read_text(encoding="utf-8"))
        self.kernel = json.loads((ROOT / "bootstrap/kernel/source.json").read_text(encoding="utf-8"))

    def test_component_uses_the_same_buildroot_source_but_not_os_rootfs(self):
        profiles = self.source["profiles"]
        self.assertEqual(set(profiles), {"minimal", "owner-development"})
        fragment = self.source["component_profiles"]["native-product-runtime"]
        self.assertEqual(fragment["source_owner"], "ordaxsystems/ordax-runtime")
        self.assertFalse(fragment["base_rootfs_mutation_allowed"])
        self.assertFalse(fragment["component_artifact_authorized"])
        self.assertFalse(fragment["device_install_authorized"])
        base = (BASE / "configs/ordax_minimal_defconfig").read_text()
        owner = (BASE / "configs/owner-development.fragment").read_text()
        self.assertIn("BR2_STATIC_LIBS=y", base)
        self.assertNotIn("BR2_SHARED_LIBS=y", owner)
        self.assertNotIn("BR2_PACKAGE_PYTHON3=y", owner)

    def test_component_build_config_is_strictly_separate(self):
        with tempfile.TemporaryDirectory() as temp:
            generated = Path(temp) / "component_defconfig"
            receipt = self.mod.generate_native_component_defconfig(
                self.source, self.kernel, generated
            )
            self.assertFalse(receipt["device_install_authorized"])
            self.assertFalse(receipt["component_artifact_authorized"])
            self.assertRegex(receipt["buildroot_sha256"], r"^[0-9a-f]{64}$")
            text = generated.read_text()
        for required in self.mod.NATIVE_COMPONENT_REQUIRED:
            self.assertIn(required, text)
        self.assertIn("BR2_TOOLCHAIN_BUILDROOT_MUSL=y", text)
        self.assertNotIn("BR2_STATIC_LIBS=y", text)
        for forbidden in ("BR2_ROOTFS_OVERLAY", "BR2_ROOTFS_POST_BUILD_SCRIPT",
                          "BR2_ROOTFS_POST_IMAGE_SCRIPT", "BR2_GLOBAL_PATCH_DIR",
                          "BR2_PACKAGE_IPROUTE2=y", "BR2_PACKAGE_LINUX_FIRMWARE=y"):
            self.assertNotIn(forbidden, text)
        self.mod.verify_native_component_config(text, self.kernel)

    def test_missing_shared_runtime_or_tls_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "component_defconfig"
            self.mod.generate_native_component_defconfig(self.source, self.kernel, output)
            text = output.read_text()
        for critical in ("BR2_SHARED_LIBS=y", "BR2_PACKAGE_PYTHON3_SSL=y",
                         "BR2_PACKAGE_PYTHON3_ZLIB=y",
                         "BR2_TOOLCHAIN_BUILDROOT_MUSL=y"):
            with self.subTest(missing=critical):
                with self.assertRaisesRegex(self.mod.BaseError, "rejected"):
                    self.mod.verify_native_component_config(
                        text.replace(critical + "\n", ""), self.kernel
                    )
        with self.assertRaisesRegex(self.mod.BaseError, "static-only"):
            self.mod.verify_native_component_config(
                text + "BR2_STATIC_LIBS=y\n", self.kernel
            )

    def test_os_boot_scripts_and_apk_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "component_defconfig"
            self.mod.generate_native_component_defconfig(self.source, self.kernel, output)
            config = output.read_text()
        for forbidden in ("BR2_ROOTFS_OVERLAY=\"/some/os\"", "BR2_PACKAGE_IPROUTE2=y"):
            with self.subTest(forbidden=forbidden):
                with self.assertRaisesRegex(self.mod.BaseError, "OS boot payload"):
                    self.mod.verify_native_component_config(
                        config + forbidden + "\n", self.kernel
                    )
        with tempfile.TemporaryDirectory() as temp:
            injected = Path(temp) / "fragment"
            injected.write_text("BR2_SHARED_LIBS=y\nBR2_PACKAGE_ALPINE_APK=y\n")
            with patch.object(self.mod, "NATIVE_COMPONENT_FRAGMENT", injected):
                with self.assertRaisesRegex(self.mod.BaseError, "unsupported Buildroot capabilities"):
                    self.mod.generate_native_component_defconfig(
                        self.source, self.kernel, Path(temp) / "candidate"
                    )

    def test_check_component_never_builds_or_authorizes_a_device(self):
        result = subprocess.run(
            [sys.executable, str(BASE / "build.py"), "check-component"],
            capture_output=True, text=True, cwd=ROOT, timeout=20,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        parsed = json.loads(result.stdout)
        self.assertEqual(parsed["status"], "component-contract-pass")
        self.assertFalse(parsed["inputs"]["component_artifact_authorized"])
        self.assertFalse(parsed["inputs"]["device_install_authorized"])



class BuiltNativePythonClosureTests(unittest.TestCase):
    """Examine the Buildroot target tree, not a second ELF parser or host Python."""

    def setUp(self):
        self.mod = builder()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.target = Path(self.tmp.name) / "target"
        bin_dir = self.target / "usr/bin"
        stdlib = self.target / "usr/lib/python3.13"
        lib_dir = self.target / "lib"
        (stdlib / "lib-dynload").mkdir(parents=True)
        bin_dir.mkdir(parents=True)
        lib_dir.mkdir(parents=True)
        self.exe = bin_dir / "python3.13"
        binary = bytearray(20)
        binary[:7] = bytes.fromhex("7f454c46020101")
        binary[16:18] = (2).to_bytes(2, "little")
        binary[18:20] = (62).to_bytes(2, "little")
        self.exe.write_bytes(binary)
        for name in ("_ssl.cpython-313-x86_64-linux-musl.so",
                     "_hashlib.cpython-313-x86_64-linux-musl.so",
                     "zlib.cpython-313-x86_64-linux-musl.so"):
            (stdlib / "lib-dynload" / name).write_text("not-an-ELF test module")
        (stdlib / "ssl.py").write_text("")
        (stdlib / "site.py").write_text("")
        (stdlib / "json").mkdir()
        (stdlib / "json/__init__.py").write_text("")
        (self.target / "etc/ssl/certs").mkdir(parents=True)
        (self.target / "etc/ssl/certs/ca-certificates.crt").write_text("certificate")
        (lib_dir / "ld-musl-x86_64.so.1").write_text("loader")
        (lib_dir / "libz.so.1").write_text("library")

    def test_built_interpreter_and_dependency_closure_is_reported(self):
        with patch.object(self.mod, "run", side_effect=[
            "[Requesting program interpreter: /lib/ld-musl-x86_64.so.1]",
            "0x00000001 (NEEDED) Shared library: [libz.so.1]",
        ]) as readelf:
            receipt = self.mod.verify_native_python_target(self.target)
        self.assertEqual(readelf.call_count, 2)
        self.assertEqual(receipt["python_executable"], "usr/bin/python3.13")
        self.assertEqual(receipt["needed_shared_libraries"], ["libz.so.1"])
        self.assertTrue(receipt["stdlib_ssl_zlib_verified"])
        self.assertFalse(receipt["runtime_agent_packaged"])
        self.assertFalse(receipt["device_execution_proven"])
        self.assertFalse(receipt["component_install_authorized"])
        self.assertRegex(receipt["elf_manifest_sha256"], "^[a-f0-9]{64}$")

    def test_missing_private_lib_is_never_satisfied_by_host(self):
        with patch.object(self.mod, "run", side_effect=[
            "[Requesting program interpreter: /lib/ld-musl-x86_64.so.1]",
            "0x00000001 (NEEDED) Shared library: [libssl.so.3]",
        ]):
            with self.assertRaisesRegex(self.mod.BaseError, "shared dependency absent"):
                self.mod.verify_native_python_target(self.target)

    def test_wrong_dynamic_interpreter_is_refused(self):
        with patch.object(self.mod, "run", return_value=(
            "[Requesting program interpreter: /lib64/ld-linux-x86-64.so.2]"
        )):
            with self.assertRaisesRegex(self.mod.BaseError, "unexpected private Python ELF interpreter"):
                self.mod.verify_native_python_target(self.target)

    def test_missing_tls_and_zlib_extensions_are_blockers(self):
        folder = self.target / "usr/lib/python3.13/lib-dynload"
        for suffix in ("_ssl", "_hashlib", "zlib"):
            with self.subTest(extension=suffix):
                path = next(folder.glob(suffix + "*.so"))
                renamed = path.with_suffix(".absent")
                path.rename(renamed)
                with self.assertRaisesRegex(self.mod.BaseError, "extension missing"):
                    self.mod.verify_native_python_target(self.target)
                renamed.rename(path)

    def test_rootfs_source_and_incompatible_machine_are_refused(self):
        data = bytearray(self.exe.read_bytes())
        data[18:20] = (183).to_bytes(2, "little")
        self.exe.write_bytes(data)
        with self.assertRaisesRegex(self.mod.BaseError, "non-x86_64 ELF"):
            self.mod.verify_native_python_target(self.target)

    def test_build_component_uses_single_existing_setup_not_os_ero_fs(self):
        source = (BASE / "build.py").read_text()
        self.assertIn("configure_buildroot(", source)
        self.assertIn("def build_native_python_component(", source)
        self.assertIn('verify_native_python_target(build_dir / "target")', source)
        self.assertIn('"device_install_authorized": False', source)




if __name__ == "__main__":
    unittest.main()
