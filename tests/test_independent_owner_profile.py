from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "bootstrap" / "independent-base"
SOURCE = BASE / "source.json"
FRAGMENT = BASE / "configs" / "owner-development.fragment"
OWNER_BUSYBOX_FRAGMENT = BASE / "configs" / "owner-development.busybox.fragment"
NETWORK_HELPER = ROOT / "bootstrap" / "dev-base" / "ordax-network"
POST_BUILD = BASE / "post-build.sh"
BUILD = BASE / "build.py"
OWNER_BUSYBOX_CONFIG = (
    'BR2_PACKAGE_BUSYBOX_CONFIG_FRAGMENT_FILES="$(BR2_EXTERNAL_ORDAX_MINIMAL_PATH)/configs/'
    'portable-handoff.busybox.fragment $(BR2_EXTERNAL_ORDAX_MINIMAL_PATH)/configs/'
    'owner-development.busybox.fragment"'
)


class IndependentOwnerDevelopmentProfileTests(unittest.TestCase):
    def test_profile_is_registered_under_single_independent_base_owner(self) -> None:
        source = json.loads(SOURCE.read_text(encoding="utf-8"))
        profiles = source.get("profiles")
        self.assertIsInstance(profiles, dict)
        self.assertEqual(set(profiles), {"minimal", "owner-development"})
        self.assertEqual(
            profiles["minimal"]["defconfig"],
            "bootstrap/independent-base/configs/ordax_minimal_defconfig",
        )
        owner = profiles["owner-development"]
        self.assertEqual(owner["defconfig"], profiles["minimal"]["defconfig"])
        self.assertEqual(
            owner["fragment"],
            "bootstrap/independent-base/configs/owner-development.fragment",
        )
        self.assertEqual(owner["purpose"], "owner-development-parity-without-alpine")

    def test_owner_profile_declares_userspace_busybox_and_firmware_provider(self) -> None:
        lines = {
            line.strip()
            for line in FRAGMENT.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        }
        required_userspace = {
            "BR2_PACKAGE_CA_CERTIFICATES=y",
            "BR2_PACKAGE_GIT=y",
            "BR2_PACKAGE_IW=y",
            "BR2_PACKAGE_WPA_SUPPLICANT=y",
            "BR2_PACKAGE_WPA_SUPPLICANT_PASSPHRASE=y",
            "BR2_PACKAGE_WPA_SUPPLICANT_CLI=y",
        }
        self.assertTrue(required_userspace.issubset(lines))
        self.assertIn(OWNER_BUSYBOX_CONFIG, lines)
        firmware = lines - required_userspace - {OWNER_BUSYBOX_CONFIG}
        self.assertIn("BR2_PACKAGE_LINUX_FIRMWARE=y", firmware)
        self.assertGreater(len(firmware), 1)
        self.assertTrue(
            all(line.startswith("BR2_PACKAGE_LINUX_FIRMWARE") for line in firmware),
            firmware,
        )
        self.assertNotIn("BR2_PACKAGE_KMOD=y", lines)
        self.assertNotIn("BR2_PACKAGE_ZSTD=y", lines)
        text = FRAGMENT.read_text(encoding="utf-8").lower()
        self.assertNotIn("alpine", text)
        self.assertNotIn("apk", text)

    def test_owner_busybox_fragment_adds_only_network_diagnostics(self) -> None:
        lines = [
            line.strip()
            for line in OWNER_BUSYBOX_FRAGMENT.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        ]
        self.assertEqual(lines, ["CONFIG_NTPD=y", "CONFIG_NSLOOKUP=y", "CONFIG_WGET=y"])
        self.assertNotIn("CONFIG_TIMEOUT=y", lines)
        self.assertNotIn("CONFIG_IP=y", lines)

    def test_owner_busybox_clock_capability_has_a_real_runtime_consumer(self) -> None:
        helper = NETWORK_HELPER.read_text(encoding="utf-8")
        self.assertIn("/bin/busybox ntpd -q -n", helper)
        self.assertIn("CLOCK_SYNC_TIMEOUT", helper)
        self.assertIn("probe_dns() {", helper)
        self.assertIn("probe_https() {", helper)
        self.assertIn("probe_git_remote() {", helper)
        self.assertIn('write_network_status ready "$iface"', helper)
    def test_owner_wifi_cli_capability_has_a_real_runtime_consumer(self) -> None:
        helper = NETWORK_HELPER.read_text(encoding="utf-8")
        self.assertIn("for tool in iw wpa_supplicant wpa_cli wpa_passphrase", helper)
        fragment = FRAGMENT.read_text(encoding="utf-8")
        self.assertIn("BR2_PACKAGE_WPA_SUPPLICANT_CLI=y", fragment)
        builder = BUILD.read_text(encoding="utf-8")
        self.assertIn('"usr/sbin/wpa_cli": None', builder)

    def test_owner_target_verifies_runtime_busybox_command_closure(self) -> None:
        builder = BUILD.read_text(encoding="utf-8")
        for applet in (
            "awk", "date", "df", "dirname", "head", "killall", "mv", "ntpd",
            "pivot_root", "reboot", "rm", "sed", "setsid", "stty", "tail",
            "test", "touch", "wc", "flock", "nslookup", "wget",
        ):
            self.assertIn(f'"{applet}"', builder)

    def test_builder_validates_fragment_without_second_firmware_family_list(self) -> None:
        text = BUILD.read_text(encoding="utf-8")
        self.assertIn('OWNER_FIRMWARE_CONFIG_PREFIX = "BR2_PACKAGE_LINUX_FIRMWARE"', text)
        self.assertIn("validate_owner_fragment", text)
        self.assertIn('owner["fragment_config"]', text)
        self.assertIn('OWNER_BUSYBOX_SYMBOLS = ("CONFIG_NTPD=y", "CONFIG_NSLOOKUP=y", "CONFIG_WGET=y")', text)
        self.assertIn("OWNER_BUSYBOX_FRAGMENT_CONFIG", text)
        self.assertNotIn("OWNER_FIRMWARE_CONFIG = (", text)
        self.assertNotIn("IWLWIFI_22000", text)
        self.assertNotIn("ATHEROS_9271", text)

    def test_post_build_uses_explicit_profile_instead_of_capability_guessing(self) -> None:
        script = POST_BUILD.read_text(encoding="utf-8")
        self.assertIn("PROFILE=${2:-}", script)
        self.assertIn("minimal|owner-development", script)
        self.assertIn('if test "$PROFILE" = owner-development; then', script)
        self.assertIn("Unknown Independent Base profile", script)
        self.assertNotIn(
            'if test -x "$TARGET_DIR/usr/bin/git" || test -x "$TARGET_DIR/usr/sbin/wpa_supplicant"; then',
            script,
        )

    def test_post_build_reuses_canonical_dev_helpers_instead_of_copying_logic(self) -> None:
        script = POST_BUILD.read_text(encoding="utf-8")
        for helper in (
            "ordax-network",
            "ordax-pull",
            "ordax-rollback",
            "ordax-run",
            "ordax-diagnose",
        ):
            self.assertIn(f'cp "$ROOT/bootstrap/dev-base/$helper"', script)
        self.assertIn(
            'cp "$ROOT/bootstrap/dev-base/ordax-dev-init" "$TARGET_DIR/sbin/ordax-dev-init"',
            script,
        )
        self.assertIn(
            'cp "$ROOT/bootstrap/recovery/entrypoint" "$TARGET_DIR/ordax/bootstrap/recovery/entrypoint"',
            script,
        )
        self.assertNotIn("apk add", script)
        self.assertNotIn("alpine_core.py", script)

    def test_owner_atomic_checkout_exchange_uses_canonical_static_toolchain(self) -> None:
        script = POST_BUILD.read_text(encoding="utf-8")
        builder = BUILD.read_text(encoding="utf-8")
        source = ROOT / "bootstrap/dev-base/ordax_checkout_exchange.c"
        self.assertTrue(source.is_file())
        self.assertIn('exchange_source="$ROOT/bootstrap/dev-base/ordax_checkout_exchange.c"', script)
        self.assertIn('HOST_DIR', script)
        self.assertIn('x86_64-buildroot-linux-musl-gcc', script)
        self.assertIn('"$exchange_compiler" -static', script)
        self.assertIn('ordax-checkout-exchange" --abi', script)
        self.assertIn('prototype-ordax.checkout-exchange/1', script)
        self.assertNotIn('musl-gcc -static', script)
        self.assertIn('"usr/local/bin/ordax-checkout-exchange": None', builder)
        self.assertIn('run(str(exchange), "--abi")', builder)
        self.assertIn('minimal target unexpectedly contains Owner atomic exchange helper', builder)

    def test_owner_helpers_are_fail_closed_on_complete_capability_set(self) -> None:
        script = POST_BUILD.read_text(encoding="utf-8")
        for target in (
            "$TARGET_DIR/usr/bin/git",
            "$TARGET_DIR/usr/sbin/iw",
            "$TARGET_DIR/usr/sbin/wpa_supplicant",
            "$TARGET_DIR/usr/sbin/wpa_passphrase",
            "$TARGET_DIR/usr/sbin/wpa_cli",
        ):
            self.assertIn(target, script)
        self.assertIn("Owner/Development CA trust store is missing", script)
        self.assertIn("Incomplete Owner/Development target capability set", script)
        self.assertIn("ORDAX_OWNER_DEVELOPMENT_PROFILE=YES", script)

    def test_owner_profile_requires_verified_kernel_component_inputs(self) -> None:
        script = POST_BUILD.read_text(encoding="utf-8")
        for variable in (
            "ORDAX_HOST_PYTHON",
            "ORDAX_KERNEL_MODULES_ARCHIVE",
            "ORDAX_KERNEL_MODULES_RECEIPT",
        ):
            self.assertIn(f"requires {variable}", script)
        self.assertIn('bootstrap/base/kernel_module_payload.py" install', script)
        self.assertIn('--archive "$ORDAX_KERNEL_MODULES_ARCHIVE"', script)
        self.assertIn('--receipt "$ORDAX_KERNEL_MODULES_RECEIPT"', script)
        self.assertNotIn("bootstrap/kernel/build.py", script)

    def test_owner_profile_fails_without_firmware_coverage(self) -> None:
        script = POST_BUILD.read_text(encoding="utf-8")
        self.assertIn('bootstrap/base/firmware_policy.py" check', script)
        self.assertIn('--rootfs "$TARGET_DIR"', script)
        self.assertIn("firmware-coverage.json", script)
        self.assertIn("ORDAX_INDEPENDENT_OWNER", script)

    def test_owner_hardware_receipts_are_embedded_exactly(self) -> None:
        script = POST_BUILD.read_text(encoding="utf-8")
        self.assertIn(
            'cp "$ORDAX_KERNEL_MODULES_RECEIPT" "$TARGET_DIR/etc/ordax/kernel-module-payload.json"',
            script,
        )
        self.assertIn(
            'cmp -s "$ORDAX_KERNEL_MODULES_RECEIPT" "$TARGET_DIR/etc/ordax/kernel-module-payload.json"',
            script,
        )
        self.assertIn(
            'cp "$ORDAX_FIRMWARE_COVERAGE_RECEIPT" "$TARGET_DIR/etc/ordax/firmware-coverage.json"',
            script,
        )
        self.assertIn(
            'cmp -s "$ORDAX_FIRMWARE_COVERAGE_RECEIPT" "$TARGET_DIR/etc/ordax/firmware-coverage.json"',
            script,
        )

    def test_minimal_profile_rejects_owner_capability_leakage(self) -> None:
        script = POST_BUILD.read_text(encoding="utf-8")
        self.assertIn("Owner/Development capability leaked into minimal profile", script)
        self.assertIn('$TARGET_DIR/etc/ordax/owner-development', script)

    def test_runtime_package_managers_remain_forbidden(self) -> None:
        script = POST_BUILD.read_text(encoding="utf-8")
        for forbidden in ("apk", "opkg", "dpkg", "apt-get", "rpm"):
            self.assertIn(forbidden, script)
        self.assertIn("Runtime package manager or Alpine dependency unexpectedly present", script)

    def test_builder_must_own_profile_selection(self) -> None:
        text = BUILD.read_text(encoding="utf-8")
        self.assertIn("--profile", text)
        self.assertIn("owner-development", text)
        self.assertIn("BR2_ROOTFS_POST_SCRIPT_ARGS", text)



class IndependentStaticElfClosureTests(unittest.TestCase):
    """Test the real Buildroot candidate ELF gate, not a duplicated parser."""

    @staticmethod
    def builder():
        spec = importlib.util.spec_from_file_location("ordax_independent_static_builder", BUILD)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    @staticmethod
    def elf(elf_type=2, machine=62):
        data = bytearray(20)
        data[:7] = bytes.fromhex("7f454c46020101")
        data[16:18] = elf_type.to_bytes(2, "little")
        data[18:20] = machine.to_bytes(2, "little")
        return bytes(data)

    def exercise(self, payload, segments, dynamic):
        builder = self.builder()
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            (root / "bin").mkdir()
            (root / "bin" / "ordax-product-agent").write_bytes(payload)
            with patch.object(builder, "run", side_effect=[segments, dynamic]) as calls:
                result = builder.verify_static_userspace_elf_closure(root)
            self.assertEqual(calls.call_count, 2)
            self.assertEqual(result["linkage"], "static")
            self.assertEqual(result["userspace_elf_files_examined"], 1)
            self.assertEqual(result["program_interpreters"], [])
            self.assertEqual(result["needed_libraries"], [])
            self.assertRegex(result["elf_manifest_sha256"], r"^[a-f0-9]{64}$")

    def test_static_elf_closure_with_no_needed_libraries_is_valid(self):
        self.exercise(self.elf(), "Program Headers:\n  LOAD", "No dynamic section")

    def test_dynamic_loader_is_rejected_even_without_needed_libraries(self):
        builder = self.builder()
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            (root / "agent").write_bytes(self.elf())
            with patch.object(builder, "run",
                              return_value="INTERP Requesting program interpreter: /lib/ld-musl-x86_64.so.1"):
                with self.assertRaisesRegex(builder.BaseError, "dynamic ELF interpreter forbidden"):
                    builder.verify_static_userspace_elf_closure(root)

    def test_shared_libc_or_zlib_is_rejected(self):
        builder = self.builder()
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            (root / "agent").write_bytes(self.elf())
            with patch.object(builder, "run", side_effect=[
                "Program Headers: LOAD", "0x00000001 (NEEDED) Shared library: [libz.so.1]"
            ]):
                with self.assertRaisesRegex(builder.BaseError, "dynamic ELF dependencies forbidden"):
                    builder.verify_static_userspace_elf_closure(root)

    def test_aarch64_is_not_silently_accepted_in_x86_64_base(self):
        builder = self.builder()
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            (root / "agent").write_bytes(self.elf(machine=183))
            with patch.object(builder, "run") as calls:
                with self.assertRaisesRegex(builder.BaseError, "unexpected Independent Base ELF machine"):
                    builder.verify_static_userspace_elf_closure(root)
            calls.assert_not_called()

    def test_kernel_module_relocatable_is_not_treated_as_userspace_executable(self):
        builder = self.builder()
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            (root / "module.ko").write_bytes(self.elf(elf_type=1))
            with patch.object(builder, "run") as calls:
                with self.assertRaisesRegex(builder.BaseError, "no executables"):
                    builder.verify_static_userspace_elf_closure(root)
            calls.assert_not_called()

    def test_build_and_verify_pin_static_closure_receipt(self):
        source = BUILD.read_text(encoding="utf-8")
        self.assertIn("userspace_elf_closure = verify_static_userspace_elf_closure(target)", source)
        self.assertIn('"independent_userspace_elf_closure": userspace_elf_closure', source)
        self.assertIn('elf_closure = report.get("independent_userspace_elf_closure")', source)



if __name__ == "__main__":
    unittest.main()
