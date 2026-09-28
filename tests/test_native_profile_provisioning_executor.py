from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import hashlib
import json
import os
import stat
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
MODULE = RUNTIME / "native_profile_provisioning_executor.py"


def load_module():
    import sys
    sys.path.insert(0, str(RUNTIME))
    try:
        spec = spec_from_file_location("ordax_profile_provisioning_executor_test", MODULE)
        module = module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(RUNTIME))


def evidence():
    return {
        "schema": "ordax.profile-content-stage-evidence/1",
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
            "manifestSha256": "b" * 64,
        },
        "health": {
            "schema": "ordax.profile-content-health/1",
            "state": "healthy",
            "entryCount": 2,
            "perEntryHashVerified": True,
            "perEntryProvenanceVerified": True,
            "executablePayloadAllowed": False,
            "authority": "none",
        },
    }


class NativeProfileProvisioningExecutorTests(unittest.TestCase):
    def test_receipt_is_derived_only_from_strict_healthy_evidence(self):
        module = load_module()
        receipt = module.receipt_from_stage_evidence(evidence(), 1234)
        self.assertEqual(receipt["schema"], "ordax.profile-install-receipt/1")
        self.assertEqual(receipt["artifact"]["version"], "1.2.3")
        self.assertEqual(receipt["verification"]["verifiedAt"], 1234)
        self.assertEqual(receipt["health"]["checkedAt"], 1234)
        self.assertFalse(receipt["health"]["executablePayloadAllowed"])

        unsafe = evidence()
        unsafe["health"]["authority"] = "mutable"
        with self.assertRaisesRegex(ValueError, "authority is unsafe"):
            module.receipt_from_stage_evidence(unsafe, 1234)

    def test_commit_writes_immutable_receipt_then_atomic_inventory_and_is_idempotent(self):
        module = load_module()
        receipt = module.receipt_from_stage_evidence(evidence(), 1234)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inventory = root / "state" / "inventory.json"
            receipts = root / "state" / "receipts"
            lock = root / "state" / "provisioning.lock"

            first = module.commit_verified_receipt(
                receipt,
                inventory_path=str(inventory),
                receipt_root=str(receipts),
                lock_path=str(lock),
            )
            self.assertTrue(first["changed"])
            self.assertEqual(first["inventory"]["revision"], 1)
            self.assertEqual(len(first["inventory"]["entries"]), 1)
            self.assertTrue(Path(first["receiptPath"]).is_file())
            self.assertEqual(stat.S_IMODE(os.stat(first["receiptPath"]).st_mode), 0o600)
            payload = Path(first["receiptPath"]).read_bytes()
            self.assertEqual(hashlib.sha256(payload).hexdigest(), first["receiptSha256"])

            second = module.commit_verified_receipt(
                receipt,
                inventory_path=str(inventory),
                receipt_root=str(receipts),
                lock_path=str(lock),
            )
            self.assertFalse(second["changed"])
            self.assertEqual(second["inventory"]["revision"], 1)

    def test_commit_rejects_missing_or_tampered_existing_receipt(self):
        module = load_module()
        receipt = module.receipt_from_stage_evidence(evidence(), 1234)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inventory = root / "state" / "inventory.json"
            receipts = root / "state" / "receipts"
            lock = root / "state" / "provisioning.lock"
            first = module.commit_verified_receipt(
                receipt,
                inventory_path=str(inventory),
                receipt_root=str(receipts),
                lock_path=str(lock),
            )
            os.chmod(first["receiptPath"], 0o600)
            Path(first["receiptPath"]).write_text("tampered\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "receipt hash mismatch"):
                module.commit_verified_receipt(
                    receipt,
                    inventory_path=str(inventory),
                    receipt_root=str(receipts),
                    lock_path=str(lock),
                )

    def test_read_stage_evidence_uses_exec_argv_not_shell_and_validates_output(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            channel = root / "fake-channel"
            channel.write_text(textwrap.dedent(f"""\
                #!/usr/bin/env python3
                import json
                print(json.dumps({json.dumps(evidence())}))
            """), encoding="utf-8")
            os.chmod(channel, 0o700)
            value = module.read_stage_evidence(
                "/safe/staged/slot",
                "/safe/trust.json",
                str(channel),
            )
            self.assertEqual(value["artifact"]["id"], "knowledge.example")

    def test_executor_is_not_exposed_by_native_http_host(self):
        host = (RUNTIME / "native_host_server.py").read_text(encoding="utf-8")
        self.assertNotIn("native_profile_provisioning_executor", host)
        self.assertNotIn("provision_verified_stage", host)


if __name__ == "__main__":
    unittest.main()
