"""Owner USB Native MCP handoff: actual shell staging and denial tests.

No CI fixture is a signed Stable runtime, enrolled device or physical USB.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "system/services/device-agent/owner-dev-native-product.sh"
COMMIT = "a" * 40
BASE = "b" * 40
ROOTFS = "c" * 64
PATHS = (
    ("ordax-product-agent", "binary"),
    ("portable-lib/ld-musl-x86_64.so.1", "loader"),
    ("portable-lib/libc.musl-x86_64.so.1", "libc"),
    ("portable-lib/libz.so.1", "zlib"),
)


class OwnerDevNativeHandoffTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="ordax-native-dev-test-")
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.system = self.root / "system"
        self.state = self.root / "state"
        self.data = self.root / "data"
        self.stage = self.data / ".ordax/updates/owner-native-product"
        self.pin = self.system / "services/device-agent/owner-dev-native-product.txt"
        self.pin.parent.mkdir(parents=True)
        (self.state / "native-state").mkdir(parents=True)
        (self.stage / "portable-lib").mkdir(parents=True)
        # These are fake launchers only for exercising the POSIX lifecycle
        # contract. Their hashes are fixture-generated, not production pins.
        fake_binary = b"#!/bin/sh\nprintf 'OWNER_DEV_TEST_AGENT_OK\\n'\n"
        fake_loader = b"#!/bin/sh\n[ \"$1\" = --library-path ] || exit 8\nshift 2\nexec \"$@\"\n"
        fake_zlib = b"fake-zlib-byte-fixture"
        contents = {
            "ordax-product-agent": fake_binary,
            "portable-lib/ld-musl-x86_64.so.1": fake_loader,
            "portable-lib/libc.musl-x86_64.so.1": fake_loader,
            "portable-lib/libz.so.1": fake_zlib,
        }
        for name, raw in contents.items():
            path = self.stage / name
            path.write_bytes(raw)
        keys = {
            name: (hashlib.sha256(raw).hexdigest(), len(raw))
            for name, raw in contents.items()
        }
        self.pin.write_text(
            "schema=ordax.owner-dev-native-product/1\n"
            f"runtime_source_commit={COMMIT}\n"
            f"os_base_commit={BASE}\n"
            f"os_base_rootfs_sha256={ROOTFS}\n"
            "runtime_ci_run_id=45060798773\n"
            "offline_base_proof_run_id=45060943271\n"
            f"binary_sha256={keys['ordax-product-agent'][0]}\n"
            f"binary_bytes={keys['ordax-product-agent'][1]}\n"
            f"loader_sha256={keys['portable-lib/ld-musl-x86_64.so.1'][0]}\n"
            f"loader_bytes={keys['portable-lib/ld-musl-x86_64.so.1'][1]}\n"
            f"libc_sha256={keys['portable-lib/libc.musl-x86_64.so.1'][0]}\n"
            f"libc_bytes={keys['portable-lib/libc.musl-x86_64.so.1'][1]}\n"
            f"zlib_sha256={keys['portable-lib/libz.so.1'][0]}\n"
            f"zlib_bytes={keys['portable-lib/libz.so.1'][1]}\n",
            encoding="ascii",
        )
        (self.stage / self.pin.name).write_bytes(self.pin.read_bytes())

    def execute(self, body: str, profile="owner-development", base=BASE, mode="usb"):
        script = (
            "set -eu\n"
            f"SYSTEM_ROOT='{self.system}'\n"
            f"STATE_DIR='{self.state}'\n"
            f"DISTRIBUTION_PROFILE='{profile}'\n"
            f"PRODUCT_MODE='{mode}'\n"
            f"ORDAX_DEV_ROOT_COMMIT='{base}'\n"
            f". '{HELPER}'\n"
            f"{body}\n"
        )
        return subprocess.run(
            ["sh", "-c", script], capture_output=True, text=True,
            timeout=25, env={**os.environ, "LC_ALL": "C"},
        )

    def slot(self):
        return self.state / "native-state/owner-dev-native/versions" / COMMIT

    def test_exact_git_pinned_owner_usb_stage_launch_and_idempotent_reuse(self):
        body = (
            f"owner_dev_native_stage_on_mounted_data '{self.data}'\n"
            f"owner_dev_native_stage_on_mounted_data '{self.data}'\n"
            "owner_dev_native_verified_plan\n"
            'case "$NATIVE_PRODUCT_VERIFIED_PLAN" in *"OWNER_DEV_NATIVE_RUNTIME=VERIFIED"*) ;; *) exit 6 ;; esac\n'
            "owner_dev_native_run_verified --self-test\n"
        )
        result = self.execute(body)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("OWNER_DEV_TEST_AGENT_OK", result.stdout)
        self.assertTrue((self.slot() / "portable-lib/ld-musl-x86_64.so.1").is_file())
        self.assertTrue((self.slot() / "ordax-product-agent").is_file())

    def test_content_modified_on_exfat_is_never_copied(self):
        (self.stage / "portable-lib/libz.so.1").write_bytes(b"tampered")
        result = self.execute(f"owner_dev_native_stage_on_mounted_data '{self.data}'")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.slot().exists())

    def test_attacker_changed_manifest_is_rejected_before_copy(self):
        (self.stage / self.pin.name).write_text(self.pin.read_text().replace(
            f"runtime_source_commit={COMMIT}",
            "runtime_source_commit=" + "0" * 40,
        ))
        result = self.execute(f"owner_dev_native_stage_on_mounted_data '{self.data}'")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.slot().exists())

    def test_symlink_to_external_file_is_rejected(self):
        f = self.stage / "portable-lib/libz.so.1"
        f.unlink()
        external = self.root / "outside"
        external.write_bytes(b"external")
        f.symlink_to(external)
        result = self.execute(f"owner_dev_native_stage_on_mounted_data '{self.data}'")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.slot().exists())

    def test_profile_and_device_scope_are_mandatory(self):
        for profile,mode in (("stable-mvp","usb"), ("owner-development","native-disk")):
            with self.subTest(profile=profile,mode=mode):
                result=self.execute(
                    f"owner_dev_native_stage_on_mounted_data '{self.data}'",
                    profile=profile, mode=mode,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(self.slot().exists())

    def test_wrong_active_os_base_does_not_create_launch_plan(self):
        step = self.execute(f"owner_dev_native_stage_on_mounted_data '{self.data}'")
        self.assertEqual(step.returncode, 0, step.stderr)
        result = self.execute(
            "owner_dev_native_verified_plan",
            base="d" * 40,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(self.slot().exists())

    def test_staged_slot_corruption_is_denied(self):
        step = self.execute(f"owner_dev_native_stage_on_mounted_data '{self.data}'")
        self.assertEqual(step.returncode, 0, step.stderr)
        library = self.slot() / "portable-lib/libz.so.1"
        # The installer made it read-only. Simulate privileged corruption,
        # not accidental ordinary-user writes (which are correctly denied).
        library.chmod(0o600)
        library.write_bytes(b"corrupted-after-copy")
        self.assertNotEqual(self.execute("owner_dev_native_verified_plan").returncode, 0)
        # Cannot overwrite even from a valid USB when an installed version
        # already conflicts. Leave state unchanged for explicit diagnosis.
        result=self.execute(f"owner_dev_native_stage_on_mounted_data '{self.data}'")
        self.assertNotEqual(result.returncode, 0)

    def test_supervisor_reuses_its_existing_media_identity_mount(self):
        supervisor=(ROOT/"system/supervisor").read_text()
        native=(ROOT/"system/services/device-agent/native-product-lifecycle.sh").read_text()
        self.assertIn('owner_dev_native_stage_on_mounted_data "$owner_cache_mount"',supervisor)
        self.assertLess(
            supervisor.index('owner_dev_native_stage_on_mounted_data "$owner_cache_mount"'),
            supervisor.index('if ! /bin/busybox umount "$owner_cache_mount"'),
        )
        self.assertIn('owner_dev_native_verified_plan',native)
        self.assertIn('owner-development-portable)',native)
        self.assertIn('native_product_run_selected "$@"',native)
        self.assertIn('if native_product_verified_plan;',native)
        self.assertIn('if native_product_owner_dev_buildroot_plan;',native)


if __name__ == "__main__":
    unittest.main()
