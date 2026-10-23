"""The OS handoff verifies CI evidence, never installs an unsigned Runtime."""
import hashlib
import importlib.util
import json
import struct
from pathlib import Path
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / "tools/ci/verify_native_product_candidate.py"
spec = importlib.util.spec_from_file_location("candidate_verifier", SCRIPT)
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)

COMMIT = "a" * 40
def make_elf():
    """Minimal ELF64 x86_64 with actual PT_INTERP, PT_DYNAMIC and DT_NEEDED."""
    elf = bytearray(4096)
    elf[:6] = b"\x7fELF\x02\x01"
    elf[18:20] = b"\x3e\x00"
    struct.pack_into("<Q", elf, 32, 64)
    struct.pack_into("<HH", elf, 54, 56, 3)
    interpreter = b"/lib/ld-musl-x86_64.so.1\x00"
    elf[512:512 + len(interpreter)] = interpreter
    table = b"\x00libc.musl-x86_64.so.1\x00libz.so.1\x00"
    elf[768:768 + len(table)] = table
    struct.pack_into("<IIQQQQQQ", elf, 64, 1, 0, 0, 0, 0, 4096, 4096, 4096)
    struct.pack_into("<IIQQQQQQ", elf, 120, 3, 0, 512, 512, 512,
                     len(interpreter), len(interpreter), 1)
    struct.pack_into("<IIQQQQQQ", elf, 176, 2, 0, 640, 640, 640, 64, 64, 8)
    entries = ((1, 1), (1, table.index(b"libz.so.1")), (5, 768), (10, len(table)))
    for offset, entry in enumerate(entries):
        struct.pack_into("<qQ", elf, 640 + offset * 16, *entry)
    return bytes(elf)


ELF = make_elf()
PROOF = {"ok": True, "network_used": False, "device_credential_used": False,
         "graphical_actions": [], "probes": ["filesystem", "terminal", "supervised-process"],
         "profile": "owner-development-usb"}


class CandidateVerifierTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        root = Path(self.folder.name)
        self.archive = root / "candidate.zip"
        self.lockfile = root / "source.json"
        self.manifest = {
            "schema": "ordax.native-product-runtime-candidate/1",
            "source_repository": "ordaxsystems/ordax-runtime", "source_commit": COMMIT,
            "platform": "linux-amd64-musl", "artifact": "ordax-product-agent",
            "size_bytes": len(ELF), "sha256": hashlib.sha256(ELF).hexdigest(),
            "python_required_on_device": False, "graphical_control_implemented": False,
            "signature_present": False, "installation_authorized_by_candidate": False,
            "stable_activation_authorized": False,
            "independent_base_abi_ready": False,
            "independent_base_abi_blockers": ["external-dynamic-elf-interpreter",
                "external-shared-libraries", "alpine-build-provenance",
                "embedded-python-runtime-closure-unverified"],
            "elf_interpreter": "/lib/ld-musl-x86_64.so.1",
            "elf_needed_libraries": ["libc.musl-x86_64.so.1", "libz.so.1"],
            "embedded_elf_inventory": {
                "schema": "ordax.native-embedded-elf-inventory/1",
                "native_entry_count": 1,
                "native_uncompressed_bytes": len(ELF),
                "inventory_sha256": "b" * 64,
                "needed_libraries": ["libc.so", "libz.so.1"],
                "unprovided_needed_names": ["libc.so"],
                "embedded_interpreters": [],
                "read_only_audit": True,
                "independent_base_compatibility_proven": False,
                "install_authorized": False,
            },
        }
        self.proof = dict(PROOF)
        self.lock = {
            "$schema": "prototype-ordax.studio-runtime-source-lock/1",
            "source": {"commit": COMMIT},
            "candidate_evidence": {
                "kind": "ci-only-unsigned", "source_commit": COMMIT,
                "platform": "linux-amd64-musl", "archive_sha256": "",
                "executable_sha256": hashlib.sha256(ELF).hexdigest(),
                "executable_size_bytes": len(ELF), "offline_proof_verified": True,
                "device_execution_proven": False, "signed_distribution_authorized": False,
                "native_graphical_control_proven": False,
                "independent_base_abi_ready": False,
                "independent_base_abi_blockers": list(self.manifest["independent_base_abi_blockers"]),
                "elf_interpreter": self.manifest["elf_interpreter"],
                "elf_needed_libraries": list(self.manifest["elf_needed_libraries"]),
                "embedded_elf_inventory": {
                    key: self.manifest["embedded_elf_inventory"][key] for key in (
                        "schema", "native_entry_count", "native_uncompressed_bytes",
                        "inventory_sha256", "unprovided_needed_names",
                        "independent_base_compatibility_proven", "install_authorized"
                    )
                },
            },
            "distribution": {"runtime_artifact_claimed": False, "runtime_packaged_in_stable": False,
                             "source_binding_only": True},
            "activation": {"dispatch_enabled": False, "requires_signed_runtime_slot": True},
        }
        self.write_fixture()

    def write_fixture(self, extras=None):
        with zipfile.ZipFile(self.archive, "w") as archive:
            archive.writestr("candidate.json", json.dumps(self.manifest))
            archive.writestr("self-test.json", json.dumps(self.proof))
            archive.writestr("ordax-product-agent", ELF)
            archive.writestr("SHA256SUMS", self.manifest["sha256"] + "  ordax-product-agent\n")
            for name, value in (extras or []):
                archive.writestr(name, value)
        self.lock["candidate_evidence"]["archive_sha256"] = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.lockfile.write_text(json.dumps(self.lock))

    def verify(self):
        return verifier.verify(self.archive, self.lockfile)

    def test_valid_offline_proof_does_not_activate(self):
        result = self.verify()
        self.assertEqual(result["source_commit"], COMMIT)
        self.assertFalse(result["activation_authorized"])
        self.assertFalse(result["device_execution_proven"])
        self.assertFalse(result["independent_base_abi_ready"])
        self.assertEqual(result["elf_interpreter"], "/lib/ld-musl-x86_64.so.1")
        self.assertEqual(result["elf_needed_libraries"],
                         ["libc.musl-x86_64.so.1", "libz.so.1"])

    def test_tampered_archive_fails_sha(self):
        with self.archive.open("ab") as out:
            out.write(b"tampered")
        with self.assertRaisesRegex(verifier.CandidateError, "archive digest"):
            self.verify()

    def test_mismatched_source_fails_closed_even_with_valid_archive_sha(self):
        self.manifest["source_commit"] = "b" * 40
        self.write_fixture()
        with self.assertRaisesRegex(verifier.CandidateError, "not pinned"):
            self.verify()

    def test_offline_proof_cannot_use_network(self):
        self.proof["network_used"] = True
        self.write_fixture()
        with self.assertRaisesRegex(verifier.CandidateError, "offline execution proof"):
            self.verify()

    def test_unsigned_candidate_cannot_claim_installation_authority(self):
        self.manifest["installation_authorized_by_candidate"] = True
        self.write_fixture()
        with self.assertRaisesRegex(verifier.CandidateError, "signature/activation"):
            self.verify()

    def test_zip_may_not_include_extra_path(self):
        self.write_fixture(extras=[("../../outside", "data")])
        with self.assertRaisesRegex(verifier.CandidateError, "ZIP members"):
            self.verify()

    def test_manifest_cannot_claim_independent_base_ready(self):
        self.manifest["independent_base_abi_ready"] = True
        self.lock["candidate_evidence"]["independent_base_abi_ready"] = True
        self.write_fixture()
        with self.assertRaisesRegex(verifier.CandidateError, "Independent Base ABI"):
            self.verify()

    def test_manifest_cannot_drop_unresolved_abi_blockers(self):
        self.manifest["independent_base_abi_blockers"] = []
        self.lock["candidate_evidence"]["independent_base_abi_blockers"] = []
        self.write_fixture()
        with self.assertRaisesRegex(verifier.CandidateError, "Independent Base ABI"):
            self.verify()

    def test_elf_interpreter_is_verified_from_executable_bytes(self):
        self.manifest["elf_interpreter"] = "/lib/fake-loader"
        self.lock["candidate_evidence"]["elf_interpreter"] = "/lib/fake-loader"
        self.write_fixture()
        with self.assertRaisesRegex(verifier.CandidateError, "native ELF loader"):
            self.verify()

    def test_elf_libraries_are_verified_from_executable_bytes(self):
        self.manifest["elf_needed_libraries"] = ["libnotreally.so.1"]
        self.lock["candidate_evidence"]["elf_needed_libraries"] = ["libnotreally.so.1"]
        self.write_fixture()
        with self.assertRaisesRegex(verifier.CandidateError, "native ELF loader"):
            self.verify()

    def test_embedded_native_inventory_is_bound_to_zip_and_source_lock(self):
        result = self.verify()
        self.assertEqual(result["embedded_elf_inventory"]["native_entry_count"], 1)
        self.assertEqual(result["embedded_elf_inventory"]["inventory_sha256"], "b" * 64)
        self.assertFalse(result["embedded_elf_inventory"]["install_authorized"])

    def test_rejects_missing_embedded_native_inventory(self):
        self.manifest.pop("embedded_elf_inventory")
        self.write_fixture()
        with self.assertRaisesRegex(verifier.CandidateError, "inventory is missing"):
            self.verify()

    def test_rejects_changed_embedded_elf_inventory_fingerprint(self):
        self.manifest["embedded_elf_inventory"]["inventory_sha256"] = "c" * 64
        self.write_fixture()
        with self.assertRaisesRegex(verifier.CandidateError, "pinned evidence"):
            self.verify()

    def test_rejects_embedded_native_install_authority(self):
        self.manifest["embedded_elf_inventory"]["install_authorized"] = True
        self.lock["candidate_evidence"]["embedded_elf_inventory"]["install_authorized"] = True
        self.write_fixture()
        with self.assertRaisesRegex(verifier.CandidateError, "cannot authorize"):
            self.verify()

    def test_rejects_false_independent_base_compatibility(self):
        self.manifest["embedded_elf_inventory"]["independent_base_compatibility_proven"] = True
        self.lock["candidate_evidence"]["embedded_elf_inventory"]["independent_base_compatibility_proven"] = True
        self.write_fixture()
        with self.assertRaisesRegex(verifier.CandidateError, "cannot authorize"):
            self.verify()

    def test_rejects_unbound_embedded_dependency_names(self):
        self.manifest["embedded_elf_inventory"]["unprovided_needed_names"] = ["fake.so"]
        self.lock["candidate_evidence"]["embedded_elf_inventory"]["unprovided_needed_names"] = ["fake.so"]
        self.write_fixture()
        with self.assertRaisesRegex(verifier.CandidateError, "dependencies are invalid"):
            self.verify()

    def test_dispatch_must_remain_off(self):
        self.lock["activation"]["dispatch_enabled"] = True
        self.lockfile.write_text(json.dumps(self.lock))
        with self.assertRaisesRegex(verifier.CandidateError, "activation gates"):
            self.verify()


if __name__ == "__main__":
    unittest.main()
