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
        self.assertEqual(set(repos), {"platform", "surface", "apps", "runtime", "control_plane", "public_site", "creator", "desktop"})
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
        self.assertEqual(repos["desktop"]["repo"], "ordaxsystems/ordax-desktop")
        self.assertIn("desktop-windows-shell", repos["desktop"]["owns"])
        self.assertIn("desktop-windows-shell", repos["platform"]["must_not_own"])

    def test_ninth_intelligence_source_is_pinned_without_premature_owner_cutover(self):
        # Eight active runtime/product authorities plus one separately owned, pinned
        # source candidate. Do not silently promote source into runtime authority.
        source = json.loads(
            (ROOT / "docs/contracts/intelligence-source.json").read_text(encoding="utf-8")
        )
        repos = self.contract["repositories"]
        active = {record["repo"] for record in repos.values()}
        self.assertEqual(len(active), len(repos), "duplicate active repository")
        self.assertEqual(source["source_repository"], "ordaxsystems/ordax-intelligence")
        self.assertNotIn(source["source_repository"], active)
        self.assertEqual(len(active | {source["source_repository"]}), 9)
        self.assertEqual(source["status"], "integration-candidate")
        self.assertIs(source["cutover_complete"], False)
        self.assertIs(source["activation_authorized"], False)
        self.assertIs(source["builder_activation_authorized"], False)
        self.assertIs(source["change_live_os"], False)
        self.assertIs(source["source_only"], True)
        source_paths = set(source["source_paths"])
        self.assertIn("src/snapshot-notification.mjs", source_paths)
        self.assertIn("tools/inference-builder/build.py", source_paths)
        self.assertTrue(all(
            path == "tools/inference-builder/build.py"
            or (path.startswith("src/") and path.endswith(".mjs"))
            for path in source_paths
        ))
        self.assertIn("intelligence", repos["platform"]["owns"])
        # Memory, model authorization and Native/Supervisor remain OS owners.
        self.assertIn("global-memory", repos["platform"]["owns"])
        self.assertIn("native-capability-preflight", repos["platform"]["owns"])

    def test_surface_source_pin_triggers_consumer_contracts_not_retired_ui_source(self):
        # The OS never owns the visual files; its contract pin is the only
        # cross-repository change that can change their version in OS builds.
        owner = self.contract["repositories"]["surface"]
        self.assertEqual(owner["repo"], "ordaxsystems/ordax-surface")
        pin = json.loads(
            (ROOT / "docs/contracts/surface-source.json").read_text(encoding="utf-8")
        )
        self.assertEqual(pin["source_repository"], owner["repo"])
        self.assertTrue(pin["invariants"]["single_visual_source_after_cutover"])
        for name in (
            "first-party-app-delivery.yml",
            "intelligence-foundation.yml",
            "portable-runtime-foundation.yml",
        ):
            with self.subTest(workflow=name):
                source = (ROOT / ".github/workflows" / name).read_text(encoding="utf-8")
                events, jobs = source.split("\njobs:\n", 1)
                self.assertEqual(
                    events.count("      - 'docs/contracts/surface-source.json'"), 2
                )
                self.assertNotIn("      - 'system/surface/ui/", events)
                self.assertIn("  push:\n", events)
                self.assertIn("  pull_request:\n", events)
                self.assertIn(
                    "uses: ./.github/actions/prepare-verified-surface", jobs
                )
                self.assertIn("actions/checkout@", jobs)
        # Reintroducing visual source into OS must still be detected by the
        # dedicated owner consumer: do not remove this resurrection sentinel.
        dedicated = (
            ROOT / ".github/workflows/surface-source-consumer.yml"
        ).read_text(encoding="utf-8")
        self.assertEqual(dedicated.count("      - 'system/surface/ui/**'"), 2)
        self.assertEqual(
            dedicated.count("      - 'system/surface/workspace/**'"), 2
        )

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
        control_plane_repo = self.contract["repositories"]["control_plane"]["repo"]
        self.assertEqual(control_plane_repo, "ordaxsystems/ordax-platform")
        conditions = legacy["delete_only_after"]
        self.assertIn(
            "control-plane-canonical-in-" + control_plane_repo.split("/", 1)[1],
            conditions,
        )
        self.assertNotIn("control-plane-canonical-in-ordax-control-plane", conditions)

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
        for role in ("platform", "apps", "runtime", "control_plane", "surface", "public_site", "creator", "desktop"):
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

    def test_federated_documentation_entrypoint_matches_owner_contract(self):
        """Keep global documentation routing tied to the executable ownership SSOT."""
        index = (ROOT / "docs" / "README.md").read_text(encoding="utf-8")
        self.assertIn("## Autoridade documental do ecossistema multi-repositório", index)
        self.assertIn("## Regra de publicação documental — SSOT central, sem espelhos", index)
        self.assertIn("**Mudança transversal:**", index)
        self.assertIn("forge/FORGE-GPT-FIRST-ADMINISTRADOR-ROADMAP.md", index)
        self.assertTrue((ROOT / "docs/forge/FORGE-GPT-FIRST-ADMINISTRADOR-ROADMAP.md").is_file())
        self.assertIn("(contracts/repository-ownership.json)", index)
        self.assertIn("Uma responsabilidade normativa = um documento/contrato proprietário", index)
        self.assertIn("Não criar", index)
        for role, record in self.contract["repositories"].items():
            with self.subTest(role=role):
                repository = record["repo"]
                self.assertEqual(repository.count("/"), 1)
                if repository == self.contract["repositories"]["platform"]["repo"]:
                    continue
                self.assertIn(
                    f"https://github.com/{repository}",
                    index,
                    f"missing owner documentation directory for {role}",
                )
        self.assertNotIn(
            "blob/main/INTELLIGENCE-HANDOFF.md",
            index,
            "removed historical handoff cannot be an active documentation route",
        )


if __name__ == "__main__":
    unittest.main()
