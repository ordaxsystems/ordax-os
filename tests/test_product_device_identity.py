import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "system" / "surface" / "runtime" / "product_device_identity.py"

spec = importlib.util.spec_from_file_location("ordax_product_device_identity_test", MODULE)
identity = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = identity
spec.loader.exec_module(identity)


class ProductDeviceIdentityTests(unittest.TestCase):
    def test_state_dir_must_be_absolute(self):
        with self.assertRaises(ValueError):
            identity.ProductDeviceIdentityStore("relative/state")

    def test_enrollment_material_is_private_stable_and_hash_only_for_server(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = identity.ProductDeviceIdentityStore(temporary)
            first = store.prepare_enrollment()
            second = store.prepare_enrollment()

            self.assertEqual(first, second)
            self.assertRegex(first.device_token, r"^[0-9a-f]{64}$")
            self.assertRegex(first.token_sha256, r"^[0-9a-f]{64}$")
            self.assertRegex(first.machine_binding_sha256, r"^[0-9a-f]{64}$")
            self.assertNotEqual(first.device_token, first.token_sha256)

            local = store.local_path
            self.assertEqual(stat.S_IMODE(local.stat().st_mode), 0o600)
            payload = json.loads(local.read_text(encoding="utf-8"))
            self.assertEqual(set(payload), {"device_token", "machine_binding_secret"})
            self.assertNotIn("device_id", payload)
            self.assertNotIn("account", local.read_text(encoding="utf-8").lower())
            self.assertNotIn("cookie", local.read_text(encoding="utf-8").lower())

    def test_insecure_or_symlink_local_identity_is_not_reused(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = identity.ProductDeviceIdentityStore(temporary)
            store._ensure_root()
            store.local_path.write_text(
                json.dumps({"device_token": "a" * 64, "machine_binding_secret": "b" * 64}),
                encoding="utf-8",
            )
            os.chmod(store.local_path, 0o644)
            material = store.prepare_enrollment()
            self.assertNotEqual(material.device_token, "a" * 64)
            self.assertEqual(stat.S_IMODE(store.local_path.stat().st_mode), 0o600)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            store = identity.ProductDeviceIdentityStore(temporary)
            store._ensure_root()
            target = root / "outside.json"
            target.write_text(
                json.dumps({"device_token": "c" * 64, "machine_binding_secret": "d" * 64}),
                encoding="utf-8",
            )
            os.chmod(target, 0o600)
            store.local_path.symlink_to(target)
            material = store.prepare_enrollment()
            self.assertFalse(store.local_path.is_symlink())
            self.assertNotEqual(material.device_token, "c" * 64)
            self.assertEqual(
                json.loads(target.read_text(encoding="utf-8")),
                {"device_token": "c" * 64, "machine_binding_secret": "d" * 64},
            )
            self.assertEqual(stat.S_IMODE(store.local_path.stat().st_mode), 0o600)

    def test_enrollment_payload_contains_no_raw_secret_or_account_token(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = identity.ProductDeviceIdentityStore(temporary)
            payload = store.enrollment_payload(
                device_name="Notebook OrdaX",
                device_kind="laptop",
                channel="development",
            )
            self.assertEqual(payload["operation"], "enroll")
            self.assertEqual(payload["device_name"], "Notebook OrdaX")
            self.assertEqual(payload["device_kind"], "laptop")
            self.assertEqual(payload["channel"], "development")
            self.assertRegex(payload["token_sha256"], r"^[0-9a-f]{64}$")
            self.assertRegex(payload["machine_binding_sha256"], r"^[0-9a-f]{64}$")
            encoded = json.dumps(payload).lower()
            self.assertNotIn("device_token", encoded)
            self.assertNotIn("machine_binding_secret", encoded)
            self.assertNotIn("ordax_access", encoded)
            self.assertNotIn("ordax_refresh", encoded)

    def test_commit_writes_only_presence_credential_contract(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = identity.ProductDeviceIdentityStore(temporary)
            material = store.prepare_enrollment()
            path = store.commit_enrollment("123e4567-e89b-42d3-a456-426614174000")
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(
                payload,
                {
                    "device_id": "123e4567-e89b-42d3-a456-426614174000",
                    "device_token": material.device_token,
                },
            )
            self.assertNotIn("machine_binding", path.read_text(encoding="utf-8"))
            self.assertNotIn("account", path.read_text(encoding="utf-8").lower())

    def test_invalid_metadata_fails_before_enrollment(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = identity.ProductDeviceIdentityStore(temporary)
            for bad_name in ("", "   ", "x" * 121, "bad\nname"):
                with self.assertRaises(ValueError):
                    store.enrollment_payload(
                        device_name=bad_name,
                        device_kind="laptop",
                        channel="development",
                    )
            with self.assertRaises(ValueError):
                store.enrollment_payload(
                    device_name="Notebook",
                    device_kind="unknown",
                    channel="development",
                )
            with self.assertRaises(ValueError):
                store.enrollment_payload(
                    device_name="Notebook",
                    device_kind="laptop",
                    channel="preview",
                )
            with self.assertRaises(identity.ProductDeviceIdentityError):
                store.commit_enrollment("not-a-uuid")

    def test_module_does_not_use_hardware_serial_mac_or_network(self):
        source = MODULE.read_text(encoding="utf-8").lower()
        for forbidden in (
            "/sys/class/dmi",
            "machine-id",
            "mac_address",
            "getnode",
            "urllib",
            "requests",
            "socket",
            "subprocess",
            "ordax_access",
            "ordax_refresh",
        ):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
