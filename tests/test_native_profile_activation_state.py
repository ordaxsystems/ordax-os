from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import json
import os
import stat
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
MODULE = RUNTIME / "native_profile_activation_state.py"
HOST = RUNTIME / "native_host_server.py"


def load_module():
    sys.path.insert(0, str(RUNTIME))
    try:
        spec = spec_from_file_location("ordax_profile_activation_state_test", MODULE)
        module = module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(RUNTIME))


def inventory(entries=None):
    return {
        "schema": "ordax.profile-component-inventory/1",
        "revision": 1,
        "persistence": "device",
        "entries": entries or [],
    }


def component():
    return {
        "id": "knowledge.example",
        "kind": "knowledge-pack",
        "version": "1.2.3",
        "sha256": "a" * 64,
        "receiptSha256": "b" * 64,
        "installedAt": 1000,
    }


def activation(slug="developer", version=1, components=None, activated_at=1200):
    return {
        "profile": {"slug": slug, "version": version},
        "components": [component()] if components is None else components,
        "activatedAt": activated_at,
    }


class NativeProfileActivationStateTests(unittest.TestCase):
    def test_missing_state_is_empty_private_device_state(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            state = module.read_profile_activation_state(
                str(Path(directory) / "missing.json")
            )
        self.assertEqual(state, {
            "schema": "ordax.profile-activation-state/1",
            "revision": 0,
            "persistence": "device",
            "spaces": [],
        })

    def test_state_rejects_user_data_and_unsafe_file_boundary(self):
        module = load_module()
        bad = {
            "schema": "ordax.profile-activation-state/1",
            "revision": 1,
            "persistence": "device",
            "spaces": [{
                "spaceId": "space-1",
                "spaceKind": "professional",
                "current": {
                    **activation(components=[]),
                    "memory": {"content": "forbidden"},
                },
                "previous": None,
            }],
        }
        with self.assertRaisesRegex(ValueError, "fields are incompatible"):
            module.validate_profile_activation_state(bad)

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            path.write_text(json.dumps(module.empty_profile_activation_state()), encoding="utf-8")
            os.chmod(path, 0o644)
            with self.assertRaisesRegex(ValueError, "boundary is unsafe"):
                module.read_profile_activation_state(str(path))

    def test_atomic_writer_is_private_and_round_trips(self):
        module = load_module()
        state = {
            "schema": "ordax.profile-activation-state/1",
            "revision": 1,
            "persistence": "device",
            "spaces": [{
                "spaceId": "space-1",
                "spaceKind": "professional",
                "current": activation(components=[]),
                "previous": None,
            }],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state" / "activation.json"
            module.write_profile_activation_state(state, str(path))
            self.assertEqual(module.read_profile_activation_state(str(path)), state)
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(os.stat(path.parent).st_mode), 0o700)
            self.assertFalse(list(path.parent.glob(".profile-activation.tmp.*")))

    def test_activation_requires_exact_installed_component_receipt(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inventory_path = root / "inventory.json"
            state_path = root / "activation.json"
            lock_path = root / "activation.lock"
            inventory_path.write_text(json.dumps(inventory([component()])), encoding="utf-8")
            os.chmod(inventory_path, 0o600)

            result = module.activate_profile(
                space_id="space-1",
                space_kind="professional",
                activation=activation(),
                state_path=str(state_path),
                inventory_path=str(inventory_path),
                lock_path=str(lock_path),
            )
            self.assertTrue(result["changed"])
            self.assertEqual(result["state"]["revision"], 1)
            self.assertEqual(
                result["state"]["spaces"][0]["current"]["components"][0]["receiptSha256"],
                "b" * 64,
            )

            stale = activation()
            stale["components"][0]["receiptSha256"] = "c" * 64
            with self.assertRaisesRegex(ValueError, "receipt does not match inventory"):
                module.activate_profile(
                    space_id="space-2",
                    space_kind="professional",
                    activation=stale,
                    state_path=str(state_path),
                    inventory_path=str(inventory_path),
                    lock_path=str(lock_path),
                )

    def test_activate_deactivate_rollback_preserves_previous_without_touching_user_data(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inventory_path = root / "inventory.json"
            state_path = root / "activation.json"
            lock_path = root / "activation.lock"
            inventory_path.write_text(json.dumps(inventory()), encoding="utf-8")
            os.chmod(inventory_path, 0o600)

            first = module.activate_profile(
                space_id="space-1",
                space_kind="professional",
                activation=activation(components=[], activated_at=1000),
                state_path=str(state_path),
                inventory_path=str(inventory_path),
                lock_path=str(lock_path),
            )
            self.assertTrue(first["changed"])

            duplicate = module.activate_profile(
                space_id="space-1",
                space_kind="professional",
                activation=activation(components=[], activated_at=2000),
                state_path=str(state_path),
                inventory_path=str(inventory_path),
                lock_path=str(lock_path),
            )
            self.assertFalse(duplicate["changed"])
            self.assertEqual(duplicate["state"]["revision"], 1)
            self.assertEqual(
                duplicate["state"]["spaces"][0]["current"]["activatedAt"],
                1000,
            )

            second = module.activate_profile(
                space_id="space-1",
                space_kind="professional",
                activation=activation(
                    slug="business",
                    components=[],
                    activated_at=3000,
                ),
                state_path=str(state_path),
                inventory_path=str(inventory_path),
                lock_path=str(lock_path),
            )
            row = second["state"]["spaces"][0]
            self.assertEqual(row["current"]["profile"]["slug"], "business")
            self.assertEqual(row["previous"]["profile"]["slug"], "developer")

            rolled = module.rollback_profile(
                space_id="space-1",
                state_path=str(state_path),
                inventory_path=str(inventory_path),
                lock_path=str(lock_path),
            )
            row = rolled["state"]["spaces"][0]
            self.assertEqual(row["current"]["profile"]["slug"], "developer")
            self.assertEqual(row["previous"]["profile"]["slug"], "business")

            deactivated = module.deactivate_profile(
                space_id="space-1",
                state_path=str(state_path),
                lock_path=str(lock_path),
            )
            row = deactivated["state"]["spaces"][0]
            self.assertIsNone(row["current"])
            self.assertEqual(row["previous"]["profile"]["slug"], "developer")

            restored = module.rollback_profile(
                space_id="space-1",
                state_path=str(state_path),
                inventory_path=str(inventory_path),
                lock_path=str(lock_path),
            )
            self.assertEqual(
                restored["state"]["spaces"][0]["current"]["profile"]["slug"],
                "developer",
            )

    def test_rollback_fails_closed_if_previous_component_is_no_longer_installed(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inventory_path = root / "inventory.json"
            state_path = root / "activation.json"
            lock_path = root / "activation.lock"
            inventory_path.write_text(json.dumps(inventory([component()])), encoding="utf-8")
            os.chmod(inventory_path, 0o600)

            module.activate_profile(
                space_id="space-1",
                space_kind="professional",
                activation=activation(),
                state_path=str(state_path),
                inventory_path=str(inventory_path),
                lock_path=str(lock_path),
            )
            module.activate_profile(
                space_id="space-1",
                space_kind="professional",
                activation=activation(slug="business", components=[], activated_at=2000),
                state_path=str(state_path),
                inventory_path=str(inventory_path),
                lock_path=str(lock_path),
            )

            inventory_path.write_text(json.dumps(inventory()), encoding="utf-8")
            os.chmod(inventory_path, 0o600)
            with self.assertRaisesRegex(ValueError, "not installed"):
                module.rollback_profile(
                    space_id="space-1",
                    state_path=str(state_path),
                    inventory_path=str(inventory_path),
                    lock_path=str(lock_path),
                )

    def test_existing_space_kind_cannot_change_silently(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inventory_path = root / "inventory.json"
            state_path = root / "activation.json"
            lock_path = root / "activation.lock"
            inventory_path.write_text(json.dumps(inventory()), encoding="utf-8")
            os.chmod(inventory_path, 0o600)

            module.activate_profile(
                space_id="space-1",
                space_kind="professional",
                activation=activation(components=[]),
                state_path=str(state_path),
                inventory_path=str(inventory_path),
                lock_path=str(lock_path),
            )
            with self.assertRaisesRegex(ValueError, "Space kind changed unexpectedly"):
                module.activate_profile(
                    space_id="space-1",
                    space_kind="personal",
                    activation=activation(slug="business", components=[], activated_at=2000),
                    state_path=str(state_path),
                    inventory_path=str(inventory_path),
                    lock_path=str(lock_path),
                )

    def test_native_state_rejects_identical_current_and_previous(self):
        module = load_module()
        same = activation(components=[])
        with self.assertRaisesRegex(ValueError, "current and previous must differ"):
            module.validate_profile_activation_state({
                "schema": "ordax.profile-activation-state/1",
                "revision": 1,
                "persistence": "device",
                "spaces": [{
                    "spaceId": "space-1",
                    "spaceKind": "professional",
                    "current": same,
                    "previous": {**same, "activatedAt": 500},
                }],
            })

    def test_native_http_host_separates_read_state_from_token_bound_commands(self):
        host = HOST.read_text(encoding="utf-8")
        self.assertIn(
            'PROFILE_ACTIVATION_STATE_PATH = "/__ordax/native/profile-activation-state"',
            host,
        )
        self.assertIn(
            'PROFILE_ACTIVATION_COMMAND_PATH = "/__ordax/native/profile-activation-command"',
            host,
        )
        self.assertIn(
            'PROFILE_ACTIVATION_TOKEN_HEADER = "X-OrdaX-Profile-Activation-Token"',
            host,
        )
        self.assertIn("read_profile_activation_state", host)
        self.assertIn("if self.path == PROFILE_ACTIVATION_STATE_PATH:", host)
        self.assertIn("if parsed_path == PROFILE_ACTIVATION_COMMAND_PATH:", host)
        self.assertIn("execute_profile_activation_command", host)
        self.assertIn('self.distribution_profile == "owner-development"', host)
        self.assertNotIn("activate_profile(", host)
        self.assertNotIn("deactivate_profile(", host)
        self.assertNotIn("rollback_profile(", host)


if __name__ == "__main__":
    unittest.main()
