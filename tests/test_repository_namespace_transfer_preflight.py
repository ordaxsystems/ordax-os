import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "verify" / "repository_namespace_transfer_preflight.py"
spec = importlib.util.spec_from_file_location("repository_namespace_transfer_preflight", SCRIPT)
audit = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(audit)


class RepositoryNamespaceTransferPreflightTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ownership = json.loads(
            (ROOT / "docs/contracts/repository-ownership.json").read_text(encoding="utf-8")
        )
        cls.status = json.loads(
            (ROOT / "docs/contracts/repository-migration-status.json").read_text(encoding="utf-8")
        )

    def test_pretransfer_contract_has_exact_destination_and_preserved_order(self):
        report = audit.validate_contracts(self.ownership, self.status)
        self.assertEqual(report["phase"], "pre-transfer")
        self.assertEqual(report["canonical"], "washingtonmsdj/prototipo-ordax-os")
        self.assertEqual(report["destination"], "ordaxsystems/prototipo-ordax-os")

    def test_transfer_audit_distinguishes_live_trust_code_from_provenance(self):
        old = "washingtonmsdj/prototipo-ordax-os"
        report = audit.count_old_references([
            (".github/workflows/release-signing.yml", f"if github.repository == {old}"),
            ("bootstrap/config/release-envelope-url", f"https://github.com/{old}/releases"),
            ("tools/creator/go.mod", f"module github.com/{old}/tools/creator"),
            ("docs/contracts/repository-ownership.json", old),
            ("docs/evidence/original-release.md", f"Built at {old}"),
            ("docs/ARCHIVE.md", old),
            ("tools/creator/notes/other.md", "No owner here"),
        ], old)
        self.assertEqual(report["operational_count"], 4)
        self.assertEqual(report["historical_count"], 2)
        self.assertIn("tools/creator/go.mod", report["operational_paths"])
        self.assertIn("docs/evidence/original-release.md", report["historical_paths"])
        self.assertFalse(audit.is_operational("docs/contracts/canonical-v4-signing-request.json"))
        self.assertFalse(audit.is_operational("docs/contracts/physical-write-authorization.json"))
        self.assertFalse(audit.is_operational("system/profile-content-sources/developer-core/v0.1.0/manifest.json"))
        self.assertTrue(audit.is_operational("docs/contracts/release-channel.json"))
        self.assertTrue(audit.is_operational("bootstrap/base-update/stage.py"))

    def test_release_pointer_sha_is_pinned_to_bootstrap_manifest(self):
        report = audit.release_pointer_integrity(ROOT, "washingtonmsdj/prototipo-ordax-os")
        self.assertTrue(report["release_pointer_integrity_verified"])
        self.assertEqual(
            report["release_pointer_sha256"],
            report["bootstrap_pinned_sha256"],
        )
        self.assertEqual(
            report["release_pointer_sha256"],
            "ea1f3bae328a1c1e7aca1474d4930f84b2dd6da1702dcc11b08c01ed63a6ee5b",
        )

    def test_repointing_release_url_without_new_verified_bootstrap_fails(self):
        # The same old bootstrap digest is NOT authority over new URL bytes.
        from tempfile import TemporaryDirectory
        import hashlib

        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "docs/contracts").mkdir(parents=True)
            (root / "bootstrap/config").mkdir(parents=True)
            release = json.loads(
                (ROOT / "docs/contracts/release-channel.json").read_text(encoding="utf-8")
            )
            release["source_authority"]["repository"] = "ordaxsystems/prototipo-ordax-os"
            release["publication"]["latest_envelope_url"] = (
                "https://github.com/ordaxsystems/prototipo-ordax-os/"
                "releases/latest/download/release-envelope.json"
            )
            (root / "docs/contracts/release-channel.json").write_text(json.dumps(release))
            (root / "docs/contracts/minimal-bootstrap.json").write_bytes(
                (ROOT / "docs/contracts/minimal-bootstrap.json").read_bytes()
            )
            (root / "bootstrap/config/release-envelope-url").write_bytes(
                (release["publication"]["latest_envelope_url"] + "\n").encode("utf-8")
            )
            report = audit.release_pointer_integrity(
                root, "ordaxsystems/prototipo-ordax-os"
            )
            self.assertFalse(report["release_pointer_integrity_verified"])
            self.assertNotEqual(
                report["release_pointer_sha256"], report["bootstrap_pinned_sha256"]
            )

    def test_does_not_accept_dual_authority_or_out_of_order_transfer(self):
        copy_ = copy.deepcopy(self.ownership)
        copy_["namespace_migration"]["dual_authority_allowed"] = True
        with self.assertRaisesRegex(ValueError, "policies"):
            audit.validate_contracts(copy_, self.status)
        copy_ = copy.deepcopy(self.ownership)
        copy_["namespace_migration"]["completed_transfers"].append("platform")
        with self.assertRaisesRegex(ValueError, "Pre-transfer"):
            audit.validate_contracts(copy_, self.status)
        copy_ = copy.deepcopy(self.ownership)
        copy_["repositories"]["platform"]["repo"] = "ordaxsystems/another-repo"
        with self.assertRaisesRegex(ValueError, "disagree|unrecognized"):
            audit.validate_contracts(copy_, self.status)

    def test_posttransfer_needs_all_four_owners_in_ssot(self):
        ownership = copy.deepcopy(self.ownership)
        status = copy.deepcopy(self.status)
        ownership["repositories"]["platform"]["repo"] = "ordaxsystems/prototipo-ordax-os"
        status["canonical_repositories"]["platform"] = "ordaxsystems/prototipo-ordax-os"
        migration = ownership["namespace_migration"]
        migration["current_namespace"] = "ordaxsystems"
        migration["status"] = "complete"
        migration["completed_transfers"] = ["runtime", "apps", "control_plane", "platform"]
        report = audit.validate_contracts(ownership, status)
        self.assertEqual(report["phase"], "post-transfer")

    def test_cutover_proof_needs_no_live_legacy_refs_and_exact_github_identity(self):
        report = {
            "phase": "post-transfer",
            "destination": "ordaxsystems/prototipo-ordax-os",
            "operational_count": 0,
            "release_pointer_integrity_verified": True,
        }
        good = {
            "GITHUB_REPOSITORY": report["destination"],
            "GITHUB_REPOSITORY_ID": "1371063347",
        }
        self.assertEqual(audit.cutover_ready(report, good), (True, "canonical_namespace_verified"))
        for key, bad in (
            ("GITHUB_REPOSITORY", "washingtonmsdj/prototipo-ordax-os"),
            ("GITHUB_REPOSITORY_ID", "0000000000"),
        ):
            invalid = {**good, key: bad}
            self.assertFalse(audit.cutover_ready(report, invalid)[0])
        self.assertFalse(audit.cutover_ready({**report, "operational_count": 1}, good)[0])
        self.assertEqual(
            audit.cutover_ready({**report, "release_pointer_integrity_verified": False}, good),
            (False, "release_pointer_identity_or_bootstrap_digest_mismatch"),
        )
        self.assertFalse(audit.cutover_ready({**report, "phase": "pre-transfer"}, good)[0])


if __name__ == "__main__":
    unittest.main()
