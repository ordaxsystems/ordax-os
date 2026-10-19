"""Static regression checks for the existing OS/Platform terminology boundary.

These tests do not prove a deployed PostgreSQL schema or MCP E2E operation.
"""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class SpacePlatformTerminologyContractTest(unittest.TestCase):
    def test_existing_space_and_profile_contracts_stay_distinct(self):
        manifest = json.loads((ROOT / "docs/contracts/spaces-and-profile-packs.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["space_port"], "ordax.spaces/1")
        self.assertEqual(manifest["profile_pack_port"], "ordax.profile-packs/1")
        self.assertTrue(manifest["ownership"]["account_profile_is_not_a_professional_profile"])
        self.assertTrue(manifest["ownership"]["profile_pack_owns_technical_composition"])
        self.assertEqual(manifest["space_type"]["canonical_semantics_owner"], "public.ordax_spaces.domain+subtype")

    def test_project_local_catalog_not_cloud_identity(self):
        local = (ROOT / "system/contracts/project-catalog.mjs").read_text(encoding="utf-8")
        cloud = json.loads((ROOT / "docs/contracts/cloud-projects-devices.json").read_text(encoding="utf-8"))
        self.assertIn('PROJECT_CATALOG_SCHEMA = "ordax.project-catalog/1"', local)
        self.assertIn('PERSISTENCE_SCOPES = new Set(["device", "session"])', local)
        self.assertTrue(cloud["projects"]["space_scoped"])
        self.assertTrue(cloud["projects"]["local_cloud_link_optional"])
        self.assertTrue(cloud["projects"]["local_project_identity_survives_unlinked"])
        self.assertTrue(cloud["projects"]["link_does_not_sync_files"])

    def test_canonical_document_covers_distinct_authority_and_grants(self):
        doc = (ROOT / "docs/SPACES-AND-PROFILES.md").read_text(encoding="utf-8")
        for marker in (
            "## Interoperabilidade canônica: Platform, MCP, Studio, Flow",
            "`ordax_spaces.space_id`",
            "`ordax_projects.project_id`",
            "`ordax_project_connections`",
            "`ordax_space_devices`",
            "`ordax_device_project_bindings`",
            "`ordax.profile-packs/1`",
            "`ordax.project-catalog/1`",
            "`session.subject_id`",
            "`process_list`",
            "`terminal_exec`",
            "`ordax_targets`",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, doc)


if __name__ == "__main__":
    unittest.main()
