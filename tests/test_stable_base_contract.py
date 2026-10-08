#!/usr/bin/env python3
"""Regress the Stable/MVP minimal OS base boundary."""

from __future__ import annotations

import ast
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = ROOT / "bootstrap/stable-base/source.json"
BUILDER = ROOT / "bootstrap/stable-base/build.py"
INIT = ROOT / "bootstrap/stable-base/ordax-stable-init"
COMMON = ROOT / "bootstrap/base/alpine_core.py"


class StableBaseContractTests(unittest.TestCase):
    def setUp(self):
        self.source = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))

    def test_candidate_is_usb_only_and_not_promotable_yet(self):
        self.assertEqual(self.source["$schema"], "prototype-ordax.stable-base-source/1")
        self.assertEqual(self.source["status"], "candidate-not-promotable")
        self.assertEqual(self.source["product_scope"], "stable-mvp-usb-only")
        self.assertFalse(self.source["build"]["physical_artifact_authorized"])
        self.assertFalse(self.source["build"]["signed_update_integration_implemented"])
        self.assertFalse(self.source["build"]["qemu_boot_proven"])
        self.assertFalse(self.source["build"]["physical_boot_proven"])

    def test_stable_base_has_no_git_checkout_or_development_helpers(self):
        self.assertNotIn("git", self.source["packages"])
        self.assertFalse(self.source["git_client_allowed"])
        self.assertFalse(self.source["source_checkout_allowed"])
        self.assertFalse(self.source["development_helpers_allowed"])
        text = BUILDER.read_text(encoding="utf-8")
        self.assertIn('"usr/bin/git"', text)
        self.assertIn('"usr/local/bin/ordax-pull"', text)
        self.assertIn('"sbin/ordax-dev-init"', text)
        self.assertIn("forbidden development path", text)
        self.assertNotIn("bootstrap/dev-base/ordax-pull", text)

    def test_shared_alpine_kernel_and_firmware_implementation_is_reused(self):
        build = self.source["build"]
        self.assertEqual(build["shared_alpine_core"], "bootstrap/base/alpine_core.py")
        self.assertEqual(build["shared_firmware_policy"], "bootstrap/base/firmware_policy.py")
        self.assertEqual(build["shared_runtime_policy"], "bootstrap/base/runtime_policy.py")
        text = BUILDER.read_text(encoding="utf-8")
        self.assertIn("CORE.select_module_members", text)
        self.assertIn("FIRMWARE.available_firmware_names", text)
        self.assertIn("RUNTIME.prune_build_only_runtime", text)

    def test_upstream_and_full_transitive_package_lock_are_pinned(self):
        alpine = self.source["alpine"]
        self.assertRegex(alpine["archive_sha256"], r"^[0-9a-f]{64}$")
        self.assertTrue(
            alpine["archive_hash_pin_status"].startswith(
                "pinned-from-verified-candidate-"
            )
        )
        self.assertTrue(self.source["apk_package_versions_pinned"])
        self.assertTrue(
            self.source["apk_package_lock_status"].startswith(
                "pinned-from-verified-candidate-"
            )
        )
        lock = self.source["apk_package_lock"]
        self.assertIsInstance(lock, dict)
        self.assertEqual(len(lock), 40)
        self.assertEqual(self.source["apk_package_lock_count"], len(lock))
        self.assertEqual(
            self.source["apk_package_lock_scope"],
            "all-installed-packages-including-transitive-dependencies",
        )
        self.assertEqual(
            self.source["apk_install_policy"],
            "full-transitive-lock-exact-version-specs",
        )
        self.assertTrue(set(self.source["packages"]).issubset(lock))
        self.assertNotIn("pin-alpine-minirootfs-sha256", self.source["promotion_blockers"])
        self.assertNotIn("lock-exact-apk-package-versions", self.source["promotion_blockers"])

    def test_wifi_module_payload_and_coldplug_roots_are_explicit(self):
        modules = self.source["kernel_modules"]
        self.assertEqual(
            modules["required_basenames"],
            ["iwlwifi", "iwlmvm", "rtl8xxxu", "mt76x2u", "ath9k_htc"],
        )
        self.assertEqual(
            modules["coldplug_entrypoints"],
            ["iwlwifi", "rtl8xxxu", "mt76x2u", "ath9k_htc"],
        )
        self.assertTrue(
            set(modules["coldplug_entrypoints"]).issubset(modules["required_basenames"])
        )
        self.assertIn("iwlmvm", modules["required_basenames"])
        self.assertNotIn("iwlmvm", modules["coldplug_entrypoints"])

        builder = BUILDER.read_text(encoding="utf-8")
        self.assertIn("Stable Base required kernel module list is invalid", builder)
        self.assertIn("Stable Base coldplug entrypoints are invalid", builder)
        self.assertIn("set(coldplug_entrypoints).issubset(required_modules)", builder)

    def test_stable_base_is_complete_os_base_but_not_product_release(self):
        rootfs = self.source["rootfs"]
        self.assertEqual(rootfs["format"], "erofs")
        self.assertEqual(rootfs["artifact_name"], "stable-base.erofs")
        self.assertEqual(rootfs["target_path"], ".ordax/base/stable-base.erofs")
        self.assertTrue(rootfs["read_only"])
        self.assertTrue(rootfs["complete_minimal_os_userspace"])
        self.assertFalse(rootfs["product_system_tree_embedded"])
        self.assertFalse(rootfs["surface_runtime_embedded"])
        self.assertFalse(rootfs["mutable_state_embedded"])

    def test_stable_init_requires_verified_portable_identity(self):
        text = INIT.read_text(encoding="utf-8")
        self.assertIn('ORDAX_DISTRIBUTION_PROFILE:-}" = "stable-mvp"', text)
        self.assertIn('ORDAX_PRODUCT_MODE:-}" = "usb"', text)
        self.assertIn('ORDAX_STABLE_LAYOUT:-}" = "portable-v2"', text)
        self.assertIn('ORDAX_SOURCE_SHA', text)
        self.assertIn("[ -x /system/entrypoint ]", text)
        self.assertIn('ORDAX_RELEASE_MANIFEST_SCHEMA', text)
        self.assertIn('verified-erofs-overlay', text)
        self.assertIn('/run/ordax/runtime/native-surface/rootfs', text)
        self.assertIn('ORDAX_SURFACE_RUNTIME_SHA256', text)
        self.assertIn('validate_local_ai_runtime', text)
        self.assertIn('ORDAX_LOCAL_AI_RUNTIME_MODE', text)
        self.assertIn('/run/ordax/runtime/local-ai', text)
        self.assertIn('ORDAX_LOCAL_AI_RUNTIME_SHA256', text)
        self.assertIn('ORDAX_LOCAL_AI_BACKEND=DEGRADED', text)
        self.assertIn('ORDAX_LOCAL_AI_BACKEND=STARTED', text)
        self.assertIn('probe_local_ai_hardware', text)
        self.assertIn('if ! probe_local_ai_hardware; then', text)
        self.assertIn('if ! create_local_ai_auth; then', text)
        self.assertIn('LLAMA_ARG_API_KEY_FILE=/run/ordax/local-ai-auth/key', text)
        self.assertIn('local_ai_key=$(od -An -tx1 -N32 /dev/urandom', text)
        self.assertIn('stat -c', text)
        self.assertIn('disable_local_ai "ephemeral inference authorization unavailable"', text)
        self.assertLess(text.index('if ! create_local_ai_auth; then'), text.index('>/run/ordax/local-ai.log 2>&1 &'))
        self.assertIn('runtime-artifact-architecture-mismatch', text)
        self.assertIn('ORDAX_LOCAL_AI_HARDWARE_PROBE=PASS', text)
        self.assertIn('ORDAX_LOCAL_AI_HARDWARE_ARCH=', text)
        self.assertIn('ORDAX_LOCAL_AI_HARDWARE_LOGICAL_CPUS=', text)
        self.assertIn('ORDAX_LOCAL_AI_HARDWARE_MEM_TOTAL_KIB=', text)
        probe_call = text.index('if ! probe_local_ai_hardware; then')
        backend_spawn = text.index('>/run/ordax/local-ai.log 2>&1 &')
        self.assertLess(probe_call, backend_spawn)
        probe_start = text.index('probe_local_ai_hardware() {')
        probe_end = text.index('\nstart_local_ai() {', probe_start)
        probe_block = text[probe_start:probe_end]
        self.assertNotIn("python", probe_block.lower())
        self.assertIn('disable_local_ai "${LOCAL_AI_PROBE_REASON:-hardware probe failed}"', text)
        self.assertIn('start_local_ai', text)
        self.assertIn('4)', text)
        self.assertIn('ORDAX_STABLE_INIT_HANDOFF=VERIFIED', text)
        self.assertIn('ORDAX_STABLE_INIT_SOURCE_SHA=$ORDAX_SOURCE_SHA', text)
        self.assertIn("exec /system/entrypoint", text)
        self.assertIn('/bin/busybox timeout -k 1 3 /sbin/modprobe "$module"', text)
        self.assertIn('ORDAX_WIFI_COLDPLUG_TIMEOUTS=$timed_out', text)
        self.assertIn('Wi-Fi coldplug timed out for $module', text)
        self.assertNotIn('if /sbin/modprobe "$module"', text)
        self.assertNotIn("git", text.lower())

    def test_builder_records_and_enforces_full_transitive_apk_lock(self):
        text = BUILDER.read_text(encoding="utf-8")
        self.assertIn("def installed_apk_lock(", text)
        self.assertIn("lib/apk/db/installed", text)
        self.assertIn("def verify_apk_lock(", text)
        self.assertIn("def exact_apk_install_specs(", text)
        self.assertIn('f"{name}={version}"', text)
        self.assertIn('"apk add --no-cache " + " ".join(package_specs)', text)
        self.assertIn('"installed_packages": installed_packages', text)
        self.assertIn('"apk_package_lock_matches_contract"', text)
        self.assertIn('"exact_package_spec_count": len(package_specs)', text)
        self.assertIn("dereference=True", text)

    def test_normalized_tar_serializes_hardlinks_as_regular_files(self):
        namespace = {}
        module = ast.parse(BUILDER.read_text(encoding="utf-8"))
        fn = next(
            node for node in module.body
            if isinstance(node, ast.FunctionDef) and node.name == "normalized_tar"
        )
        mini = ast.Module(
            body=[
                ast.Import(names=[ast.alias(name="tarfile")]),
                ast.ImportFrom(
                    module="pathlib",
                    names=[ast.alias(name="Path")],
                    level=0,
                ),
                fn,
            ],
            type_ignores=[],
        )
        code = compile(ast.fix_missing_locations(mini), str(BUILDER), "exec")
        exec(code, namespace)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            rootfs = root / "rootfs"
            (rootfs / "bin").mkdir(parents=True)
            busybox = rootfs / "bin/busybox"
            busybox.write_bytes(b"busybox-fixture\n")
            busybox.chmod(0o755)
            os.link(busybox, rootfs / "bin/ash")
            archive_path = root / "stable-base.tar"
            namespace["normalized_tar"](rootfs, archive_path)

            with tarfile.open(archive_path, "r:") as archive:
                members = {member.name: member for member in archive.getmembers()}
                self.assertTrue(members["bin/busybox"].isfile())
                self.assertTrue(members["bin/ash"].isfile())
                self.assertFalse(members["bin/ash"].islnk())
                self.assertFalse(members["bin/ash"].issym())
                self.assertEqual(
                    archive.extractfile(members["bin/ash"]).read(),
                    b"busybox-fixture\n",
                )

    def test_common_module_selector_is_profile_neutral_with_dev_compatibility(self):
        text = COMMON.read_text(encoding="utf-8")
        self.assertIn("def select_module_members(", text)
        self.assertIn("def select_dev_module_members(", text)
        self.assertIn("WIFI_MODULE_BASENAMES", text)
        self.assertIn("DEV_MODULE_BASENAMES = WIFI_MODULE_BASENAMES", text)


if __name__ == "__main__":
    unittest.main()
