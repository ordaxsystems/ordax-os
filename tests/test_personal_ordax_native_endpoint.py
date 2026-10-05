import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
sys.path.insert(0, str(RUNTIME))
MODULE = RUNTIME / "native_personal_ordax_endpoint.py"
spec = importlib.util.spec_from_file_location("native_personal_ordax_endpoint", MODULE)
endpoint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(endpoint)


def state(owner_kind="account", owner_id="user-1"):
    return {
        "schema": "ordax.personal-work-store-state/1",
        "ownerKind": owner_kind,
        "ownerId": None if owner_kind == "device" else owner_id,
        "nextOrdinal": 1,
        "workItems": [],
        "activities": [],
        "results": [],
        "approvals": [],
        "decisions": [],
        "attempts": [],
    }


def request(owner_kind="account", owner_id="user-1", revision=0):
    return {
        "action": "compare-and-swap",
        "ownerKind": owner_kind,
        "ownerId": None if owner_kind == "device" else owner_id,
        "expectedRevision": revision,
        "payload": json.dumps(state(owner_kind, owner_id), separators=(",", ":")),
    }


def body(value):
    return json.dumps(value, separators=(",", ":")).encode("utf-8")


class NativePersonalOrdaxEndpointTests(unittest.TestCase):
    def test_read_and_typed_cas_roundtrip(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "personal")
            self.assertEqual(
                endpoint.read_personal_ordax_endpoint("account", "user-1", root),
                {"record": None},
            )
            created = endpoint.mutate_personal_ordax_endpoint(body(request()), root)
            self.assertEqual(created, {"ok": True, "revision": 1})
            loaded = endpoint.read_personal_ordax_endpoint("account", "user-1", root)
            self.assertEqual(loaded["record"]["revision"], 1)
            self.assertEqual(loaded["record"]["ownerId"], "user-1")

    def test_stale_revision_is_conflict_and_does_not_replace_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "personal")
            endpoint.mutate_personal_ordax_endpoint(body(request()), root)
            updated = endpoint.mutate_personal_ordax_endpoint(body(request(revision=1)), root)
            self.assertEqual(updated["revision"], 2)
            with self.assertRaises(endpoint.PersonalOrdaxEndpointRequestError) as error:
                endpoint.mutate_personal_ordax_endpoint(body(request(revision=1)), root)
            self.assertEqual(error.exception.status_code, 409)
            self.assertEqual(
                endpoint.read_personal_ordax_endpoint("account", "user-1", root)["record"]["revision"],
                2,
            )

    def test_unknown_action_raw_shape_and_oversize_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "personal")
            raw = request()
            raw["action"] = "replace-state"
            with self.assertRaises(endpoint.PersonalOrdaxEndpointRequestError):
                endpoint.mutate_personal_ordax_endpoint(body(raw), root)
            malformed = request()
            malformed["extra"] = True
            with self.assertRaises(endpoint.PersonalOrdaxEndpointRequestError):
                endpoint.mutate_personal_ordax_endpoint(body(malformed), root)
            with self.assertRaises(endpoint.PersonalOrdaxEndpointRequestError) as error:
                endpoint.mutate_personal_ordax_endpoint(
                    b"x" * (endpoint.MAX_PERSONAL_ORDAX_REQUEST_BODY_BYTES + 1),
                    root,
                )
            self.assertEqual(error.exception.status_code, 413)

    def test_device_owner_requires_null_account_id(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "personal")
            invalid = request(owner_kind="device", owner_id=None)
            invalid["ownerId"] = "invented-account"
            with self.assertRaisesRegex(endpoint.PersonalOrdaxEndpointRequestError, "Device"):
                endpoint.mutate_personal_ordax_endpoint(body(invalid), root)

    def test_endpoint_delegates_durability_to_state_owner(self):
        source = MODULE.read_text(encoding="utf-8")
        self.assertNotIn("os.replace", source)
        self.assertNotIn("fcntl.flock", source)
        self.assertIn("compare_and_swap_personal_ordax_payload", source)
        self.assertNotIn("replace-state", source)


if __name__ == "__main__":
    unittest.main()
