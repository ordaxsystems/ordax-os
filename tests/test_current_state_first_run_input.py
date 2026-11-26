#!/usr/bin/env python3
"""First-run, keyboard and physical authority are tested from their owners."""
import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def source(path):
    file = ROOT / path
    if file.is_file():
        return file.read_text(encoding="utf-8")
    p = subprocess.run(["git", "-C", str(ROOT), "show", "HEAD:" + path],
                       text=True, capture_output=True, timeout=20)
    if p.returncode:
        raise AssertionError(f"missing canonical source: {path}: {p.stderr}")
    return p.stdout


def contract(path):
    return json.loads(source("docs/contracts/" + path + ".json"))


class CurrentStateFirstRunInputTests(unittest.TestCase):
    def test_first_run_contract_never_requires_cloud_to_complete(self):
        first = contract("first-run")
        self.assertEqual(first["$schema"], "prototype-ordax.first-run/1")
        self.assertTrue(first["persistence"]["persistent_usb_state"])
        self.assertTrue(first["account"]["optional"])
        self.assertTrue(first["account"]["local_only_always_available"])
        self.assertFalse(first["account"]["cloud_sync_required_for_mvp"])
        self.assertTrue(first["network"]["skippable"])
        self.assertFalse(first["mvp"]["web_mode_uses_this_device_oobe"])
        self.assertEqual(first["regional"]["completeness_scope"], "first-run-oobe-only")
        self.assertEqual(first["regional"]["default_locale"], "pt-BR")
        self.assertEqual(first["regional"]["default_time_zone"], "America/Bahia")

    def test_keyboard_is_native_and_cannot_claim_live_reconfiguration(self):
        kb = contract("keyboard-layout")
        self.assertEqual(kb["$schema"], "prototype-ordax.keyboard-layout/1")
        self.assertEqual(kb["default_layout_id"], "br-abnt2")
        self.assertEqual(set(kb["supported_layouts"]), {"br-abnt2", "us"})
        self.assertFalse(kb["application"]["live_reconfigure_supported"])
        self.assertFalse(kb["first_run"]["selector_exposed"])
        self.assertTrue(kb["first_run"]["status_read_only_exposed"])

    def test_early_boot_does_not_claim_graphical_splash(self):
        branding = contract("branding")
        self.assertFalse(branding["early_boot"]["graphical_splash_implemented"])
        self.assertEqual(branding["early_boot"]["current_mode"], "console-text")
        self.assertTrue(branding["first_run"]["implemented"])

    def test_public_trust_is_pinned_in_policy_not_document_snapshot(self):
        trust = contract("release-trust-policy")
        self.assertTrue(trust["gates"]["key_material_generated"])
        self.assertTrue(trust["gates"]["public_anchor_pinned"])
        self.assertTrue(trust["gates"]["minimal_bootstrap_resolved"])
        self.assertTrue(trust["gates"]["physical_authorization_eligible"])
        self.assertNotIn("RELEASE_TRUST=UNRESOLVED", source("docs/CURRENT-STATE.md"))

    def test_physical_authorization_is_exactly_one_fail_closed_state(self):
        auth = contract("physical-write-authorization")
        consent = auth["status"] == "blocked-explicit-physical-authorization-pending"
        proof_pending = auth["status"] == "blocked-canonical-v4-release-proof-pending"
        authorized = auth["status"] == "authorized"
        self.assertEqual(sum((consent, proof_pending, authorized)), 1)
        self.assertEqual(auth["scope"], "first-real-stable-mvp-usb-proof")
        self.assertEqual(auth["release_sequence"], 1)
        self.assertTrue(auth["requirements"]["writer_requires_exact_17_artifact_readback"])
        self.assertTrue(auth["requirements"]["windows_uac_required"])
        self.assertTrue(auth["requirements"]["post_write_readback_required"])
        self.assertEqual(len(auth["release_binding"]["source_commit"]), 40)
        if authorized:
            self.assertTrue(auth["physical_write_allowed"])
            self.assertTrue(auth["explicit_owner_authorization"])
            self.assertEqual(len(auth["authorization_context_sha256"]), 64)
        else:
            self.assertFalse(auth["physical_write_allowed"])
            self.assertFalse(auth["explicit_owner_authorization"])
            self.assertIsNone(auth["authorization_context_sha256"])
        if consent:
            self.assertTrue(auth["requirements"]["canonical_v4_release_proof_bound"])
        if proof_pending:
            self.assertFalse(auth["requirements"]["canonical_v4_release_proof_bound"])
        self.assertIn("não significa USB instalado", source("docs/CURRENT-STATE.md"))


if __name__ == "__main__":
    unittest.main()
