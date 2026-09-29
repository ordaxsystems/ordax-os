from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import hashlib
import json
import os
import stat
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
MODULE = RUNTIME / "native_profile_component_inventory.py"
HOST = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
ADAPTER = ROOT / "system" / "adapters" / "native" / "profile-component-inventory.mjs"


def load_module():
    sys.path.insert(0, str(RUNTIME))
    try:
        spec = spec_from_file_location("ordax_profile_component_inventory_test", MODULE)
        module = module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(RUNTIME))


def write_receipt(root: Path, installed_at=1234):
    receipt = {
        "schema": "ordax.profile-install-receipt/1",
        "artifact": {
            "id": "knowledge.example",
            "kind": "knowledge-pack",
            "version": "1.2.3",
            "sha256": "a" * 64,
            "sizeBytes": 4096,
        },
        "verification": {
            "signatureAlgorithm": "ed25519",
            "keyId": "profile-content-test-1",
            "manifestSha256": "c" * 64,
            "verifiedAt": installed_at - 20,
        },
        "health": {
            "schema": "ordax.profile-content-health/1",
            "state": "healthy",
            "entryCount": 1,
            "perEntryHashVerified": True,
            "perEntryProvenanceVerified": True,
            "executablePayloadAllowed": False,
            "authority": "none",
            "checkedAt": installed_at - 10,
        },
        "installedAt": installed_at,
    }
    payload = (json.dumps(receipt, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()
    root.mkdir(mode=0o700)
    path = root / f"{digest}.json"
    path.write_bytes(payload)
    os.chmod(path, 0o600)
    return digest, path


class NativeProfileComponentInventoryTests(unittest.TestCase):
    def test_missing_inventory_is_empty_device_state(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "missing.json")
            inventory = module.read_profile_component_inventory(path)
        self.assertEqual(inventory["schema"], "ordax.profile-component-inventory/1")
        self.assertEqual(inventory["revision"], 0)
        self.assertEqual(inventory["persistence"], "device")
        self.assertEqual(inventory["entries"], [])

    def test_valid_private_inventory_is_read_and_content_addressed(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "inventory.json"
            payload = {
                "schema": "ordax.profile-component-inventory/1",
                "revision": 3,
                "persistence": "device",
                "entries": [{
                    "id": "knowledge.example",
                    "kind": "knowledge-pack",
                    "version": "1.2.3",
                    "sha256": "a" * 64,
                    "installedAt": 1234,
                    "receiptSha256": "b" * 64,
                }],
            }
            path.write_text(json.dumps(payload), encoding="utf-8")
            os.chmod(path, 0o600)
            self.assertEqual(module.read_profile_component_inventory(str(path)), payload)

    def test_verified_inventory_revalidates_receipt_content_address_and_identity(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            receipt_sha, receipt_path = write_receipt(root / "receipts")
            path = root / "inventory.json"
            payload = {
                "schema": "ordax.profile-component-inventory/1",
                "revision": 1,
                "persistence": "device",
                "entries": [{
                    "id": "knowledge.example",
                    "kind": "knowledge-pack",
                    "version": "1.2.3",
                    "sha256": "a" * 64,
                    "installedAt": 1234,
                    "receiptSha256": receipt_sha,
                }],
            }
            path.write_text(json.dumps(payload), encoding="utf-8")
            os.chmod(path, 0o600)
            self.assertEqual(
                module.read_verified_profile_component_inventory(
                    str(path), str(root / "receipts")
                ),
                payload,
            )
            receipt_path.write_text("tampered\n", encoding="utf-8")
            os.chmod(receipt_path, 0o600)
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                module.read_verified_profile_component_inventory(
                    str(path), str(root / "receipts")
                )

    def test_inventory_rejects_wrong_hash_duplicate_and_unsafe_permissions(self):
        module = load_module()
        base = {
            "schema": "ordax.profile-component-inventory/1",
            "revision": 1,
            "persistence": "device",
            "entries": [{
                "id": "knowledge.example",
                "kind": "knowledge-pack",
                "version": "1.2.3",
                "sha256": "a" * 64,
                "installedAt": 1234,
                "receiptSha256": "b" * 64,
            }],
        }
        self.assertTrue(module.valid_profile_component_inventory(base))

        bad_hash = json.loads(json.dumps(base))
        bad_hash["entries"][0]["sha256"] = "bad"
        self.assertFalse(module.valid_profile_component_inventory(bad_hash))

        duplicate = json.loads(json.dumps(base))
        duplicate["entries"].append(dict(duplicate["entries"][0]))
        self.assertFalse(module.valid_profile_component_inventory(duplicate))

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "inventory.json"
            path.write_text(json.dumps(base), encoding="utf-8")
            os.chmod(path, 0o644)
            with self.assertRaisesRegex(ValueError, "boundary is unsafe"):
                module.read_profile_component_inventory(str(path))

    def test_internal_writer_is_atomic_private_and_round_trips(self):
        module = load_module()
        payload = {
            "schema": "ordax.profile-component-inventory/1",
            "revision": 2,
            "persistence": "device",
            "entries": [{
                "id": "skill.example",
                "kind": "skill-pack",
                "version": "2.0.0",
                "sha256": "c" * 64,
                "installedAt": 2000,
                "receiptSha256": "d" * 64,
            }],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "nested" / "inventory.json"
            module.write_profile_component_inventory(payload, str(path))
            self.assertEqual(module.read_profile_component_inventory(str(path)), payload)
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(os.stat(path.parent).st_mode), 0o700)
            self.assertFalse(list(path.parent.glob("*.tmp.*")))

    def test_surface_boundary_is_read_only_and_loopback_scoped(self):
        host = HOST.read_text(encoding="utf-8")
        adapter = ADAPTER.read_text(encoding="utf-8")
        self.assertIn(
            'PROFILE_COMPONENT_INVENTORY_PATH = "/__ordax/native/profile-component-inventory"',
            host,
        )
        self.assertIn("read_verified_profile_component_inventory", host)
        self.assertIn("if self.path == PROFILE_COMPONENT_INVENTORY_PATH:", host)
        self.assertNotIn("write_profile_component_inventory", host)
        self.assertIn(
            'ENDPOINT = "/__ordax/native/profile-component-inventory"',
            adapter,
        )
        self.assertIn('method: "GET"', adapter)
        self.assertNotIn('method: "POST"', adapter)


if __name__ == "__main__":
    unittest.main()
