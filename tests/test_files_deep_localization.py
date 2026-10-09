from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTROLS = ROOT / "system/surface/ui/file-space-controls.mjs"
CATALOG = ROOT / "system/services/i18n/catalog/files.mjs"


class FilesDeepLocalizationTests(unittest.TestCase):
    def test_forms_transfer_and_preview_use_shared_localization(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        for marker in (
            't("files.form.cancel")',
            't("files.form.saveName")',
            '"files.transfer.chooseDestination"',
            '"files.transfer.copyOtherFolder"',
            '"files.transfer.moveOtherFolder"',
            '"files.transfer.cannotMoveIntoSelf"',
            '"files.transfer.confirmCopy"',
            '"files.transfer.confirmMove"',
            't("files.preview.opening")',
            't("files.preview.readOnly"',
            't("files.preview.close")',
        ):
            self.assertIn(marker, controls)
        for hardcoded in (
            '"Cancelar"',
            '"Salvar nome"',
            '"Escolha uma pasta de destino."',
            '"Copiar para esta pasta"',
            '"Mover para esta pasta"',
            '"Abrindo arquivo…"',
        ):
            self.assertNotIn(hardcoded, controls)

    def test_transfer_destination_state_is_semantic(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        block = controls.split("const transferDestinationState = () => {", 1)[1].split(
            "\n  const renderTransferOperation = (container) => {", 1
        )[0]
        self.assertIn("reasonMessageId", block)
        self.assertNotIn("reason:", block)
        self.assertIn('"files.transfer.copyOtherFolder"', block)
        self.assertIn('"files.transfer.cannotMoveIntoSelf"', block)

    def test_files_message_state_supports_semantic_incremental_migration(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        for marker in (
            "let messageId = null;",
            "let messageParams = Object.freeze({});",
            "const clearMessage =",
            "const setMessage =",
            "const renderedMessage =",
            'setMessage("files.project.added")',
            'setMessage("files.project.renameFailed")',
            'setMessage("files.project.folderUnavailable")',
            "setMessage(destination.reasonMessageId)",
            'setMessage("files.trash.openFailed")',
            'setMessage("files.import.imported"',
            'setMessage("files.trash.moved"',
            'setMessage("files.export.started"',
            'setMessage("files.copy.created"',
            'setMessage("files.rename.renamed"',
            'setMessage("files.directory.created"',
        ):
            self.assertIn(marker, controls)

    def test_catalog_has_pt_br_and_en_us_for_migrated_deep_files_copy(self):
        catalog = CATALOG.read_text(encoding="utf-8")
        pairs = (
            ('"files.transfer.chooseDestination": "Escolha uma pasta de destino."', '"files.transfer.chooseDestination": "Choose a destination folder."'),
            ('"files.transfer.confirmCopy": "Copiar para esta pasta"', '"files.transfer.confirmCopy": "Copy to this folder"'),
            ('"files.preview.close": "Fechar"', '"files.preview.close": "Close"'),
            ('"files.project.added": "Projeto adicionado.', '"files.project.added": "Project added.'),
            ('"files.project.lastFileForgetFailed": "Não foi possível esquecer a referência do último arquivo."', '"files.project.lastFileForgetFailed": "The last-file reference could not be forgotten."'),
            ('"files.trash.moved": "“{name}” foi movido para a Lixeira e pode ser restaurado."', '"files.trash.moved": "“{name}” was moved to Trash and can be restored."'),
            ('"files.import.failed": "Não foi possível importar este arquivo. Nenhum arquivo parcial foi mantido."', '"files.import.failed": "This file could not be imported. No partial file was kept."'),
            ('"files.copy.suffix": "cópia"', '"files.copy.suffix": "copy"'),
            ('"files.notes.action.create": "Criar nota"', '"files.notes.action.create": "Create note"'),
        )
        for source, english in pairs:
            self.assertIn(source, catalog)
            self.assertIn(english, catalog)


if __name__ == "__main__":
    unittest.main()
