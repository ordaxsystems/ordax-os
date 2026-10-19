import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "update-nomenclature.json"
SUPERVISOR = ROOT / "system" / "supervisor"
UPDATE_STATUS = ROOT / "system" / "contracts" / "update-status.mjs"
UPDATE_HISTORY = ROOT / "system" / "contracts" / "update-history.mjs"
UPDATE_CONTROLS = ROOT / "system" / "surface" / "ui" / "update-controls.mjs"
UPDATE_PRESENTATION = ROOT / "system" / "services" / "update" / "presentation.mjs"
SYSTEM_OVERVIEW = ROOT / "system" / "surface" / "ui" / "system-overview-controls.mjs"
PRODUCT_VERSION = ROOT / "system" / "contracts" / "product-version.mjs"


class UpdateNomenclatureTests(unittest.TestCase):
    def test_contract_separates_pr_delivery_update_and_product_version(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.assertEqual(contract["status"], "canonical-prototype-contract")
        self.assertFalse(contract["development"]["pull_request"]["user_facing_update_identity"])
        self.assertTrue(contract["delivery"]["independent_from_pull_request_number"])
        self.assertFalse(contract["update"]["is_pull_request"])
        self.assertTrue(contract["product_version"]["currently_assigned"])
        self.assertEqual(contract["product_version"]["scheme"], "semantic-versioning")
        self.assertEqual(contract["product_version"]["current"], "0.1.0")
        self.assertEqual(contract["product_version"]["display"], "v0.1.0")
        self.assertEqual(contract["product_version"]["maturity"], "prototype")
        self.assertFalse(contract["product_version"]["stable_release"])
        self.assertTrue(contract["product_version"]["independent_from_delivery"])
        self.assertTrue(contract["product_version"]["v1_reserved_for_stable_product"])
        component = contract["component_version"]
        self.assertTrue(component["declared"])
        self.assertEqual(component["scheme"], "semantic-versioning")
        self.assertTrue(component["independence_is_per_component"])
        self.assertEqual(component["independent_update_release_mode"], "component-slot")
        self.assertEqual(component["bundled_release_mode"], "bundled")
        self.assertEqual(component["base_release_mode"], "base-ab")
        self.assertEqual(component["independent_components_currently_enabled"], [])
        self.assertFalse(component["invented_component_versions_allowed"])
        self.assertTrue(component["independent_update_requires_independent_packaging"])
        self.assertTrue(component["bundled_version_does_not_imply_independent_update"])
        sequence = contract["delivery"]["prototype_sequence"]
        self.assertEqual(sequence["method"], "anchored-first-parent-device-impact-count")
        self.assertEqual(sequence["epoch"]["delivery_number"], 220)
        self.assertEqual(
            sequence["epoch"]["source_commit"],
            "2361b9e74c02d97c4d907417d7e1b2836062e5e7",
        )
        self.assertFalse(sequence["proof_and_documentation_only_changes_increment_delivery"])
        self.assertFalse(sequence["proof_and_documentation_only_changes_require_boot_refresh"])
        self.assertIn("bootstrap/**/prove_*", sequence["excluded_paths"])

    def test_supervisor_delivery_sequence_does_not_parse_pull_request_numbers(self):
        text = SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("delivery_number_for_sha()", text)
        self.assertIn('DELIVERY_EPOCH_SHA=2361b9e74c02d97c4d907417d7e1b2836062e5e7', text)
        self.assertIn("DELIVERY_EPOCH_NUMBER=220", text)
        self.assertIn('rev-list --first-parent --count "$DELIVERY_EPOCH_SHA..$source_sha"', text)
        self.assertIn("system boot bootstrap", text)
        self.assertIn(":(exclude,glob)system/**/*.md", text)
        self.assertIn(":(exclude,glob)boot/**/*.md", text)
        self.assertIn(":(exclude,glob)bootstrap/**/*.md", text)
        self.assertIn(":(exclude,glob)boot/**/prove_*", text)
        self.assertIn(":(exclude,glob)bootstrap/**/prove_*", text)
        self.assertNotIn("Merge pull request #", text)
        self.assertNotIn("version_number_for_sha()", text)

    def test_contracts_expose_delivery_number_with_legacy_alias_only(self):
        status = UPDATE_STATUS.read_text(encoding="utf-8")
        history = UPDATE_HISTORY.read_text(encoding="utf-8")
        self.assertIn("value.deliveryNumber ?? value.versionNumber", status)
        self.assertIn("deliveryNumber,", status)
        self.assertIn("versionNumber: deliveryNumber", status)
        self.assertIn("value.deliveryNumber ?? value.versionNumber", history)
        self.assertIn("deliveryNumber:", history)
        self.assertIn("versionNumber:", history)

    def test_product_version_has_one_shared_runtime_identity(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        product = PRODUCT_VERSION.read_text(encoding="utf-8")
        overview = SYSTEM_OVERVIEW.read_text(encoding="utf-8")

        semantic = contract["product_version"]["current"]
        display = contract["product_version"]["display"]
        self.assertRegex(semantic, r"^0\\.1\\.[0-9]+(?:-alpha\\.[0-9]+)?$")
        self.assertEqual(display, "v" + semantic)
        self.assertIn(f'semanticVersion: "{semantic}"', product)
        self.assertIn(f'displayVersion: "{display}"', product)
        self.assertIn(f'displayName: "OrdaX Prototype {display}"', product)
        self.assertIn("stableRelease: false", product)
        self.assertIn("productVersionLabel()", overview)
        self.assertIn('t("system.overview.card.productVersion")', overview)
        self.assertIn('t("system.about.productVersion.kicker")', overview)
        self.assertIn("assertComponentManager", overview)
        self.assertIn('t("system.components.versionsTitle")', overview)
        self.assertIn('"system.components.releaseMode.bundled"', overview)
        self.assertIn('"system.components.releaseMode.componentSlot"', overview)
        self.assertIn('t("system.about.productVersion.prototype")', overview)

    def test_surface_uses_delivery_language_not_fake_component_versions(self):
        update = UPDATE_CONTROLS.read_text(encoding="utf-8")
        presentation = UPDATE_PRESENTATION.read_text(encoding="utf-8")
        overview = SYSTEM_OVERVIEW.read_text(encoding="utf-8")
        self.assertIn("export function deliveryLabel", presentation)
        self.assertIn('target: "updates"', update)
        self.assertIn('t("system.overview.card.delivery")', overview)
        self.assertIn('t("system.about.delivery.kicker")', overview)
        self.assertIn('t("system.about.delivery.description")', overview)
        self.assertIn('"system.components.releaseMode.bundled"', overview)
        self.assertIn('"system.components.releaseMode.baseAb"', overview)
        self.assertIn('"system.components.version.detail.bundled"', overview)
        self.assertNotIn("Versão global", overview)
        self.assertNotIn("Incluído nesta entrega", overview)


if __name__ == "__main__":
    unittest.main()
