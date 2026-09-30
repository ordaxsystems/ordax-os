import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CONSUMER_FLOW = ROOT / "docs/contracts/creator-consumer-flow.json"
PUBLISHER = ROOT / "tools/release-signing/windows/8-Sign-Publish-CreatorPhysical.ps1"
ROTATOR = ROOT / "tools/publisher/windows/9-Rotate-CreatorPhysical.ps1"
AUTHORIZATION = ROOT / "docs/contracts/physical-write-authorization.json"
PROMOTION = ROOT / "tools/creator/physical_promotion.py"


def _load_promotion_module():
    spec = importlib.util.spec_from_file_location("ordax_physical_promotion_publisher_test", PROMOTION)
    if spec is None or spec.loader is None:
        raise RuntimeError("physical promotion module loader unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CreatorPhysicalPublisherBoundaryTests(unittest.TestCase):
    def test_consumer_creator_contract_is_portable_v2_not_legacy_seed_raw(self):
        data = json.loads(CONSUMER_FLOW.read_text(encoding="utf-8"))

        self.assertEqual(data["$schema"], "prototype-ordax.creator-consumer-flow/2")
        publisher = data["publisher_boundary"]
        self.assertEqual(publisher["physical_release_tag"], "creator-physical")
        self.assertEqual(publisher["physical_release_envelope"], "creator-physical-envelope.json")
        self.assertEqual(publisher["physical_release_purpose"], "creator-portable-physical-windows-amd64")
        self.assertEqual(publisher["physical_release_recipe"], "creator/physical/portable-windows/2")
        self.assertIs(publisher["offline_canonical_signing_required_before_publication"], True)
        self.assertIs(publisher["existing_release_rotation_requires_explicit_confirmation"], True)
        self.assertIs(publisher["existing_release_rotation_must_archive_previous_signed_bytes"], True)
        self.assertIs(publisher["active_alias_may_move_only_after_archive_readback"], True)
        self.assertIs(publisher["rotation_failure_requires_byte_exact_rollback"], True)

        integrity = data["physical_candidate_integrity"]
        self.assertIs(integrity["whole_disk_raw_image_required"], False)
        self.assertEqual(integrity["portable_artifact_count"], 17)
        self.assertEqual(integrity["portable_application_operation_count"], 39)
        self.assertNotIn("ordax-bootstrap-seed.raw", integrity["critical_files_bound_by_sha256_and_size"])
        self.assertEqual(
            set(integrity["critical_files_bound_by_sha256_and_size"]),
            {
                "ordax-creator-physical-test.exe",
                "release-ed25519.json",
                "minimal-bootstrap.json",
                "portable-usb-v2.json",
                "creator-portable-media-plan.json",
                "physical-write-authorization.json",
                "provenance.json",
                "SHA256SUMS",
            },
        )

        gate = data["physical_write_gate"]
        self.assertIs(gate["requires_canonical_portable_application_plan"], True)
        self.assertIs(gate["requires_exact_17_artifact_sources"], True)
        self.assertIs(gate["internal_disk_write_allowed_in_mvp"], False)

        native = data["native_installation"]
        self.assertIs(native["foundation_may_exist_in_source"], True)
        self.assertIs(native["public_mvp_visible"], False)
        self.assertIs(native["public_mvp_enabled"], False)
        self.assertIs(native["internal_disk_destructive_apply_enabled"], False)

    def test_physical_publisher_is_offline_keyed_first_publication_and_readback_gated(self):
        text = PUBLISHER.read_text(encoding="utf-8")

        required = (
            "PUBLISH_CREATOR_PHYSICAL_RELEASE",
            "python",
            "physical_promotion.py",
            "--require-ready",
            "ordax-physical-release-signing",
            "--private-key",
            "creator-physical-envelope.json",
            "creator-physical-manifest.json",
            "creator-portable-physical-windows-amd64",
            "creator/physical/portable-windows/2",
            "portable_artifact_count -ne 17",
            "portable_application_operation_count -ne 39",
            "physical_write_allowed -ne $true",
            "explicit_owner_authorization -ne $true",
            "gh",
            "release create",
            "release download",
            "--prerelease",
            "automatic replacement is forbidden",
            "PHYSICAL_TARGET_SELECTED=NO",
            "PHYSICAL_WRITE_PERFORMED=NO",
            "PUBLIC_STABLE_PROMOTED=NO",
        )
        for marker in required:
            self.assertIn(marker, text)

        self.assertNotIn("gh release delete", text)
        self.assertNotIn("--clobber", text)
        self.assertNotIn("release edit", text)

    def test_physical_rotation_is_separate_explicit_archival_first_and_rollback_gated(self):
        text = ROTATOR.read_text(encoding="utf-8")

        required = (
            "ROTATE_CREATOR_PHYSICAL_RELEASE",
            "ExpectedCurrentWriterCommit",
            "8-Sign-Publish-CreatorPhysical.ps1",
            "creator-physical-archive-",
            "previous_release_archived",
            "replacement_release_readback_verified",
            "rotation-failed-previous-release-restored",
            "Restore-PreviousRelease",
            "Test-ReleaseExists",
            "HTTP\\s+404",
            "release create $ArchiveTag",
            "release delete $ReleaseTag",
            "--cleanup-tag",
            "Download-ReleaseAssets $ArchiveTag",
            "Assert-DirectoryEqual $PreviousDirectory $ArchiveReadback 'Archive'",
            "Assert-ReleaseAssets $CurrentAgain $PreviousDirectory",
            "PHYSICAL_TARGET_SELECTED=NO",
            "PHYSICAL_WRITE_PERFORMED=NO",
            "PUBLIC_STABLE_PROMOTED=NO",
        )
        for marker in required:
            self.assertIn(marker, text)

        self.assertNotIn("--clobber", text)
        self.assertNotIn("release edit", text)
        self.assertNotIn("release view $ArchiveTag --repo $Repository *> $null", text)
        self.assertNotIn("release view $ReleaseTag --repo $Repository *> $null", text)
        self.assertLess(
            text.index("# Preserve the old signed bytes under an immutable archival tag"),
            text.index("# Re-check that the live alias did not change"),
        )
        self.assertLess(
            text.index("# Re-check that the live alias did not change"),
            text.index("$AliasChanged = $false"),
        )

    def test_publisher_boundary_stays_outside_physical_authorization_context(self):
        module = _load_promotion_module()
        auth = json.loads(AUTHORIZATION.read_text(encoding="utf-8"))
        context_sha, file_count = module.authorization_context_sha256(ROOT)

        self.assertRegex(context_sha, r"^[0-9a-f]{64}$")
        self.assertEqual(file_count, 75)

        if auth["status"] == "authorized":
            self.assertIs(auth["physical_write_allowed"], True)
            self.assertIs(auth["explicit_owner_authorization"], True)
            self.assertEqual(context_sha, auth["authorization_context_sha256"])
            self.assertIs(auth["requirements"]["canonical_v4_release_proof_bound"], True)
        else:
            self.assertIn(
                auth["status"],
                {
                    "blocked-canonical-v4-release-proof-pending",
                    "blocked-explicit-physical-authorization-pending",
                },
            )
            self.assertIs(auth["physical_write_allowed"], False)
            self.assertIs(auth["explicit_owner_authorization"], False)
            self.assertIsNone(auth["authorization_context_sha256"])
            if auth["status"] == "blocked-canonical-v4-release-proof-pending":
                self.assertIs(
                    auth["requirements"]["canonical_v4_release_proof_bound"],
                    False,
                )
            else:
                self.assertIs(
                    auth["requirements"]["canonical_v4_release_proof_bound"],
                    True,
                )

        governed = {
            path.relative_to(ROOT).as_posix()
            for path in module.authorization_context_files(ROOT)
        }
        self.assertEqual(len(governed), 75)
        self.assertIn("tools/creator/core/portable_sources.go", governed)
        self.assertIn("tools/creator/physicalchannel/portable_payload.go", governed)
        self.assertNotIn("docs/contracts/creator-consumer-flow.json", governed)
        self.assertNotIn("tools/release-signing/windows/8-Sign-Publish-CreatorPhysical.ps1", governed)
        self.assertNotIn("tools/publisher/windows/9-Rotate-CreatorPhysical.ps1", governed)
        self.assertNotIn("tests/test_creator_physical_publisher_boundary.py", governed)
        self.assertNotIn(".github/workflows/creator-physical-publisher.yml", governed)


if __name__ == "__main__":
    unittest.main()
