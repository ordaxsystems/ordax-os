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
        (stdlib / "json/__pycache__").mkdir(parents=True)
        (stdlib / "__pycache__").mkdir(parents=True)
        # Validate the Buildroot .pyc-only layout, not host Python sources.
        bytecode = bytes.fromhex("a70d0d0a") + bytes(12) + b"x"
        for module in ("ssl", "site"):
            (stdlib / "__pycache__" / (module + ".cpython-313.pyc")).write_bytes(bytecode)
        (stdlib / "json/__pycache__/__init__.cpython-313.pyc").write_bytes(bytecode)
        (self.target / "etc/ssl/certs").mkdir(parents=True)
        (self.target / "etc/ssl/certs/ca-certificates.crt").write_text("certificate")
        (lib_dir / "ld-musl-x86_64.so.1").write_bytes(binary)
        (lib_dir / "libz.so.1").write_bytes(binary)

    def fake_readelf(self, needed="libz.so.1", interpreter="/lib/ld-musl-x86_64.so.1"):
        def result(program, mode, path):
            self.assertEqual(program, "readelf")
            is_python = path == str(self.exe)
            if mode == "-l":
                return (f"[Requesting program interpreter: {interpreter}]"
                        if is_python else "Program Headers: LOAD")
            self.assertEqual(mode, "-d")
            return (f"0x00000001 (NEEDED) Shared library: [{needed}]"
                    if is_python and needed else "There is no dynamic section")
        return result

    def test_built_interpreter_and_dependency_closure_is_reported(self):
        with patch.object(self.mod, "run", side_effect=self.fake_readelf()) as readelf:
            receipt = self.mod.verify_native_python_target(self.target)
        self.assertGreaterEqual(readelf.call_count, 6)
        readelf.assert_any_call("readelf", "-l", str(self.exe))
        readelf.assert_any_call("readelf", "-d", str(self.exe))
        self.assertEqual(receipt["python_executable"], "usr/bin/python3.13")
        self.assertEqual(receipt["needed_shared_libraries"], ["libz.so.1"])
        self.assertTrue(receipt["stdlib_ssl_zlib_verified"])
        self.assertFalse(receipt["runtime_agent_packaged"])
        self.assertFalse(receipt["device_execution_proven"])
        self.assertFalse(receipt["component_install_authorized"])
        self.assertRegex(receipt["elf_manifest_sha256"], "^[a-f0-9]{64}$")

    def test_missing_private_lib_is_never_satisfied_by_host(self):
        with patch.object(self.mod, "run", side_effect=self.fake_readelf(needed="libssl.so.3")):
            with self.assertRaisesRegex(self.mod.BaseError, "shared dependency absent"):
                self.mod.verify_native_python_target(self.target)

    def test_private_absolute_loader_symlink_is_resolved_inside_component(self):
        libc = self.target / "lib/libc.so"
        libc.write_bytes(self.exe.read_bytes())
        loader = self.target / "lib/ld-musl-x86_64.so.1"
        loader.unlink()
        loader.symlink_to("/lib/libc.so")
        self.assertEqual(
            self.mod.private_component_library(
                self.target, "lib", "ld-musl-x86_64.so.1"
            ), libc
        )

    def test_dangling_and_host_escape_libraries_never_satisfy_needed(self):
        libz = self.target / "lib/libz.so.1"
        libz.unlink()
        libz.symlink_to("libz-missing.so")
        with patch.object(self.mod, "run", side_effect=self.fake_readelf()):
            with self.assertRaisesRegex(self.mod.BaseError, "shared dependency absent"):
                self.mod.verify_native_python_target(self.target)
        libz.unlink()
        libz.symlink_to("../../../../etc/passwd")
        with self.assertRaisesRegex(self.mod.BaseError, "symlink escaped target"):
            self.mod.private_component_library(self.target, "lib", "libz.so.1")

    def test_cyclic_symlink_library_fails_closed(self):
        libz = self.target / "lib/libz.so.1"
        libz.unlink()
        libz.symlink_to("libz.so.1")
        with self.assertRaisesRegex(self.mod.BaseError, "symlink cycle"):
            self.mod.private_component_library(self.target, "lib", "libz.so.1")

    def test_non_elf_file_with_matching_soname_is_rejected(self):
        (self.target / "lib/libz.so.1").write_text("not an ELF")
        with self.assertRaisesRegex(self.mod.BaseError, "not a native x86_64 ELF"):
            self.mod.private_component_library(self.target, "lib", "libz.so.1")

    def test_wrong_dynamic_interpreter_is_refused(self):
        with patch.object(self.mod, "run", side_effect=self.fake_readelf(
            interpreter="/lib64/ld-linux-x86-64.so.2"
        )):
            with self.assertRaisesRegex(self.mod.BaseError, "unexpected private Python ELF interpreter"):
                self.mod.verify_native_python_target(self.target)

    def test_stdlib_requires_compiled_modules_not_source_placeholders(self):
        stdlib = self.target / "usr/lib/python3.13"
        ssl = stdlib / "__pycache__/ssl.cpython-313.pyc"
        ssl.unlink()
        (stdlib / "ssl.py").write_text("pass")
        with self.assertRaisesRegex(self.mod.BaseError, "compiled standard library incomplete: ssl"):
            self.mod.verify_native_python_target(self.target)

    def test_corrupt_stdlib_pyc_does_not_pass_closure_audit(self):
        stdlib = self.target / "usr/lib/python3.13"
        ssl = stdlib / "__pycache__/ssl.cpython-313.pyc"
        for payload in (b"bad", bytes.fromhex("a70d0d0a") + bytes.fromhex("ffffffff") + bytes(9)):
            with self.subTest(size=len(payload)):
                ssl.write_bytes(payload)
                with self.assertRaisesRegex(self.mod.BaseError, "compiled standard library incomplete: ssl"):
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

    def test_kernel_host_smoke_executes_private_loader_and_modules(self):
        import os
        from types import SimpleNamespace
        abi = {"python_executable": "usr/bin/python3.13"}
        result = SimpleNamespace(
            returncode=0, stdout=json.dumps({
                "python_version": "3.13.7",
                "module_names": ["ssl", "_ssl", "hashlib", "_hashlib", "zlib", "json"],
                "ssl_version": "OpenSSL 3.5.0",
                "all_imports_private": True,
                "tls_and_zlib_operational": True,
            }),
        )
        with patch.object(self.mod.subprocess, "run", return_value=result) as runner:
            proof = self.mod.smoke_test_private_native_python(self.target, abi)
        args, kwargs = runner.call_args
        self.assertEqual(args[0][0], str(self.target / "lib/ld-musl-x86_64.so.1"))
        self.assertEqual(args[0][1], str(self.exe))
        self.assertIn("-S", args[0])
        self.assertIn("-s", args[0])
        self.assertEqual(kwargs["env"]["PYTHONHOME"], str(self.target / "usr"))
        self.assertEqual(kwargs["env"]["LD_LIBRARY_PATH"],
                         str(self.target / "lib") + ":" + str(self.target / "usr/lib"))
        self.assertFalse(proof["ordax_usb_execution_proven"])
        self.assertFalse(proof["runtime_agent_packaged"])
        self.assertTrue(proof["linux_kernel_execution_proven"])

    def test_kernel_host_smoke_cannot_accept_host_python_or_missing_tls(self):
        from types import SimpleNamespace
        abi = {"python_executable": "usr/bin/python3.13"}
        invalid_reports = [
            {"python_version": "3.12.8", "module_names": ["ssl", "_ssl", "hashlib",
                 "_hashlib", "zlib", "json"], "ssl_version": "OpenSSL 3.5.0",
             "all_imports_private": True, "tls_and_zlib_operational": True},
            {"python_version": "3.13.7", "module_names": ["ssl", "_ssl", "hashlib",
                 "_hashlib", "zlib", "json"], "ssl_version": "OpenSSL 3.5.0",
             "all_imports_private": False, "tls_and_zlib_operational": True},
            {"python_version": "3.13.7", "module_names": ["ssl", "_ssl", "hashlib",
                 "_hashlib", "zlib", "json"], "ssl_version": "OpenSSL 3.5.0",
             "all_imports_private": True, "tls_and_zlib_operational": False},
        ]
        for report in invalid_reports:
            with self.subTest(report=report):
                result = SimpleNamespace(returncode=0, stdout=json.dumps(report))
                with patch.object(self.mod.subprocess, "run", return_value=result):
                    with self.assertRaisesRegex(self.mod.BaseError, "smoke verification incomplete"):
                        self.mod.smoke_test_private_native_python(self.target, abi)

    def test_kernel_host_smoke_fails_closed_on_process_error(self):
        from types import SimpleNamespace
        with patch.object(self.mod.subprocess, "run",
                          return_value=SimpleNamespace(returncode=1, stdout="missing private libz")):
            with self.assertRaisesRegex(self.mod.BaseError, "smoke execution failed"):
                self.mod.smoke_test_private_native_python(
                    self.target, {"python_executable": "usr/bin/python3.13"}
                )

    def test_build_component_uses_single_existing_setup_not_os_ero_fs(self):
        source = (BASE / "build.py").read_text()
        self.assertIn("configure_buildroot(", source)
        self.assertIn("def build_native_python_component(", source)
        self.assertIn('verify_native_python_target(build_dir / "target")', source)
        self.assertIn('smoke_test_private_native_python(build_dir / "target", evidence)', source)
        self.assertIn('"device_install_authorized": False', source)




if __name__ == "__main__":
    unittest.main()
