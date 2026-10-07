#!/usr/bin/env python3
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_DATA = ROOT / "docs" / "contracts" / "app-data.json"
NATIVE = ROOT / "docs" / "contracts" / "native-app-data.json"
BINDING = ROOT / "docs" / "contracts" / "native-app-data-binding.json"
SDK = ROOT / "sdk" / "app-sdk-v1" / "bundle.json"


class AppDataStatusContractTest(unittest.TestCase):
    def setUp(self):
        self.app_data = json.loads(APP_DATA.read_text(encoding="utf-8"))
        self.native = json.loads(NATIVE.read_text(encoding="utf-8"))
        self.binding = json.loads(BINDING.read_text(encoding="utf-8"))
        self.sdk = json.loads(SDK.read_text(encoding="utf-8"))

    def test_active_foundation_matches_binding_and_sdk(self):
        expected = "trusted-first-party-port-injection-active"
        self.assertEqual(self.app_data["status"], expected)
        self.assertEqual(self.native["status"], expected)
        self.assertEqual(self.binding["status"], expected)

        implementation = self.app_data["implementation"]
        self.assertTrue(implementation["native_host_route_implemented"])
        self.assertTrue(implementation["web_owner_implemented"])
        self.assertTrue(implementation["verified_publisher_binding_implemented"])
        self.assertTrue(implementation["published_in_app_sdk"])
        self.assertEqual(implementation["published_app_sdk_bundle_version"], "1.6.0")
        self.assertTrue(implementation["trusted_first_party_port_injection_active"])

        current_sdk_version = tuple(int(part) for part in self.sdk["bundle_version"].split("."))
        published_version = tuple(
            int(part)
            for part in implementation["published_app_sdk_bundle_version"].split(".")
        )
        self.assertGreaterEqual(current_sdk_version, published_version)
        schemas = {entry["schema"] for entry in self.sdk["contracts"]}
        self.assertIn("ordax.app-data/1", schemas)

    def test_web_owner_preserves_partition_wide_cas_and_fail_closed_durability(self):
        web = self.app_data["web_owner"]
        self.assertTrue(web["implemented"])
        self.assertEqual(web["durable_backend"], "localStorage")
        self.assertFalse(web["session_memory_fallback_allowed"])
        self.assertEqual(
            web["mutation_lock"],
            "Web Locks API exclusive lock per verified partition",
        )
        self.assertTrue(web["missing_lock_authority_fails_closed"])
        self.assertTrue(web["persisted_state_revalidates_hard_bounds"])
        self.assertTrue(web["persisted_state_revalidates_configured_quota"])
        self.assertTrue(web["cross_context_compare_and_swap_proven"])
        self.assertEqual(
            self.app_data["runtime_port"]["mutation_concurrency"],
            "partition-wide-compare-and-swap",
        )

    def test_notes_cutover_is_complete_without_claiming_legacy_seed_or_broad_public_enablement(self):
        implementation = self.app_data["implementation"]
        self.assertTrue(implementation["notes_source_cutover_complete"])
        self.assertTrue(implementation["notes_uses_app_data"])
        self.assertFalse(implementation["legacy_notes_seed_required"])
        self.assertTrue(implementation["notes_independent_app_lifecycle_proven"])
        self.assertFalse(implementation["independent_app_install_lifecycle_proven"])
        self.assertFalse(implementation["third_party_enabled"])
        self.assertFalse(implementation["production_enabled"])
        self.assertEqual(
            implementation["production_scope"],
            "trusted-first-party-native-composition-only",
        )

        transport = self.native["transport_foundation"]
        self.assertTrue(transport["host_route_wired"])
        self.assertTrue(transport["publisher_binding_from_verified_install_owner"])
        self.assertTrue(transport["trusted_composition_receives_opaque_bound_endpoint"])
        self.assertTrue(transport["port_injection_to_first_party_component_context"])
        self.assertFalse(transport["app_receives_opaque_bound_endpoint"])

        lifecycle = self.native["lifecycle"]
        self.assertTrue(lifecycle["notes_source_cutover_complete"])
        self.assertTrue(lifecycle["notes_uses_app_data"])
        self.assertFalse(lifecycle["legacy_notes_seed_required"])
        self.assertFalse(lifecycle["legacy_notes_payload_migrated"])


if __name__ == "__main__":
    unittest.main()
