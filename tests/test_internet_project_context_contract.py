from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTROLS = ROOT / "system" / "apps" / "internet" / "ui" / "browser-controls.mjs"
INTERNET_I18N = ROOT / "system" / "services" / "i18n" / "catalog" / "internet.mjs"
NATIVE_MAIN = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB_MAIN = ROOT / "system" / "composition" / "web" / "main.mjs"
INTERNET_RUNTIME = ROOT / "system" / "apps" / "internet" / "runtime.mjs"
REFERENCE_CONTRACT = ROOT / "system" / "contracts" / "project-web-references.mjs"
REFERENCE_STORE = ROOT / "system" / "contracts" / "project-web-reference-store.mjs"
REFERENCE_RUNTIME = ROOT / "system" / "services" / "projects" / "web-references.mjs"
REFERENCE_ADAPTER = ROOT / "system" / "adapters" / "native" / "project-web-references.mjs"


class InternetProjectContextContractTests(unittest.TestCase):
    def text(self, path):
        return path.read_text(encoding="utf-8")

    def test_browser_consumes_project_reader_and_mutations_through_separate_contracts(self):
        controls = self.text(CONTROLS)
        self.assertIn('contracts/project-catalog.mjs', controls)
        self.assertIn('contracts/project-mutations.mjs', controls)
        self.assertIn('assertProjectCatalogReader', controls)
        self.assertIn('assertProjectMutations', controls)
        self.assertNotIn('assertProjectCatalogPort', controls)
        self.assertIn('projects = null', controls)
        self.assertIn('projectMutations = null', controls)
        self.assertIn('projectReferences = null', controls)
        self.assertIn('projectReader?.getSnapshot()', controls)
        self.assertIn('projectReader?.subscribe', controls)
        self.assertIn('await projectMutationPort.recordOpened(projectId)', controls)

    def test_native_composition_shares_reader_and_mutations_with_files_and_internet(self):
        native = self.text(NATIVE_MAIN)
        self.assertIn('createNativeProjectAuthorityComposition', native)
        self.assertIn('createNativeProjectStateTransport', native)
        self.assertIn('const projects = projectAuthority?.reader ?? null', native)
        self.assertIn('const projectMutations = projectAuthority?.mutations ?? null', native)
        self.assertNotIn('createProjectCatalogRuntime', native)
        self.assertIn('{ recentFiles, projects, projectMutations }', native)
        self.assertIn('createProjectWebReferenceRuntime', native)
        self.assertIn('createNativeProjectWebReferenceStore', native)
        self.assertIn('projects,', native)
        self.assertIn('projectMutations,', native)
        self.assertIn('projectReferences,', native)
        self.assertIn('createFavoritesStore:', native)
        self.assertIn('createHistoryStore:', native)
        self.assertIn('projectReferences?.destroy()', native)
        runtime = self.text(INTERNET_RUNTIME)
        self.assertIn('projects = null', runtime)
        self.assertIn('projectMutations = null', runtime)
        self.assertIn('projectReferences = null', runtime)
        self.assertIn('{ projects, projectMutations, projectReferences, favorites, history }', runtime)

    def test_web_composition_keeps_project_context_unavailable_without_fake_storage(self):
        web = self.text(WEB_MAIN)
        self.assertIn('import("../../apps/internet/runtime.mjs")', web)
        self.assertNotIn('createProjectCatalogRuntime', web)
        self.assertNotIn('createProjectWebReferenceRuntime', web)
        self.assertNotIn('createNativeProjectWebReferenceStore', web)

    def test_reference_persistence_has_its_own_project_owned_contract(self):
        controls = self.text(CONTROLS)
        contract = self.text(REFERENCE_CONTRACT)
        store = self.text(REFERENCE_STORE)
        runtime = self.text(REFERENCE_RUNTIME)
        adapter = self.text(REFERENCE_ADAPTER)

        self.assertIn('PROJECT_WEB_REFERENCES_SCHEMA = "ordax.project-web-references/1"', contract)
        self.assertIn('MAX_PROJECT_WEB_REFERENCES = 512', contract)
        self.assertIn('assertProjectWebReferencePort', controls)
        self.assertIn('projectReferences = null', controls)
        self.assertIn('referencePort.save({', controls)
        self.assertIn('referencePort.remove(', controls)
        self.assertIn('dataset.browserSaveProject', controls)
        self.assertIn('dataset.browserReferenceNote', controls)
        self.assertIn('PROJECT_WEB_REFERENCE_STORE_SCHEMA', store)
        self.assertIn('assertProjectCatalogReader(projects)', runtime)
        self.assertNotIn('assertProjectCatalogPort(projects)', runtime)
        self.assertIn('removeMissingProjects', runtime)
        self.assertIn('ordax.native.project-web-references.v1', adapter)
        self.assertNotIn('localStorage', controls)
        self.assertNotIn('sessionStorage', controls)
        self.assertNotIn('/__ordax/native/', controls)

    def test_project_selection_is_explicitly_session_scoped(self):
        controls = self.text(CONTROLS)
        i18n = self.text(INTERNET_I18N)
        self.assertIn('t("internet.project.sessionHeading")', controls)
        self.assertIn('t("internet.project.choose")', controls)
        self.assertIn('"internet.project.sessionHeading": "PROJECT FOR THIS SESSION"', i18n)
        self.assertIn('"internet.project.choose": "Choose a project already registered in Files. The selection applies only to this browser session."', i18n)
        self.assertIn('selectedProjectId = null', controls)
        self.assertIn('dataset.browserProjectOptions', controls)
        self.assertIn('aria-pressed', controls)


if __name__ == "__main__":
    unittest.main()
