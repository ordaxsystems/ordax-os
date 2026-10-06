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

        self.assertIn("assertProjectCatalogReader", controls)
        self.assertNotIn("assertProjectCatalogPort", controls)
        self.assertIn("assertProjectCloudLinksReaderPort", controls)
        self.assertIn("project-cloud-links-reader.mjs", controls)
        self.assertNotIn("assertProjectCloudLinksPort", controls)
        self.assertNotIn("project-cloud-links.mjs", controls)
        self.assertNotIn("createProjectCatalogRuntime", controls)
        self.assertNotIn("createProjectCatalogRuntime", runtime)
        self.assertIn('componentId: "projects"', runtime)
        self.assertIn("projects,", native)
        self.assertIn("createProjectCloudLinksReader", native)
        self.assertIn("projectCloudLinks: projectCloudLinksReader", native)
        self.assertNotIn("projectCloudLinks,\n      appActivation", native)
        self.assertIn('import("../../apps/projects/runtime.mjs")', native)

    def test_native_has_real_local_projects_and_web_degrades_honestly(self):
        native = self.text(NATIVE)
        web = self.text(WEB)

        self.assertIn("createProjectCloudLinksRuntime", native)
        self.assertIn("createNativeProjectCloudLinkStore", native)
        self.assertIn("createProjectCloudLinksReader", native)
        self.assertIn("projectCloudLinks?.destroy()", native)
        self.assertIn('componentId: "projects"', web)
        self.assertIn("projects: null", web)
        self.assertIn("projectCloudLinks: null", web)
        self.assertNotIn("createProjectCatalogRuntime", web)

    def test_projects_opens_existing_project_through_shared_app_activation(self):
        controls = self.text(PROJECTS / "ui" / "workspace-controls.mjs")
        self.assertIn("assertAppActivationPort", controls)
        self.assertIn('activation.publish({ appId: "files", target: item.path })', controls)
        self.assertNotIn("/__ordax/native/", controls)
        self.assertNotIn("localStorage", controls)

    def test_projects_is_localized_and_visible_in_shared_shell(self):
        shell = self.text(SHELL)
        surface_i18n = self.text(SURFACE_I18N)
        projects_i18n = self.text(PROJECTS_I18N)

        self.assertIn('railButton("projects"', shell)
        self.assertIn('"app.projects.title": "Projetos"', surface_i18n)
        self.assertIn('"app.projects.title": "Projects"', surface_i18n)
        self.assertIn('"projects.action.openFiles": "Abrir em Arquivos"', projects_i18n)
        self.assertIn('"projects.action.openFiles": "Open in Files"', projects_i18n)
        self.assertNotIn('timeZone: "America/Bahia"', self.text(PROJECTS / "ui" / "workspace-controls.mjs"))


if __name__ == "__main__":
    unittest.main()
