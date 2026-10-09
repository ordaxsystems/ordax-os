from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTROLS = ROOT / "system" / "surface" / "ui" / "file-space-controls.mjs"
COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"
WORKFLOW = ROOT / ".github" / "workflows" / "surface-web-candidate.yml"
FILES_I18N = ROOT / "system" / "services" / "i18n" / "catalog" / "files.mjs"


class ProjectFilesUiContractTests(unittest.TestCase):
    def test_shared_files_owner_consumes_neutral_project_catalog(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn('from "../../contracts/project-catalog.mjs"', controls)
        self.assertIn("assertProjectCatalogPort", controls)
        self.assertIn("dataset.fileOpenProject", controls)
        self.assertIn("dataset.fileProjectCreateStart", controls)
        self.assertIn("dataset.fileProjectName", controls)
        self.assertIn("dataset.fileProjectCreate", controls)
        self.assertIn("dataset.fileProjectResume", controls)
        self.assertIn("dataset.fileProjectForgetStale", controls)
        self.assertIn("dataset.fileProjectRenameStart", controls)
        self.assertIn("dataset.fileProjectRenameName", controls)
        self.assertIn("dataset.fileProjectRenameConfirm", controls)
        self.assertIn("dataset.fileProjectRenameCancel", controls)
        self.assertIn("dataset.fileProjectRemove", controls)
        self.assertIn("projectPort.rename(renamingProjectId, projectRenameDraft)", controls)
        self.assertIn("projectPort.recordOpened(projectId)", controls)
        self.assertIn("projectPort.recordFileOpened(project.id, next.path)", controls)
        self.assertIn("projectPort.clearLastFile(projectId)", controls)
        self.assertIn("projectPort.remove(projectId)", controls)
        self.assertNotIn("localStorage", controls)
        self.assertNotIn("/__ordax/native/", controls)

    def test_project_rename_changes_catalog_label_without_renaming_folder(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        rename_block = controls.split("  const renameProject = () => {", 1)[1].split(
            "  const openProject =", 1
        )[0]
        self.assertIn("projectPort.rename(renamingProjectId, projectRenameDraft)", rename_block)
        self.assertNotIn("port.renameEntry(", rename_block)
        self.assertIn("project.path !== listing.path", rename_block)
        self.assertIn('setMessage("files.project.renamed"', rename_block)
        self.assertIn('t("files.form.projectRenameHint", { path: project.path })', controls)
        files_i18n = FILES_I18N.read_text(encoding="utf-8")
        self.assertIn(
            '"files.form.projectRenameHint": "Isso altera apenas o nome do projeto. A pasta continua em {path}."',
            files_i18n,
        )
        self.assertIn(
            '"files.form.projectRenameHint": "This changes only the project name. The folder remains at {path}."',
            files_i18n,
        )

    def test_project_rename_is_keyboard_accessible_and_navigation_invalidates_draft(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn('requestFocus("project-rename-name", project.id)', controls)
        self.assertIn('event.target.matches?.("[data-file-project-rename-name]")', controls)
        self.assertIn('event.key === "Enter"', controls)
        self.assertIn('event.key === "Escape"', controls)
        changed_path_block = controls.split("      if (changedPath) {", 1)[1].split(
            "      listing = next;", 1
        )[0]
        self.assertIn("renamingProjectId = null;", changed_path_block)
        self.assertIn('projectRenameDraft = "";', changed_path_block)
        self.assertIn("failedProjectResume = null;", changed_path_block)

    def test_successful_text_open_records_project_file_only_after_validation(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        open_block = controls.split("  const openTextFile = async", 1)[1].split(
            "  const activateSelectedPath =", 1
        )[0]
        validated = "const next = validateTextForRequest(await port.readTextFile(path), path);"
        recorded = "projectPort.recordFileOpened(project.id, next.path)"
        self.assertIn(validated, open_block)
        self.assertIn(recorded, open_block)
        self.assertLess(open_block.index(validated), open_block.index(recorded))
        self.assertIn("textPreview = next;", open_block)
        self.assertLess(open_block.index("textPreview = next;"), open_block.index(recorded))
        failure_block = open_block.split("    } catch (error) {", 1)[1]
        self.assertNotIn(recorded, failure_block)

    def test_project_file_ownership_prefers_most_specific_nested_project(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        owner_block = controls.split("  const projectForFilePath = (path) => {", 1)[1].split(
            "  const canGoBack =", 1
        )[0]
        self.assertIn('path.startsWith(`${project.path}/`)', owner_block)
        self.assertIn("project.path.length > match.path.length", owner_block)
        self.assertNotIn("listing.path", owner_block)

    def test_project_resume_is_root_scoped_and_preserves_stale_reference(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn('t("files.action.resumeProject")', controls)
        self.assertIn("resumeProjectButton.dataset.fileProjectResume = currentProject.id", controls)
        self.assertIn("resumeProjectButton.title = currentProject.lastFilePath", controls)
        click_block = controls.split(
            '    const projectResume = event.target.closest("[data-file-project-resume]");', 1
        )[1].split(
            '    const projectRenameStart = event.target.closest("[data-file-project-rename-start]");', 1
        )[0]
        self.assertIn("project?.lastFilePath && project.path === listing.path", click_block)
        self.assertIn(
            'openTextFile(project.lastFilePath, { source: "project-resume", projectId: project.id })',
            click_block,
        )
        self.assertNotIn("recordFileOpened", click_block)
        self.assertNotIn("projectPort.remove", click_block)
        self.assertNotIn("renameEntry(", click_block)
        self.assertIn('"files.preview.projectResumeMissing"', controls)
        self.assertIn('"files.preview.projectResumeFailed"', controls)

    def test_stale_project_resume_recovery_is_exact_reference_guarded_and_non_destructive(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn('t("files.action.forgetProject")', controls)
        self.assertIn(
            "failedProjectResume = Object.freeze({ projectId: project.id, path });",
            controls,
        )
        self.assertIn(
            "failedProjectResume.path === currentProject.lastFilePath",
            controls,
        )
        recovery_block = controls.split(
            "  const clearFailedProjectResume = (projectId) => {", 1
        )[1].split(
            "  const enterRecentMode =", 1
        )[0]
        guard = "project.lastFilePath !== failedProjectResume.path"
        clear = "projectPort.clearLastFile(projectId)"
        self.assertIn(guard, recovery_block)
        self.assertIn(clear, recovery_block)
        self.assertLess(recovery_block.index(guard), recovery_block.index(clear))
        self.assertIn('setMessage("files.project.lastFileChanged")', recovery_block)
        self.assertIn('setMessage("files.project.lastFileForgotten")', recovery_block)
        self.assertNotIn("port.renameEntry(", recovery_block)
        self.assertNotIn("port.moveEntry(", recovery_block)
        self.assertNotIn("port.copyFile(", recovery_block)
        self.assertNotIn("projectPort.remove(", recovery_block)

    def test_stale_project_resume_recovery_expires_when_project_snapshot_changes(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        subscription_block = controls.split(
            "  const unsubscribeProjects = projectPort?.subscribe((snapshot) => {", 1
        )[1].split(
            "  const unsubscribeRender =", 1
        )[0]
        self.assertIn("failedProjectResume", subscription_block)
        self.assertIn("project.lastFilePath !== failedProjectResume.path", subscription_block)
        self.assertIn("failedProjectResume = null;", subscription_block)
        open_block = controls.split("  const openTextFile = async", 1)[1].split(
            "  const activateSelectedPath =", 1
        )[0]
        self.assertIn("failedProjectResume = null;", open_block)
        self.assertIn('if (source === "project-resume")', open_block)
        self.assertIn("project?.lastFilePath === path && project.path === listing?.path", open_block)

    def test_native_composition_injects_project_runtime_only_into_files_owner(self):
        composition = COMPOSITION.read_text(encoding="utf-8")
        self.assertIn("createNativeProjectStore", composition)
        self.assertIn("createProjectCatalogRuntime", composition)
        self.assertIn("const projects = fileSpace === null ? null", composition)
        self.assertIn("{ recentFiles, projects }", composition)
        self.assertNotIn("createNativeProjectStore", (ROOT / "system" / "composition" / "web" / "main.mjs").read_text(encoding="utf-8"))

    def test_surface_candidate_owns_project_catalog_regressions(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertGreaterEqual(workflow.count("system/contracts/project-catalog.mjs"), 2)
        self.assertGreaterEqual(workflow.count("system/contracts/project-store.mjs"), 2)
        self.assertGreaterEqual(workflow.count("tests/test_projects.mjs"), 3)
        self.assertGreaterEqual(workflow.count("tests/test_project_files_ui_contract.py"), 2)
        self.assertIn(
            "python -m unittest tests.test_project_files_ui_contract -v",
            workflow,
        )


if __name__ == "__main__":
    unittest.main()
