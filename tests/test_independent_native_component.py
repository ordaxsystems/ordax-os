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

    def test_base_and_private_python_share_one_buildroot_download_cache(self):
        # Verify the existing canonical configuration path, not a second builder.
        with tempfile.TemporaryDirectory() as temporary:
            cache = Path(temporary) / "cache"
            archive = Path(temporary) / "source.tar.xz"
            archive.write_bytes(b"fixture")
            observed = []

            def fake_archive(source, actual_cache):
                self.assertEqual(actual_cache, cache.resolve())
                return archive

            def fake_run(*arguments):
                self.assertEqual(arguments[-1], "defconfig")
                generated = Path(next(
                    arg.partition("=")[2]
                    for arg in arguments if arg.startswith("BR2_DEFCONFIG=")
                ))
                build_dir = Path(next(
                    arg.partition("=")[2]
                    for arg in arguments if arg.startswith("O=")
                ))
                build_dir.mkdir(parents=True, exist_ok=True)
                (build_dir / ".config").write_text(
                    generated.read_text(encoding="utf-8"), encoding="utf-8"
                )
                observed.append(arguments)
                return ""

            with patch.object(self.mod, "source_archive", side_effect=fake_archive), \
                 patch.object(self.mod, "safe_unpack", return_value=Path(temporary) / "buildroot"), \
                 patch.object(self.mod, "run", side_effect=fake_run):
                for profile in ("minimal", "owner-development", "native-product-runtime"):
                    with self.subTest(profile=profile):
                        work = Path(temporary) / profile
                        work.mkdir()
                        _, _, command, actual_archive, _ = self.mod.configure_buildroot(
                            self.source, self.kernel, cache, work, profile
                        )
                        self.assertEqual(actual_archive, archive)
                        self.assertEqual(
                            command.count(f"BR2_DL_DIR={cache.resolve() / 'buildroot-downloads'}"),
                            1,
                        )
            self.assertEqual(len(observed), 3)
            self.assertTrue((cache / "buildroot-downloads").is_dir())

    def test_missing_shared_runtime_or_tls_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "component_defconfig"
            self.mod.generate_native_component_defconfig(self.source, self.kernel, output)
            text = output.read_text()
        for critical in ("BR2_SHARED_LIBS=y", "BR2_PACKAGE_PYTHON3_SSL=y",
                         "BR2_PACKAGE_PYTHON3_ZLIB=y",
                         "BR2_PACKAGE_PYTHON_HTTPX=y",
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

    def test_httpx_versions_are_read_from_verified_buildroot_recipes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            versions = {
                "httpx": "0.28.1", "httpcore": "1.0.9",
                "anyio": "4.13.0", "certifi": "2026.4.22",
                "idna": "3.11", "h11": "0.16.0",
            }
            for name, version in versions.items():
                directory = root / "package" / f"python-{name}"
                directory.mkdir(parents=True)
                variable = name.upper().replace("-", "_")
                (directory / "Config.in").write_text(
                    f"config BR2_PACKAGE_PYTHON_{variable}\n", encoding="utf-8"
                )
                (directory / f"python-{name}.mk").write_text(
                    f"PYTHON_{variable}_VERSION = {version}\n", encoding="utf-8"
                )
            self.assertEqual(
                self.mod.read_native_httpx_buildroot_versions(root), versions
            )
            mismatched = root / "package/python-anyio/python-anyio.mk"
            mismatched.write_text(
                "PYTHON_ANYIO_VERSION = $(BR2_HOST_VERSION)\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(self.mod.BaseError, "version invalid: anyio"):
                self.mod.read_native_httpx_buildroot_versions(root)
            mismatched.write_text(
                "PYTHON_ANYIO_VERSION = 4.13.0\n"
                "PYTHON_ANYIO_VERSION = 4.14.0\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(self.mod.BaseError, "version invalid: anyio"):
                self.mod.read_native_httpx_buildroot_versions(root)
            mismatched.unlink()
            mismatched.symlink_to("/etc/passwd")
            with self.assertRaisesRegex(self.mod.BaseError, "package unavailable: anyio"):
                self.mod.read_native_httpx_buildroot_versions(root)

    def test_httpx_source_receipt_requires_exact_modules_and_versions(self):
        version_map = {
            "httpx": "0.28.1", "httpcore": "1.0.9",
            "anyio": "4.13.0", "certifi": "2026.4.22",
            "idna": "3.11", "h11": "0.16.0",
        }
        digest = "a" * 64
        with tempfile.TemporaryDirectory() as temporary:
            proof = Path(temporary)
            receipt = {
                "$schema": "ordax.private-native-python-build-proof/1",
                "status": "build-proof-only",
                "buildroot_sha256": self.source["buildroot"]["sha256"],
                "kernel_source_version": self.kernel["version"],
                "component_inputs": {
                    "component": "native-product-runtime",
                    "source_owner": "ordaxsystems/ordax-runtime",
                    "base_defconfig_sha256": self.mod.digest(self.mod.BASE_DEFCONFIG),
                    "fragment_sha256": self.mod.digest(self.mod.NATIVE_COMPONENT_FRAGMENT),
                },
                "python_abi": {
                    "python_executable": "usr/bin/python3.14",
                    "stdlib": "usr/lib/python3.14",
                    "python_sha256": digest,
                    "elf_manifest_sha256": digest,
                    "compiled_elf_count": 56,
                    "required_interpreter": "/lib/ld-musl-x86_64.so.1",
                    "stdlib_ssl_zlib_verified": True,
                    "needed_shared_libraries": ["libc.so", "libssl.so.3"],
                    "runtime_agent_packaged": False,
                    "component_install_authorized": False,
                    "device_execution_proven": False,
                },
                "private_python_smoke": {
                    "status": "kernel-host-smoke-pass",
                    "python_version": "3.14.7",
                    "module_names": ["ssl", "_ssl", "hashlib", "_hashlib",
                                     "zlib", "json", "httpx", "httpcore",
                                     "anyio", "certifi", "idna", "h11"],
                    "all_imports_private": True,
                    "tls_and_zlib_operational": True,
                    "httpx_offline_request_construction_proven": True,
                    "httpx_mock_transport_proven": True,
                    "httpx_version": "0.28.1",
                    "runtime_dependency_versions_reconciled": False,
                    "linux_kernel_execution_proven": True,
                    "ordax_usb_execution_proven": False,
                    "runtime_agent_packaged": False,
                },
                "httpx_buildroot_source_versions": version_map,
                "runtime_agent_packaged": False,
                "component_artifact_authorized": False,
                "device_install_authorized": False,
                "base_rootfs_modified": False,
            }
            output = proof / "native-python-provenance.json"
            def verify(candidate):
                output.write_text(json.dumps(candidate), encoding="utf-8")
                return self.mod.verify_native_python_receipt(proof)
            self.assertEqual(
                verify(receipt)["httpx_buildroot_source_versions"], version_map
            )
            for poisoned in (
                {**version_map, "httpx": "0.29.0"},
                {**version_map, "mcp": "1.30.0"},
                {**version_map, "httpcore": "$(unresolved)"},
            ):
                with self.subTest(poisoned=poisoned):
                    with self.assertRaisesRegex(self.mod.BaseError, "source-version|execution receipt"):
                        verify({**receipt, "httpx_buildroot_source_versions": poisoned})
            with self.assertRaisesRegex(self.mod.BaseError, "execution receipt"):
                verify({**receipt, "private_python_smoke": {
                    **receipt["private_python_smoke"],
                    "runtime_dependency_versions_reconciled": True,
                }})

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
        abi = {"python_executable": "usr/bin/python3.13", "stdlib": "usr/lib/python3.13"}
        result = SimpleNamespace(
            returncode=0, stdout=json.dumps({
                "python_version": "3.13.7",
                "module_names": ["ssl", "_ssl", "hashlib", "_hashlib", "zlib", "json", "httpx", "httpcore", "anyio", "certifi", "idna", "h11"],
                "ssl_version": "OpenSSL 3.5.0",
                "all_imports_private": True,
                "tls_and_zlib_operational": True,
                "httpx_offline_request_construction_proven": True,
                "httpx_mock_transport_proven": True,
                "httpx_version": "0.28.1",
                "runtime_dependency_versions_reconciled": False,
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
        self.assertTrue(proof["httpx_offline_request_construction_proven"])
        self.assertTrue(proof["httpx_mock_transport_proven"])
        self.assertEqual(proof["httpx_version"], "0.28.1")
        self.assertFalse(proof["runtime_dependency_versions_reconciled"])
        self.assertEqual(kwargs["env"]["PYTHONPATH"],
                         str(self.target / "usr/lib/python3.13/site-packages"))

    def test_kernel_host_smoke_cannot_accept_host_python_or_missing_tls(self):
        from types import SimpleNamespace
        abi = {"python_executable": "usr/bin/python3.13", "stdlib": "usr/lib/python3.13"}
        invalid_reports = [
            {"python_version": "3.12.8", "module_names": ["ssl", "_ssl", "hashlib",
                 "_hashlib", "zlib", "json"], "ssl_version": "OpenSSL 3.5.0",
             "all_imports_private": True, "tls_and_zlib_operational": True},
            {"python_version": "3.13.7", "module_names": ["ssl", "_ssl", "hashlib",
                 "_hashlib", "zlib", "json"], "ssl_version": "OpenSSL 3.5.0",
             "all_imports_private": False, "tls_and_zlib_operational": True},
            {"python_version": "3.13.7", "module_names": ["ssl", "_ssl", "hashlib",
                 "_hashlib", "zlib", "json"], "ssl_version": "OpenSSL 3.5.0",
             "all_imports_private": True, "tls_and_zlib_operational": False,
             "httpx_offline_request_construction_proven": True,
             "runtime_dependency_versions_reconciled": False},
        ]
        for report in invalid_reports:
            with self.subTest(report=report):
                result = SimpleNamespace(returncode=0, stdout=json.dumps(report))
                with patch.object(self.mod.subprocess, "run", return_value=result):
                    with self.assertRaisesRegex(self.mod.BaseError, "smoke verification incomplete"):
                        self.mod.smoke_test_private_native_python(self.target, abi)

    def test_httpx_mock_transport_and_version_are_required(self):
        from types import SimpleNamespace
        report = {
            "python_version": "3.13.7",
            "module_names": ["ssl", "_ssl", "hashlib", "_hashlib", "zlib", "json",
                             "httpx", "httpcore", "anyio", "certifi", "idna", "h11"],
            "ssl_version": "OpenSSL 3.5.0",
            "all_imports_private": True,
            "tls_and_zlib_operational": True,
            "httpx_offline_request_construction_proven": True,
            "httpx_mock_transport_proven": True,
            "httpx_version": "0.28.1",
            "runtime_dependency_versions_reconciled": False,
        }
        for change in ({"httpx_mock_transport_proven": False},
                       {"httpx_version": "unknown"},
                       {"httpx_version": "0.28.1-alpine"}):
            with self.subTest(change=change):
                candidate = {**report, **change}
                with patch.object(self.mod.subprocess, "run",
                                  return_value=SimpleNamespace(returncode=0,
                                    stdout=json.dumps(candidate))):
                    with self.assertRaisesRegex(self.mod.BaseError, "smoke verification incomplete"):
                        self.mod.smoke_test_private_native_python(
                            self.target,
                            {"python_executable": "usr/bin/python3.13",
                             "stdlib": "usr/lib/python3.13"}
                        )

    def test_httpx_probe_never_reconciles_full_runtime_versions(self):
        from types import SimpleNamespace
        report = {
            "python_version": "3.13.7",
            "module_names": ["ssl", "_ssl", "hashlib", "_hashlib", "zlib", "json",
                             "httpx", "httpcore", "anyio", "certifi", "idna", "h11"],
            "ssl_version": "OpenSSL 3.5.0",
            "all_imports_private": True,
            "tls_and_zlib_operational": True,
            "httpx_offline_request_construction_proven": True,
            "httpx_mock_transport_proven": True,
            "httpx_version": "0.28.1",
            "runtime_dependency_versions_reconciled": True,
        }
        with patch.object(self.mod.subprocess, "run",
                          return_value=SimpleNamespace(returncode=0, stdout=json.dumps(report))):
            with self.assertRaisesRegex(self.mod.BaseError, "smoke verification incomplete"):
                self.mod.smoke_test_private_native_python(
                    self.target, {"python_executable": "usr/bin/python3.13",
                                  "stdlib": "usr/lib/python3.13"}
                )

    def test_kernel_host_smoke_fails_closed_on_process_error(self):
        from types import SimpleNamespace
        with patch.object(self.mod.subprocess, "run",
                          return_value=SimpleNamespace(returncode=1, stdout="missing private libz")):
            with self.assertRaisesRegex(self.mod.BaseError, "smoke execution failed"):
                self.mod.smoke_test_private_native_python(
                    self.target, {"python_executable": "usr/bin/python3.13", "stdlib": "usr/lib/python3.13"}
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
