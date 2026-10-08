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

    def test_posttransfer_contract_has_exact_destination_and_preserved_order(self):
        report = audit.validate_contracts(self.ownership, self.status)
        self.assertEqual(report["phase"], "post-transfer")
        self.assertEqual(report["canonical"], "ordaxsystems/prototipo-ordax-os")
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
        self.assertFalse(audit.is_operational("tools/verify/repository_namespace_transfer_preflight.py"))
        self.assertFalse(audit.is_operational("tests/test_repository_namespace_transfer_preflight.py"))
        self.assertTrue(audit.is_operational("docs/contracts/release-channel.json"))
        self.assertTrue(audit.is_operational("bootstrap/base-update/stage.py"))
        self.assertTrue(audit.is_operational("boot/esp/build.py"))
        self.assertTrue(audit.is_operational("sdk/app-sdk-v1/runtime-component-package-policy.json"))
        self.assertTrue(audit.is_operational("docs/RELEASE-CHANNEL.md"))
        self.assertFalse(audit.is_operational("docs/evidence/canonical-v4-release-proof.json"))

    def test_historical_negative_assertion_exemptions_are_exact_not_file_wide(self):
        from tempfile import TemporaryDirectory

        old = "washingtonmsdj/prototipo-ordax-os"
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name, expected in audit.NEGATIVE_HISTORICAL_ASSERTIONS.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("    " + expected + "\n", encoding="utf-8")
                self.assertTrue(
                    audit.verified_negative_historical_assertion(root, name, old)
                )
                path.write_text(
                    "    " + expected + "\n" + 'AUTHORITY = "' + old + '"\n',
                    encoding="utf-8",
                )
                self.assertFalse(
                    audit.verified_negative_historical_assertion(root, name, old)
                )
            self.assertFalse(
                audit.verified_negative_historical_assertion(
                    root, "system/network/authority.py", old
                )
            )

    def test_release_pointer_sha_is_pinned_to_bootstrap_manifest(self):
        report = audit.release_pointer_integrity(ROOT, "ordaxsystems/prototipo-ordax-os")
        self.assertTrue(report["release_pointer_integrity_verified"])
        self.assertEqual(
            report["release_pointer_sha256"],
            report["bootstrap_pinned_sha256"],
        )
        self.assertEqual(
            report["release_pointer_sha256"],
            "3c3e78d65aee0b120071e6bcee776c83de9e5ea1d8bd1a936d61d09499141741",
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
            old_bootstrap = json.loads(
                (ROOT / "docs/contracts/minimal-bootstrap.json").read_text(encoding="utf-8")
            )
            old_channel = next(
                group for group in old_bootstrap["artifact_groups"]
                if group["id"] == "bootstrap-release-channel"
            )
            # Stale signed pointers cannot be authenticated by the new URL.
            old_channel["artifacts"][0]["sha256"] = "ea1f3bae328a1c1e7aca1474d4930f84b2dd6da1702dcc11b08c01ed63a6ee5b"
            (root / "docs/contracts/minimal-bootstrap.json").write_text(
                json.dumps(old_bootstrap), encoding="utf-8"
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

    def test_sdk_public_package_projection_matches_authority(self):
        result = audit.sdk_package_projection_integrity(ROOT)
        self.assertTrue(result["sdk_package_projection_verified"])
        self.assertEqual(
            result["sdk_package_source_sha256"],
            result["sdk_package_snapshot_sha256"],
        )

    def test_sdk_public_package_projection_drift_blocks_cutover(self):
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "docs/contracts").mkdir(parents=True)
            (root / "sdk/app-sdk-v1").mkdir(parents=True)
            (root / "docs/contracts/runtime-component-package.json").write_text(
                '{"source_repository":"ordaxsystems/prototipo-ordax-os"}',
                encoding="utf-8",
            )
            (root / "sdk/app-sdk-v1/runtime-component-package-policy.json").write_text(
                '{"source_repository":"washingtonmsdj/prototipo-ordax-os"}',
                encoding="utf-8",
            )
            result = audit.sdk_package_projection_integrity(root)
            self.assertFalse(result["sdk_package_projection_verified"])
            self.assertNotEqual(
                result["sdk_package_source_sha256"],
                result["sdk_package_snapshot_sha256"],
            )

    def test_does_not_accept_dual_authority_or_out_of_order_transfer(self):
        copy_ = copy.deepcopy(self.ownership)
        copy_["namespace_migration"]["dual_authority_allowed"] = True
        with self.assertRaisesRegex(ValueError, "policies"):
            audit.validate_contracts(copy_, self.status)
        copy_ = copy.deepcopy(self.ownership)
        copy_["namespace_migration"]["completed_transfers"].remove("platform")
        with self.assertRaisesRegex(ValueError, "Post-transfer"):
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

    def test_repo_rename_requires_one_canonical_ssot_identity(self):
        renamed = copy.deepcopy(self.ownership)
        status = copy.deepcopy(self.status)
        target = "ordaxsystems/ordax-os"
        renamed["repositories"]["platform"]["repo"] = target
        renamed["namespace_migration"]["canonical_targets"]["platform"] = target
        status["canonical_repositories"]["platform"] = target
        outcome = audit.validate_contracts(renamed, status)
        self.assertEqual(outcome["phase"], "post-transfer")
        self.assertEqual(outcome["canonical"], target)

        # The target must not gain authority merely because the old GitHub
        # address redirects. Physical owner + immutable numeric ID must match.
        post_rename_report = {
            "phase": "post-transfer",
            "destination": target,
            "operational_count": 0,
            "retired_slug_operational_count": 0,
            "release_pointer_integrity_verified": True,
            "sdk_package_projection_verified": True,
        }
        self.assertEqual(audit.cutover_ready(post_rename_report, {
            "GITHUB_REPOSITORY": target,
            "GITHUB_REPOSITORY_ID": "1371063347",
        }), (True, "canonical_namespace_verified"))
        self.assertFalse(audit.cutover_ready(post_rename_report, {
            "GITHUB_REPOSITORY": "ordaxsystems/prototipo-ordax-os",
            "GITHUB_REPOSITORY_ID": "1371063347",
        })[0])
        self.assertFalse(audit.cutover_ready(post_rename_report, {
            "GITHUB_REPOSITORY": target,
            "GITHUB_REPOSITORY_ID": "0",
        })[0])

        # Old bootstrap bytes/sha cannot be used as authority for the new URL.
        self.assertFalse(audit.release_pointer_integrity(ROOT, target)[
            "release_pointer_integrity_verified"
        ])
        altered = copy.deepcopy(renamed)
        altered["namespace_migration"]["canonical_targets"]["platform"] = (
            "ordaxsystems/prototipo-ordax-os"
        )
        with self.assertRaisesRegex(ValueError, "unrecognized|destination|disagree"):
            audit.validate_contracts(altered, status)
        altered = copy.deepcopy(renamed)
        altered["repositories"]["platform"]["repo"] = "ordaxsystems/not-the-os"
        altered["namespace_migration"]["canonical_targets"]["platform"] = (
            "ordaxsystems/not-the-os"
        )
        status2 = copy.deepcopy(status)
        status2["canonical_repositories"]["platform"] = "ordaxsystems/not-the-os"
        with self.assertRaisesRegex(ValueError, "Unexpected destination"):
            audit.validate_contracts(altered, status2)

    def test_retired_intermediate_slug_is_never_a_second_operational_owner(self):
        destination = "ordaxsystems/ordax-os"
        environment = {
            "GITHUB_REPOSITORY": destination,
            "GITHUB_REPOSITORY_ID": "1371063347",
        }
        report = {
            "phase": "post-transfer",
            "destination": destination,
            "operational_count": 0,
            "release_pointer_integrity_verified": True,
            "sdk_package_projection_verified": True,
        }
        self.assertEqual(
            audit.cutover_ready(report, environment),
            (False, "retired_slug_audit_not_proven"),
        )
        self.assertEqual(
            audit.cutover_ready({**report, "retired_slug_operational_count": 1}, environment),
            (False, "intermediate_repository_slug_still_operational"),
        )
        self.assertEqual(
            audit.cutover_ready({**report, "retired_slug_operational_count": 0}, environment),
            (True, "canonical_namespace_verified"),
        )
        self.assertFalse(audit.cutover_ready(
            {**report, "retired_slug_operational_count": 0},
            {**environment, "GITHUB_REPOSITORY": "ordaxsystems/prototipo-ordax-os"},
        )[0])
        # An active request issued for the old slug cannot silently serve as
        # the current request for the new physical repository.
        old = "ordaxsystems/prototipo-ordax-os"
        counted = audit.count_old_references([
            ("docs/contracts/canonical-v4-signing-request-active.json",
             '{"source_repository":"' + old + '"}'),
            ("docs/contracts/canonical-v4-signing-request.json",
             '{"source_repository":"' + old + '"}'),
            ("tools/creator/main.go", "source = " + old),
        ], old)
        self.assertEqual(counted["operational_count"], 2)
        self.assertEqual(counted["historical_count"], 1)

    def test_rename_workflow_gates_stay_live_only_for_exact_repo_and_ssot(self):
        workflow = (ROOT / ".github/workflows/repository-namespace-transfer-preflight.yml").read_text(encoding="utf-8")
        allowed = (
            "(github.repository == 'ordaxsystems/prototipo-ordax-os' || "
            "github.repository == 'ordaxsystems/ordax-os')"
        )
        self.assertEqual(workflow.count(allowed), 3)
        self.assertIn("python3 tools/verify/repository_namespace_transfer_preflight.py --require-cutover", workflow)
        self.assertIn("github.ref == 'refs/heads/main'", workflow)
        self.assertIn("github.event_name != 'pull_request'", workflow)
        self.assertIn("GOTOOLCHAIN=local CGO_ENABLED=0 go run . inspect", workflow)
        self.assertNotIn("|| github.repository == 'washingtonmsdj/prototipo-ordax-os'", workflow)

    def test_cutover_proof_needs_no_live_legacy_refs_and_exact_github_identity(self):
        report = {
            "phase": "post-transfer",
            "destination": "ordaxsystems/prototipo-ordax-os",
            "operational_count": 0,
            "release_pointer_integrity_verified": True,
            "sdk_package_projection_verified": True,
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
            audit.cutover_ready({**report, "sdk_package_projection_verified": False}, good),
            (False, "sdk_package_policy_projection_drift"),
        )
        self.assertEqual(
            audit.cutover_ready({**report, "release_pointer_integrity_verified": False}, good),
            (False, "release_pointer_identity_or_bootstrap_digest_mismatch"),
        )
        self.assertFalse(audit.cutover_ready({**report, "phase": "pre-transfer"}, good)[0])


if __name__ == "__main__":
    unittest.main()
