from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
APPS = ROOT / "system" / "apps"
PROJECTS = APPS / "projects"
CATALOG = APPS / "catalog.mjs"
COMPONENT_CATALOG = APPS / "component-catalog.mjs"
NATIVE = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB = ROOT / "system" / "composition" / "web" / "main.mjs"
SHELL = ROOT / "system" / "surface" / "ui" / "desktop-shell.mjs"
SURFACE_I18N = ROOT / "system" / "services" / "i18n" / "surface.mjs"
PROJECTS_I18N = ROOT / "system" / "services" / "i18n" / "catalog" / "projects.mjs"
PROJECT_EVIDENCE_RUNTIME = ROOT / "system" / "services" / "projects" / "evidence-runtime.mjs"
PROJECT_EVIDENCE_CONTEXT = ROOT / "system" / "services" / "intelligence" / "project-evidence-context.mjs"


class ProjectsAppContractTests(unittest.TestCase):
    def text(self, path):
        return path.read_text(encoding="utf-8")

    def test_projects_is_a_real_independent_first_party_component(self):
        app = self.text(PROJECTS / "app.mjs")
        component = self.text(PROJECTS / "component.mjs")
        version = self.text(PROJECTS / "version.mjs")
        catalog = self.text(CATALOG)
        component_catalog = self.text(COMPONENT_CATALOG)

        self.assertIn('id: "projects"', app)
        self.assertIn('extensionId: "projects-workspace"', app)
        self.assertIn('projectsApp', catalog)
        self.assertIn('projectsComponent', component_catalog)
        self.assertIn('PROJECTS_VERSION = "0.1.0"', version)
        self.assertIn('releaseMode: "git-app"', component)
        self.assertIn('restartScope: "component"', component)
        self.assertIn('failureDomain: "app"', component)
        self.assertIn('healthMode: "runtime"', component)

    def test_projects_consumes_existing_catalog_instead_of_creating_another(self):
        controls = self.text(PROJECTS / "ui" / "workspace-controls.mjs")
        runtime = self.text(PROJECTS / "runtime.mjs")
        native = self.text(NATIVE)

        self.assertIn("assertProjectCatalogPort", controls)
        self.assertIn("assertProjectCloudLinksPort", controls)
        self.assertIn("assertProjectWebReferencePort", controls)
        self.assertIn("assertProjectEvidencePort", controls)
        self.assertNotIn("createProjectCatalogRuntime", controls)
        self.assertNotIn("createProjectCatalogRuntime", runtime)
        self.assertNotIn("assertFileSpacePort", runtime)
        self.assertNotIn("fileSpace", runtime)
        self.assertIn('componentId: "projects"', runtime)
        self.assertIn("projects,", native)
        self.assertIn("projectCloudLinks,", native)
        self.assertIn("projectWebReferences: projectReferences", native)
        self.assertIn("projectEvidence,", native)
        self.assertIn('import("../../apps/projects/runtime.mjs")', native)

    def test_native_has_real_local_projects_and_web_degrades_honestly(self):
        native = self.text(NATIVE)
        web = self.text(WEB)

        self.assertIn("createProjectCloudLinksRuntime", native)
        self.assertIn("createNativeProjectCloudLinkStore", native)
        self.assertIn("createProjectWebReferenceRuntime", native)
        self.assertIn("createNativeProjectWebReferenceStore", native)
        self.assertIn("createProjectEvidenceRuntime", native)
        self.assertIn("createProjectEvidenceRuntime({ projects, fileSpace })", native)
        self.assertIn("projectReferences?.destroy()", native)
        self.assertIn("projectCloudLinks?.destroy()", native)
        self.assertIn('componentId: "projects"', web)
        self.assertIn("projects: null", web)
        self.assertIn("projectCloudLinks: null", web)
        self.assertNotIn("createProjectCatalogRuntime", web)
        self.assertNotIn("createProjectEvidenceRuntime", web)

    def test_projects_opens_existing_project_through_shared_app_activation(self):
        controls = self.text(PROJECTS / "ui" / "workspace-controls.mjs")
        self.assertIn("assertAppActivationPort", controls)
        self.assertIn('activation.publish({ appId: "files", target: item.path })', controls)
        self.assertNotIn("/__ordax/native/", controls)
        self.assertNotIn("localStorage", controls)

    def test_projects_can_hand_off_typed_read_only_context_to_intelligence(self):
        controls = self.text(PROJECTS / "ui" / "workspace-controls.mjs")
        runtime = self.text(PROJECTS / "runtime.mjs")

        self.assertIn("encodeIntelligenceHandoffTarget", controls)
        self.assertIn("assertIntelligenceContextSharePort", controls)
        self.assertIn('appId: "intelligence"', controls)
        self.assertIn('sourceAppId: "projects"', controls)
        self.assertIn('offerProjectToIntelligence(item, "chat")', controls)
        self.assertIn('offerProjectToIntelligence(item, "plan")', controls)
        self.assertIn('const target = { kind: "project", id: project.id }', controls)
        self.assertIn("displayLabel: project.name", controls)
        self.assertIn("PROJECT_CONTEXT_SOURCE_ID", controls)
        self.assertIn("createProjectIntelligenceContext(project, {", controls)
        self.assertIn(
            'provenance: "ordax:projects:user-authorized-selection:catalog-cloud-reference-metadata"',
            controls,
        )
        self.assertIn("projectWebReferences = null", runtime)
        self.assertIn("getDefaultIntelligenceContextSharingRuntime", runtime)
        self.assertIn("intelligenceContextShare: contextShare", runtime)
        self.assertNotIn("requestedCapabilities", controls)

        context_helper = controls.split(
            "export function createProjectIntelligenceContext(", 1
        )[1].split("export function createProjectsPresentation", 1)[0]
        self.assertNotIn("project.path", context_helper)
        self.assertNotIn("reference.url", context_helper)
        self.assertNotIn("cloudProjectId", context_helper)
        self.assertIn("referenceCount", context_helper)
        self.assertIn("referencesIncluded", context_helper)

    def test_project_file_evidence_is_explicit_narrow_and_read_only(self):
        controls = self.text(PROJECTS / "ui" / "workspace-controls.mjs")
        runtime = self.text(PROJECTS / "runtime.mjs")
        evidence = self.text(PROJECT_EVIDENCE_RUNTIME)
        context = self.text(PROJECT_EVIDENCE_CONTEXT)

        self.assertIn("projectEvidence = null", runtime)
        self.assertIn("projectEvidence,", runtime)
        self.assertIn("assertProjectEvidencePort", controls)
        self.assertIn("projectsAnalyzeEvidence", controls)
        self.assertIn("evidencePort.inspect(project.id)", controls)
        self.assertIn("PROJECT_EVIDENCE_CONTEXT_SOURCE_ID", controls)
        self.assertIn("createProjectEvidenceIntelligenceContext", controls)
        self.assertIn('sourceAppId: "projects"', controls)
        self.assertIn('kind: "project"', controls)
        self.assertIn('authority: "none"', controls)
        self.assertIn('executable: false', controls)
        self.assertIn('toolExecution: false', controls)

        self.assertIn("assertFileSpacePort", evidence)
        self.assertIn("assertProjectCatalogPort", evidence)
        self.assertIn("await files.list(project.path)", evidence)
        self.assertIn("await files.readTextFile", evidence)
        for mutation in [
            "files.createDirectory",
            "files.renameEntry",
            "files.copyFile",
            "files.moveEntry",
            "files.trashEntry",
            "files.restoreTrashEntry",
            "files.exportFile",
            "files.importFile",
        ]:
            self.assertNotIn(mutation, evidence)
        self.assertNotIn("project.path", context)
        self.assertNotIn("fileSpace", context)
        self.assertNotIn("shell", evidence.lower())
        self.assertNotIn(".git", evidence.lower())

    def test_projects_is_localized_and_visible_in_shared_shell(self):
        shell = self.text(SHELL)
        surface_i18n = self.text(SURFACE_I18N)
        projects_i18n = self.text(PROJECTS_I18N)

        self.assertIn('railButton("projects"', shell)
        self.assertIn('"app.projects.title": "Projetos"', surface_i18n)
        self.assertIn('"app.projects.title": "Projects"', surface_i18n)
        self.assertIn('"projects.action.openFiles": "Abrir em Arquivos"', projects_i18n)
        self.assertIn('"projects.action.openFiles": "Open in Files"', projects_i18n)
        self.assertIn('"projects.action.askIntelligence": "Perguntar à Intelligence"', projects_i18n)
        self.assertIn('"projects.action.askIntelligence": "Ask Intelligence"', projects_i18n)
        self.assertIn('"projects.action.planWithIntelligence": "Planejar com Intelligence"', projects_i18n)
        self.assertIn('"projects.action.planWithIntelligence": "Plan with Intelligence"', projects_i18n)
        self.assertIn('"projects.action.analyzeEvidence": "Analisar evidências"', projects_i18n)
        self.assertIn('"projects.action.analyzeEvidence": "Analyze evidence"', projects_i18n)
        self.assertNotIn('timeZone: "America/Bahia"', self.text(PROJECTS / "ui" / "workspace-controls.mjs"))


if __name__ == "__main__":
    unittest.main()
