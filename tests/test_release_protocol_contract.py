import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "release-protocol.json"
ACQUISITION = ROOT / "bootstrap" / "release-acquisition" / "main.go"
SIGNING = ROOT / "tools" / "release-signing" / "main.go"
SIGNING_TRANSITION = ROOT / "tools" / "release-signing" / "trust_transition.go"
ACQUISITION_TRANSITION = ROOT / "bootstrap" / "release-acquisition" / "trust_transition.go"
MANIFEST_TOOL = ROOT / "tools" / "release-manifest" / "main.go"


class ReleaseProtocolContractTests(unittest.TestCase):
    def load_contract(self):
        return json.loads(CONTRACT.read_text(encoding="utf-8"))

    def read_source(self, path):
        return path.read_text(encoding="utf-8")

    def test_current_schema_registry_matches_all_protocol_owners(self):
        contract = self.load_contract()
        current = contract["current"]
        acquisition = self.read_source(ACQUISITION)
        signing = self.read_source(SIGNING)
        generator = self.read_source(MANIFEST_TOOL)

        self.assertIn(current["envelope_schema"], acquisition)
        self.assertIn(current["manifest_schema"], acquisition)
        self.assertIn(current["trust_schema"], acquisition)

        self.assertIn(current["envelope_schema"], signing)
        self.assertIn(current["manifest_schema"], signing)
        self.assertIn(current["trust_schema"], signing)

        self.assertIn(current["manifest_schema"], generator)

    def assert_v1_validator_semantics(self, source):
        self.assertRegex(source, r"len\([A-Za-z_][A-Za-z0-9_]*\.Artifacts\)\s*!=\s*1")
        self.assertRegex(
            source,
            r'[A-Za-z_][A-Za-z0-9_]*\.Artifacts\[0\]\.Name\s*!=\s*"system\.tar"',
        )
        self.assertRegex(
            source,
            r'[A-Za-z_][A-Za-z0-9_]*\.Artifacts\[0\]\.Role\s*!=\s*"system"',
        )
        self.assertRegex(
            source,
            r"[A-Za-z_][A-Za-z0-9_]*\.ReleaseID\s*!=\s*[A-Za-z_][A-Za-z0-9_]*\.SourceCommit",
        )
        self.assertIn("release-manifest/1 requires exactly one system.tar artifact", source)
        self.assertIn("release-manifest/1 artifact must be system.tar with role=system", source)

    def test_manifest_v1_single_full_system_semantics_cannot_drift_silently(self):
        contract = self.load_contract()
        manifest = contract["current"]["manifest_v1"]
        self.assertEqual(manifest["artifact_count"], 1)
        self.assertEqual(manifest["artifact_name"], "system.tar")
        self.assertEqual(manifest["artifact_role"], "system")
        self.assertTrue(manifest["release_id_equals_source_commit"])

        acquisition = self.read_source(ACQUISITION)
        signing = self.read_source(SIGNING)
        generator = self.read_source(MANIFEST_TOOL)

        self.assert_v1_validator_semantics(acquisition)
        self.assert_v1_validator_semantics(signing)

        self.assertIn(
            'hashNamedArtifact(path, "system.tar", "release-manifest/1")',
            generator,
        )
        self.assertIn('Name:   "system.tar"', generator)
        self.assertIn('Role:   "system"', generator)
        self.assertIn("ReleaseID:           sourceCommit", generator)

        portable = contract["portable_v2"]
        self.assertEqual(
            portable["manifest_schema"],
            "prototype-ordax.release-manifest/2",
        )
        self.assertEqual(portable["artifact_name"], "system.erofs")
        self.assertEqual(portable["artifact_role"], "system-image")
        self.assertTrue(portable["generator_support"])
        self.assertTrue(portable["signer_support"])
        self.assertTrue(portable["acquisition_agent_support"])
        self.assertTrue(portable["materialization_support"])
        self.assertFalse(portable["activation_support"])
        self.assertFalse(portable["boot_handoff_support"])
        self.assertFalse(portable["production_publication_allowed"])

    def test_portable_v3_runtime_contract_is_explicit_and_fail_closed(self):
        contract = self.load_contract()
        portable = contract["portable_v3"]
        self.assertEqual(
            portable["manifest_schema"],
            "prototype-ordax.release-manifest/3",
        )
        self.assertEqual(portable["artifact_count"], 2)
        self.assertEqual(
            portable["artifacts"],
            [
                {"name": "system.erofs", "role": "system-image"},
                {
                    "name": "native-surface-runtime.erofs",
                    "role": "surface-runtime",
                },
            ],
        )
        self.assertTrue(portable["canonical_artifact_order"])
        self.assertTrue(portable["generator_support"])
        self.assertTrue(portable["signer_support"])
        self.assertTrue(portable["acquisition_agent_support"])
        self.assertTrue(portable["materialization_support"])
        self.assertTrue(portable["verified_runtime_reuse"])
        self.assertFalse(portable["runtime_redownload_when_verified_hash_present"])
        self.assertFalse(portable["activation_support"])
        self.assertFalse(portable["boot_handoff_support"])
        self.assertFalse(portable["production_publication_allowed"])

        acquisition = self.read_source(ACQUISITION)
        signing = self.read_source(SIGNING)
        generator = self.read_source(MANIFEST_TOOL)
        for source in (acquisition, signing, generator):
            self.assertIn("prototype-ordax.release-manifest/3", source)
            self.assertIn("native-surface-runtime.erofs", source)
            self.assertIn("surface-runtime", source)
        self.assertIn("materializePortableV3(", acquisition)
        self.assertIn("verifyPortableV3Exact(", acquisition)
        self.assertIn('filepath.Join(root, "runtimes", "sha256"', acquisition)
        self.assertIn("surface-runtime.sha256", acquisition)

    def test_portable_v4_local_ai_contract_is_explicit_and_fail_closed(self):
        contract = self.load_contract()
        portable = contract["portable_v4"]
        self.assertEqual(
            portable["manifest_schema"],
            "prototype-ordax.release-manifest/4",
        )
        self.assertEqual(portable["artifact_count"], 3)
        self.assertEqual(
            portable["artifacts"],
            [
                {"name": "system.erofs", "role": "system-image"},
                {
                    "name": "native-surface-runtime.erofs",
                    "role": "surface-runtime",
                },
                {
                    "name": "local-ai-runtime.erofs",
                    "role": "local-ai-runtime",
                },
            ],
        )
        self.assertTrue(portable["canonical_artifact_order"])
        self.assertTrue(portable["local_ai_binding_required"])
        self.assertEqual(portable["local_ai_contract"], "ordax.local-ai/1")
        self.assertEqual(
            portable["local_ai_source_lock_schema"],
            "prototype-ordax.local-ai-source-lock/1",
        )
        self.assertTrue(portable["generator_support"])
        self.assertTrue(portable["signer_support"])
        self.assertTrue(portable["envelope_verifier_support"])
        self.assertTrue(portable["acquisition_agent_support"])
        self.assertTrue(portable["materialization_support"])
        self.assertTrue(portable["verified_runtime_reuse"])
        self.assertTrue(portable["offline_exact_verification_support"])
        self.assertFalse(portable["activation_support"])
        self.assertTrue(portable["boot_handoff_support"])
        self.assertTrue(portable["supervisor_update_lifecycle_support"])
        self.assertTrue(portable["supervisor_inspect_manifest_schema_required"])
        self.assertTrue(portable["pre_v4_current_may_use_v3_compatibility"])
        self.assertFalse(portable["v4_to_v3_downgrade_allowed"])
        self.assertEqual(portable["candidate_activation_owner"], "ordax-portable-state")
        self.assertTrue(portable["candidate_cold_health_required"])
        self.assertTrue(portable["failed_candidate_rollback_offline"])
        self.assertFalse(portable["production_publication_allowed"])
        self.assertFalse(portable["physical_write_authority_granted"])
        self.assertTrue(portable["real_local_ai_runtime_artifact_built"])
        self.assertTrue(portable["real_local_ai_runtime_ci_reproducible"])
        self.assertFalse(portable["canonical_signed_stable_materialization_proven"])
        self.assertFalse(portable["physical_stable_mvp_boot_proven"])

        acquisition = self.read_source(ACQUISITION)
        signing = self.read_source(SIGNING)
        generator = self.read_source(MANIFEST_TOOL)
        for source in (acquisition, signing, generator):
            self.assertIn("prototype-ordax.release-manifest/4", source)
            self.assertIn("local-ai-runtime.erofs", source)
            self.assertIn("ordax.local-ai/1", source)
            self.assertIn("source_lock_sha256", source)
            self.assertIn("model_sha256", source)
        self.assertIn("materializePortableV4(", acquisition)
        self.assertIn("verifyPortableV4Exact(", acquisition)
        self.assertIn('filepath.Join(root, "ai-runtimes", "sha256"', acquisition)
        self.assertIn("local-ai-runtime.sha256", acquisition)

        verify_existing = acquisition.split(
            "func verifyExistingPortableV4Release(", 1
        )[1].split("\n}", 1)[0]
        verify_exact = acquisition.split(
            "func verifyPortableV4Exact(", 1
        )[1].split("\n}", 1)[0]
        self.assertEqual(verify_existing.count("verifyRuntimeStoreFile("), 1)
        self.assertEqual(verify_existing.count("verifyAIRuntimeStoreFile("), 1)
        self.assertNotIn("verifyRuntimeStoreFile(", verify_exact)
        self.assertNotIn("verifyAIRuntimeStoreFile(", verify_exact)
        self.assertIn('"runtimes",', verify_exact)
        self.assertIn('"ai-runtimes",', verify_exact)

    def test_trust_transition_v1_is_separate_fail_closed_protocol(self):
        contract = self.load_contract()["trust_transition_v1"]
        self.assertEqual(
            contract["transition_schema"],
            "prototype-ordax.release-trust-transition/1",
        )
        self.assertEqual(
            contract["envelope_schema"],
            "prototype-ordax.release-trust-transition-envelope/1",
        )
        self.assertTrue(contract["signer_support"])
        self.assertTrue(contract["signer_verifier_support"])
        self.assertTrue(contract["acquisition_agent_verifier_support"])
        self.assertTrue(contract["sequence_must_be_positive_and_exact"])
        self.assertTrue(contract["previous_trust_exact_sha256_required"])
        self.assertTrue(contract["transition_signed_by_current_key"])
        self.assertTrue(contract["next_key_id_must_differ"])
        self.assertTrue(contract["next_ed25519_key_material_must_differ"])
        self.assertTrue(contract["canonical_next_trust_sha256_required"])
        self.assertTrue(contract["verification_writes_only_new_output"])
        self.assertTrue(contract["ci_cross_component_proof"])
        self.assertEqual(contract["ci_signer_agent_run_id"], 35640416446)
        self.assertEqual(contract["ci_release_agent_run_id"], 35640416481)
        self.assertFalse(contract["current_trust_mutation_allowed"])
        self.assertFalse(contract["stateful_device_activation_support"])
        self.assertFalse(contract["bootstrap_effective_trust_selection_support"])
        self.assertFalse(contract["production_rotation_ready"])

        signer = self.read_source(SIGNING_TRANSITION)
        acquisition = self.read_source(ACQUISITION_TRANSITION)
        for source in (signer, acquisition):
            self.assertIn("prototype-ordax.release-trust-transition/1", source)
            self.assertIn("prototype-ordax.release-trust-transition-envelope/1", source)
            self.assertIn("previous_trust_sha256", source)
            self.assertIn("next_trust_sha256", source)
            self.assertIn("sequence", source)
            self.assertIn("different Ed25519 key material", source)

    def test_channel_inspection_is_signed_and_non_destructive(self):
        current = self.load_contract()["current"]
        inspection = current["channel_inspection"]
        self.assertEqual(inspection["command"], "ordax-release-agent inspect")
        self.assertTrue(inspection["signed_envelope_required"])
        self.assertTrue(inspection["trust_anchor_required"])
        self.assertFalse(inspection["artifact_download_performed"])
        self.assertFalse(inspection["release_materialization_performed"])
        self.assertFalse(inspection["current_pointer_changed"])
        self.assertFalse(inspection["activation_performed"])

        acquisition = self.read_source(ACQUISITION)
        self.assertIn('flag.NewFlagSet("inspect"', acquisition)
        self.assertIn("inspectRelease(", acquisition)
        inspect = acquisition.split("func inspectRelease(", 1)[1].split("\n}", 1)[0]
        self.assertIn("fetchBytes", inspect)
        self.assertIn("verifyEnvelope", inspect)
        self.assertNotIn("downloadArtifact", inspect)
        self.assertNotIn("materialize(", inspect)
        self.assertNotIn("activate(", inspect)

    def test_exact_activation_is_offline_and_revalidates_stored_release(self):
        current = self.load_contract()["current"]
        activation = current["exact_activation"]
        self.assertEqual(
            activation["command"],
            "ordax-release-agent activate-exact",
        )
        self.assertFalse(activation["network_access_required"])
        self.assertTrue(activation["expected_commit_required"])
        self.assertTrue(activation["trust_anchor_required"])
        self.assertTrue(activation["stored_signed_envelope_reverified"])
        self.assertTrue(activation["stored_manifest_reverified"])
        self.assertTrue(activation["stored_artifact_hash_and_size_reverified"])
        self.assertTrue(activation["materialized_system_tree_reverified"])
        self.assertTrue(activation["existing_current_must_be_safe_known_good_symlink"])
        self.assertTrue(activation["atomic_current_pointer_replace"])
        self.assertFalse(activation["latest_channel_resolved_during_activation"])
        self.assertFalse(activation["artifact_download_performed"])
        self.assertFalse(activation["release_materialization_performed"])
        self.assertFalse(activation["reboot_requested"])
        self.assertTrue(activation["health_policy_owned_by_supervisor"])

        acquisition = self.read_source(ACQUISITION)
        self.assertIn('flag.NewFlagSet("activate-exact"', acquisition)
        exact = acquisition.split("func activateExact(", 1)[1].split("\n}", 1)[0]
        self.assertIn("verifyMaterializedExact", exact)
        self.assertIn("safeCurrentCommit", exact)
        self.assertIn("activate(root, expectedCommit)", exact)
        self.assertNotIn("fetchBytes", exact)
        self.assertNotIn("downloadArtifact", exact)
        self.assertNotIn("secureClient", exact)

    def test_breaking_release_evolution_requires_new_schema(self):
        compatibility = self.load_contract()["compatibility"]
        self.assertTrue(compatibility["published_schema_semantics_are_immutable"])
        self.assertTrue(compatibility["breaking_change_requires_new_schema_major"])
        self.assertTrue(compatibility["future_schema_versions_may_coexist"])
        self.assertEqual(compatibility["unknown_required_schema"], "fail-closed")
        self.assertFalse(compatibility["silent_schema_upgrade_allowed"])
        self.assertFalse(compatibility["manifest_v1_may_gain_multiple_artifacts"])
        self.assertFalse(compatibility["manifest_v1_may_gain_delta_semantics"])
        self.assertFalse(compatibility["manifest_v1_may_change_release_addressing"])
        self.assertTrue(compatibility["old_schema_removal_requires_explicit_migration_policy"])

    def test_future_delta_and_multi_artifact_paths_preserve_compatibility(self):
        rules = self.load_contract()["future_release_rules"]
        self.assertTrue(rules["delta_update_requires_new_manifest_schema"])
        self.assertTrue(rules["multiple_artifacts_require_new_manifest_schema"])
        self.assertTrue(rules["new_required_manifest_fields_require_new_manifest_schema"])
        self.assertTrue(rules["optional_delta_must_preserve_verified_full_release_fallback"])
        self.assertTrue(rules["new_release_schema_requires_explicit_consumer_support"])
        self.assertTrue(rules["new_release_schema_requires_signer_support"])
        self.assertTrue(rules["new_release_schema_requires_generator_support"])
        self.assertTrue(rules["new_release_schema_requires_acquisition_agent_support"])
        self.assertTrue(rules["new_release_schema_requires_cross_component_regression"])
        self.assertTrue(rules["new_trust_transition_requires_explicit_protocol"])
        self.assertTrue(rules["local_ai_runtime_multi_artifact_requires_manifest_v4"])

    def test_protocol_owners_are_single_named_boundaries(self):
        owners = self.load_contract()["owners"]
        self.assertEqual(owners["generator"], "tools/release-manifest")
        self.assertEqual(owners["signer"], "tools/release-signing")
        self.assertEqual(owners["consumer"], "bootstrap/release-acquisition")
        for key in ("generator", "signer", "consumer"):
            self.assertTrue((ROOT / owners[key]).exists())


if __name__ == "__main__":
    unittest.main()
