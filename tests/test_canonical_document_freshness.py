"""Cross-check runtime source, machine-readable owners and non-physical evidence.

CURRENT-STATE is an index, not a database of frozen build/authorization flags.
"""
import json
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def source(path):
    file = ROOT / path
    if file.is_file():
        return file.read_text(encoding="utf-8")
    run = subprocess.run(
        ["git", "-C", str(ROOT), "show", "HEAD:" + path],
        capture_output=True, text=True, timeout=20,
    )
    if run.returncode:
        raise AssertionError(f"canonical source unavailable: {path}: {run.stderr}")
    return run.stdout


def contract(path):
    return json.loads(source(path))


def assignment(text, name):
    m = re.search(r"^" + re.escape(name) + r"=(\S+)$", text, re.M)
    if m is None:
        raise AssertionError(f"missing promotion gate {name}")
    return m.group(1)


class CanonicalDocumentFreshnessTests(unittest.TestCase):
    def test_current_state_is_a_code_index_without_frozen_proof_receipts(self):
        index = source("docs/CURRENT-STATE.md")
        self.assertIn("código da revisão efetivamente integrada", index)
        self.assertIn("O Pull bem-sucedido no Desktop não homologa", index)
        self.assertLess(len(index.splitlines()), 120)
        self.assertNotRegex(index, r"\b[0-9a-f]{40}\b")
        self.assertNotIn("PORTABLE_V3_UPDATE_ACTIVATION_SOURCE=", index)

    def test_product_version_uses_its_executable_contract_not_snapshot(self):
        product = source("system/contracts/product-version.mjs")
        contract_data = contract("docs/contracts/update-nomenclature.json")
        semantic = re.search(r'semanticVersion:\s*"([^"]+)"', product)
        display = re.search(r'displayVersion:\s*"([^"]+)"', product)
        self.assertIsNotNone(semantic)
        self.assertIsNotNone(display)
        self.assertEqual(contract_data["product_version"]["current"], semantic.group(1))
        self.assertEqual(contract_data["product_version"]["display"], display.group(1))
        if semantic.group(1).startswith("0."):
            self.assertFalse(contract_data["product_version"]["stable_release"])

    def test_component_release_identity_remains_independent_of_packaging(self):
        c = contract("docs/contracts/update-nomenclature.json")["component_version"]
        self.assertTrue(c["identity_independent_from_release_mode"])
        self.assertFalse(c["version_identity_requires_independent_packaging"])
        self.assertEqual(c["development_app_release_mode"], "git-app")
        self.assertEqual(c["independent_update_release_mode"], "component-slot")

    def test_first_party_apps_have_runtime_owner_not_snapshot_list(self):
        catalog = source("system/apps/catalog.mjs")
        manifests = source("system/services/components/manifests/apps.mjs")
        self.assertIn("listFirstPartyApps", catalog)
        self.assertIn("defineComponentManifest", manifests)
        for app in ("settings", "account", "store", "system"):
            self.assertRegex(manifests, r'id:\s*"' + app + r'"')
        self.assertNotIn('id: "projects"', manifests)

    def test_external_app_source_and_distribution_are_separate(self):
        doc = source("docs/INTERNET-APP.md")
        self.assertIn("ordaxsystems/ordax-apps/apps/internet", doc)
        self.assertIn("distribution_activation_allowed=false", doc)
        intelligence = source("docs/contracts/intelligence-conversation-capabilities.json")
        owner = json.loads(intelligence)["conversation_owner"]
        self.assertEqual(owner, "ordaxsystems/ordax-apps/apps/assistant/src/conversation.mjs")

    def test_seed_and_owner_dev_prepared_media_are_distinct(self):
        seed = contract("docs/contracts/physical-media.json")
        prepared = contract("docs/contracts/physical-prepared-media.json")
        self.assertEqual([p["name"] for p in seed["partitions"]], ["ORDAX-ESP", "ORDAX"])
        self.assertEqual([p["name"] for p in prepared["partitions"]],
                         ["ORDAX-ESP", "ORDAX", "ORDAX-DATA"])
        self.assertFalse(seed["physical_write_allowed"])
        self.assertTrue(prepared["migration"]["current_three_partition_writer_must_not_be_public_mvp_default"])
        self.assertIn("PrepareOwnerDevelopmentStorageImage",
                      source("creator/core/storage_image.go"))

    def test_portable_candidate_is_not_public_physical_release(self):
        c = contract("docs/contracts/portable-bootstrap-v2.json")
        self.assertTrue(c["migration"]["portable_v2_pid1_integration_implemented"])
        self.assertFalse(c["migration"]["portable_v2_writer_migration_implemented"])
        self.assertFalse(c["migration"]["public_physical_promotion_allowed"])
        self.assertTrue(c["migration"]["transitional_three_partition_writer_unchanged"])

    def test_v3_evidence_does_not_become_hardware_proof(self):
        first = contract("docs/evidence/portable-runtime-v3-main-proof.json")
        second = contract("docs/evidence/portable-v3-one-shot-qemu-proof.json")
        for evidence in (first, second):
            self.assertEqual(evidence["status"], "pass")
            self.assertTrue(evidence["not_proven"]["physical_usb_boot"])
            self.assertTrue(evidence["not_proven"]["cold_health_commit"])
        self.assertTrue(first["proven"]["ovmf_systemd_boot_current_slot_boot"])
        self.assertTrue(second["proven"]["candidate_boot_selected_once"])

    def test_trust_and_writer_require_explicit_authority(self):
        trust = contract("docs/contracts/release-trust-policy.json")
        auth = contract("docs/contracts/physical-write-authorization.json")
        self.assertTrue(trust["gates"]["public_anchor_pinned"])
        self.assertTrue(auth["requirements"]["writer_requires_exact_17_artifact_readback"])
        self.assertTrue(auth["requirements"]["windows_uac_required"])
        self.assertTrue(auth["requirements"]["post_write_readback_required"])
        if auth["status"] != "authorized":
            self.assertFalse(auth["physical_write_allowed"])
            self.assertFalse(auth["explicit_owner_authorization"])
        else:
            self.assertTrue(auth["physical_write_allowed"])
            self.assertTrue(auth["explicit_owner_authorization"])

    def test_stable_physical_smoke_is_not_inferred_from_ci(self):
        promotion = source("docs/PROMOTION-GATES.md")
        self.assertEqual(assignment(promotion, "MVP_SURFACE_SMOKE_PHYSICAL"), "PENDING")
        self.assertEqual(assignment(promotion, "CANONICAL_STABLE_GRAPHICAL_MODE"), "PENDING")
        self.assertEqual(assignment(promotion, "PUBLIC_PHYSICAL_APPLY"), "NO")

    def test_obsolete_runtime_builders_cannot_return_as_instructions(self):
        index = source("docs/CURRENT-STATE.md")
        self.assertIn("Não restaurar bootstrap/dev-base/build.py", index)
        for path in ("bootstrap/dev-base/build.py", "bootstrap/stable-base/build.py"):
            self.assertIn(path, index)
            self.assertNotIn("build.py build", index)
        for retired in ("bootstrap/dev-base/build.py", "bootstrap/stable-base/build.py"):
            result = subprocess.run(
                ["git", "-C", str(ROOT), "cat-file", "-e", "HEAD:" + retired],
                capture_output=True, timeout=15,
            )
            self.assertNotEqual(result.returncode, 0, retired + " must stay retired")


if __name__ == "__main__":
    unittest.main()
