import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "repository-ownership.json"

class RepositoryOwnershipContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_canonical_repositories_include_separate_surface_visual_owner(self):
        repos = self.contract["repositories"]
        self.assertEqual(set(repos), {"platform", "surface", "apps", "runtime", "control_plane", "public_site", "creator"})
        self.assertEqual(repos["public_site"]["repo"], "ordaxsystems/ordax-site")
        self.assertIn("public-site-static-build-and-i18n", repos["public_site"]["owns"])
        self.assertIn("identity-backend", repos["public_site"]["must_not_own"])
        self.assertEqual(repos["surface"]["repo"], "ordaxsystems/ordax-surface")
        self.assertIn("surface-visual-shell", repos["surface"]["owns"])
        self.assertIn("surface-native-host", repos["platform"]["owns"])
        self.assertNotIn("surface-shell", repos["platform"]["owns"])
        self.assertEqual(repos["platform"]["repo"], "ordaxsystems/ordax-os")
        self.assertEqual(repos["apps"]["repo"], "ordaxsystems/ordax-apps")
        self.assertEqual(repos["runtime"]["repo"], "ordaxsystems/ordax-runtime")
        self.assertEqual(repos["control_plane"]["repo"], "ordaxsystems/ordax-platform")

    def test_creator_is_independent_consumer_not_os_media_producer(self):
        repos = self.contract["repositories"]
        creator = repos["creator"]
        self.assertEqual(creator["repo"], "ordaxsystems/ordax-creator")
        self.assertIn("creator-media-verification-core", creator["owns"])
        self.assertIn("creator-windows-ui-and-host-adapters", creator["owns"])
        self.assertIn("os-media-proof-producers", creator["must_not_own"])
        self.assertIn("os-release-and-signing-authority", creator["must_not_own"])
        self.assertIn("physical-write-authorization", creator["must_not_own"])
        self.assertIn("boot", repos["platform"]["owns"])
        self.assertIn("package-lifecycle", repos["platform"]["owns"])
        self.assertNotIn("creator-media-verification-core", repos["platform"]["owns"])

    def test_studio_runtime_and_control_plane_have_distinct_owners(self):
        repos = self.contract["repositories"]
        self.assertIn("studio-portable-source", repos["apps"]["owns"])
        self.assertIn("windows-ordax-runtime", repos["runtime"]["owns"])
        self.assertIn("product-mcp", repos["control_plane"]["owns"])
        self.assertIn("app-sdk", repos["platform"]["owns"])

    def test_windows_mcp_distribution_is_runtime_owned_and_studio_optional(self):
        repos = self.contract["repositories"]
        self.assertEqual(repos["runtime"]["repo"], "ordaxsystems/ordax-runtime")
        self.assertIn("windows-ordax-mcp-distribution", repos["runtime"]["owns"])
        self.assertNotIn("windows-ordax-mcp-distribution", repos["apps"]["owns"])
        self.assertIn("windows-mcp-installer", repos["apps"]["must_not_own"])
        self.assertIn("product-mcp", repos["control_plane"]["owns"])
        invariants = self.contract["invariants"]
        self.assertTrue(invariants["windows_studio_is_optional_runtime_consumer"])
        self.assertTrue(invariants["windows_mcp_distribution_independent_of_studio"])
        self.assertNotIn("windows_studio_is_owner_ui_not_authority", invariants)
        document = (ROOT / "docs" / "REPOSITORY-OWNERSHIP.md").read_text(encoding="utf-8")
        self.assertIn("### OrdaX MCP independente para Windows", document)
        self.assertIn("Studio consome capabilities autorizadas como qualquer outro aplicativo", document)
        self.assertIn("não é release", document)
        self.assertNotIn("Studio pode apresentar a\\ninterface Owner", document)

    def test_legacy_repo_is_retirement_only(self):
        legacy = self.contract["legacy"]
        self.assertEqual(legacy["repo"], "washingtonmsdj/mcp-blender")
        self.assertEqual(legacy["role"], "incubation-legacy-retirement-only")
        self.assertFalse(legacy["new_features_allowed"])
        self.assertGreaterEqual(len(legacy["delete_only_after"]), 6)

    def test_current_owner_documentation_matches_canonical_namespace(self):
        document = (ROOT / "docs" / "REPOSITORY-OWNERSHIP.md").read_text(encoding="utf-8")
        migration = json.loads(
            (ROOT / "docs" / "contracts" / "repository-migration-status.json")
            .read_text(encoding="utf-8")
        )
        self.assertIn(f"Status de migração: `{migration['status']}`", document)
        self.assertEqual(
            migration["canonical_repositories"],
            {role: self.contract["repositories"][role]["repo"] for role in migration["canonical_repositories"]},
        )
        active = document.split("## Fluxos oficiais", 1)[1].split(
            "## Regra para o legado mcp-blender", 1
        )[0]
        for role in ("platform", "apps", "runtime", "control_plane", "surface", "public_site", "creator"):
            self.assertIn(self.contract["repositories"][role]["repo"], active)
        # Use the historical repository identity from the canonical migration
        # record rather than hard-coding an obsolete operational name inside
        # the live contract test (which is also audited for stale references).
        historical_control_plane = migration["evidence"][
            "ordax_control_plane_namespace_transfer"
        ]["previous_repository"].split("/", 1)[1]
        self.assertNotIn(historical_control_plane, active)
        self.assertNotIn("prototipo-ordax-os", active)
        self.assertNotIn("migração do legado pendente", document)

    def test_current_state_snapshot_has_live_canonical_repository(self):
        snapshot = (ROOT / "docs" / "CURRENT-STATE.md").read_text(encoding="utf-8")
        section = snapshot.split("## Repository\n", 1)[1].split("\n## ", 1)[0]
        self.assertIn(
            f"REPOSITORY={self.contract['repositories']['platform']['repo']}", section
        )
        self.assertIn("PROMOTED_TO_OFFICIAL=YES", section)
        # The migration verifier is the single owner of obsolete namespace
        # identities. The test checks the value, not a second stale literal.
        from tools.verify.repository_namespace_transfer_preflight import (
            PREVIOUS_OWNER, REPOSITORY_NAME,
        )
        self.assertNotIn(f"{PREVIOUS_OWNER}/{REPOSITORY_NAME}", section)
        self.assertNotIn("PROMOTED_TO_OFFICIAL=NO", section)

    def test_agent_and_readme_entrypoints_follow_official_repo_ssot(self):
        canonical = self.contract["repositories"]["platform"]["repo"]
        migration = json.loads(
            (ROOT / "docs" / "contracts" / "repository-migration-status.json")
            .read_text(encoding="utf-8")
        )
        self.assertEqual(migration["canonical_repositories"]["platform"], canonical)
        self.assertEqual(migration["status"], "cutover-complete-legacy-retired")
        for entrypoint in ("AGENTS.md", "README.md"):
            with self.subTest(entrypoint=entrypoint):
                header = (ROOT / entrypoint).read_text(encoding="utf-8")[:1500]
                self.assertIn(f"`{canonical}`", header)
                self.assertIn("docs/contracts/repository-ownership.json", header)
                self.assertIn("docs/contracts/repository-migration-status.json", header)
                self.assertIn("Stable/MVP", header)
                self.assertIn("docs/PROMOTION-GATES.md", header)
                self.assertNotIn("PROTOTIPO / NAO PROMOVIDO", header)
                self.assertNotIn("Nao trate este repositorio como sucessor oficial", header)

    def test_security_and_ssot_invariants(self):
        invariants = self.contract["invariants"]
        for key, value in invariants.items():
            self.assertTrue(value, key)

    def test_no_duplicate_canonical_ownership_for_key_boundaries(self):
        repos = self.contract["repositories"]
        ownership = {}
        for name, data in repos.items():
            for item in data["owns"]:
                self.assertNotIn(item, ownership, f"{item} duplicated by {ownership.get(item)} and {name}")
                ownership[item] = name

if __name__ == "__main__":
    unittest.main()
