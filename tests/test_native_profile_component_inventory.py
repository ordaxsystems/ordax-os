from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import json
import os
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "system" / "surface" / "runtime" / "native_profile_component_inventory.py"
HOST = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
ADAPTER = ROOT / "system" / "adapters" / "native" / "profile-component-inventory.mjs"


def load_module():
    spec = spec_from_file_location("ordax_profile_component_inventory_test", MODULE)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


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
                    "sha256": "a" * 64,
                    "installedAt": 1234,
                    "receiptSha256": "b" * 64,
                }],
            }
            path.write_text(json.dumps(payload), encoding="utf-8")
            os.chmod(path, 0o600)
            self.assertEqual(module.read_profile_component_inventory(str(path)), payload)

    def test_inventory_rejects_wrong_hash_duplicate_and_unsafe_permissions(self):
        module = load_module()
        base = {
            "schema": "ordax.profile-component-inventory/1",
            "revision": 1,
            "persistence": "device",
            "entries": [{
                "id": "knowledge.example",
                "kind": "knowledge-pack",
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

    def test_surface_boundary_is_read_only_and_loopback_scoped(self):
        host = HOST.read_text(encoding="utf-8")
        adapter = ADAPTER.read_text(encoding="utf-8")
        self.assertIn(
            'PROFILE_COMPONENT_INVENTORY_PATH = "/__ordax/native/profile-component-inventory"',
            host,
        )
        self.assertIn("read_profile_component_inventory", host)
        self.assertIn("if parsed_path == PROFILE_COMPONENT_INVENTORY_PATH:", host)
        self.assertNotIn("write_profile_component_inventory", host)
        self.assertIn(
            'ENDPOINT = "/__ordax/native/profile-component-inventory"',
            adapter,
        )
        self.assertIn('method: "GET"', adapter)
        self.assertNotIn('method: "POST"', adapter)


if __name__ == "__main__":
    unittest.main()
