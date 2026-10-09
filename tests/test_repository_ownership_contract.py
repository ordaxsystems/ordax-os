import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "repository-ownership.json"

class RepositoryOwnershipContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_four_canonical_repositories(self):
        repos = self.contract["repositories"]
        self.assertEqual(set(repos), {"platform", "apps", "runtime", "control_plane"})
        self.assertEqual(repos["platform"]["repo"], "ordaxsystems/ordax-os")
        self.assertEqual(repos["apps"]["repo"], "ordaxsystems/ordax-apps")
        self.assertEqual(repos["runtime"]["repo"], "ordaxsystems/ordax-runtime")
        self.assertEqual(repos["control_plane"]["repo"], "ordaxsystems/ordax-platform")

    def test_studio_runtime_and_control_plane_have_distinct_owners(self):
        repos = self.contract["repositories"]
        self.assertIn("studio-portable-source", repos["apps"]["owns"])
        self.assertIn("windows-ordax-runtime", repos["runtime"]["owns"])
        self.assertIn("product-mcp", repos["control_plane"]["owns"])
        self.assertIn("app-sdk", repos["platform"]["owns"])

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
            {role: data["repo"] for role, data in self.contract["repositories"].items()},
        )
        active = document.split("## Fluxos oficiais", 1)[1].split(
            "## Regra para o legado mcp-blender", 1
        )[0]
        for role in ("platform", "apps", "runtime", "control_plane"):
            self.assertIn(self.contract["repositories"][role]["repo"], active)
        self.assertNotIn("ordax-control-plane", active)
        self.assertNotIn("prototipo-ordax-os", active)
        self.assertNotIn("migração do legado pendente", document)

    def test_current_state_snapshot_has_live_canonical_repository(self):
        snapshot = (ROOT / "docs" / "CURRENT-STATE.md").read_text(encoding="utf-8")
        section = snapshot.split("## Repository\n", 1)[1].split("\n## ", 1)[0]
        self.assertIn(
            f"REPOSITORY={self.contract['repositories']['platform']['repo']}", section
        )
        self.assertIn("PROMOTED_TO_OFFICIAL=YES", section)
        self.assertNotIn("washingtonmsdj/prototipo-ordax-os", section)
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
