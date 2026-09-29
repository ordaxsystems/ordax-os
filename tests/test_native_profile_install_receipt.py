from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import hashlib
import json
import os
import stat
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "system" / "surface" / "runtime" / "native_profile_install_receipt.py"


def load_module():
    spec = spec_from_file_location("ordax_profile_install_receipt_test", MODULE)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def receipt(authority="none", kind="knowledge-pack", key_id="profile-content-test-1"):
    return {
        "schema": "ordax.profile-install-receipt/1",
        "artifact": {
            "id": "knowledge.example",
            "kind": kind,
            "version": "1.2.3",
            "sha256": "a" * 64,
            "sizeBytes": 4096,
        },
        "verification": {
            "signatureAlgorithm": "ed25519",
            "keyId": key_id,
            "manifestSha256": "b" * 64,
            "verifiedAt": 1200,
        },
        "health": {
            "schema": "ordax.profile-content-health/1",
            "state": "healthy",
            "entryCount": 2,
            "perEntryHashVerified": True,
            "perEntryProvenanceVerified": True,
            "executablePayloadAllowed": False,
            "authority": authority,
            "checkedAt": 1220,
        },
        "installedAt": 1234,
    }


class NativeProfileInstallReceiptTests(unittest.TestCase):
    def test_generic_receipt_contract_accepts_all_component_kinds(self):
        module = load_module()
        kinds = ("app", "knowledge-pack", "skill-pack", "model-pack", "connector")
        for kind in kinds:
            with self.subTest(kind=kind):
                value = module.validate_profile_install_receipt(
                    receipt(kind=kind, key_id="K" * 120)
                )
                self.assertEqual(value["artifact"]["kind"], kind)
                self.assertEqual(value["verification"]["keyId"], "K" * 120)

    def test_content_addressed_private_canonical_receipt_round_trips(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "receipts"
            root.mkdir(mode=0o700)
            payload = module.canonical_profile_install_receipt_bytes(receipt())
            digest = hashlib.sha256(payload).hexdigest()
            path = root / f"{digest}.json"
            path.write_bytes(payload)
            os.chmod(path, 0o600)

            value = module.read_verified_profile_install_receipt(digest, str(root))
            self.assertEqual(value["artifact"]["id"], "knowledge.example")
            self.assertEqual(value["installedAt"], 1234)
            self.assertEqual(stat.S_IMODE(os.stat(root).st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)

    def test_noncanonical_encoding_is_rejected_even_when_hash_matches(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "receipts"
            root.mkdir(mode=0o700)
            raw = json.dumps(receipt(), indent=2, sort_keys=True).encode("utf-8")
            digest = hashlib.sha256(raw).hexdigest()
            path = root / f"{digest}.json"
            path.write_bytes(raw)
            os.chmod(path, 0o600)
            with self.assertRaisesRegex(ValueError, "not canonical"):
                module.read_verified_profile_install_receipt(digest, str(root))

    def test_unsafe_authority_is_rejected_from_matching_content_address(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "receipts"
            root.mkdir(mode=0o700)
            raw = (
                json.dumps(
                    receipt(authority="mutable"),
                    separators=(",", ":"),
                    sort_keys=True,
                )
                + "\n"
            ).encode("utf-8")
            digest = hashlib.sha256(raw).hexdigest()
            path = root / f"{digest}.json"
            path.write_bytes(raw)
            os.chmod(path, 0o600)
            with self.assertRaisesRegex(ValueError, "authority is unsafe"):
                module.read_verified_profile_install_receipt(digest, str(root))


if __name__ == "__main__":
    unittest.main()
