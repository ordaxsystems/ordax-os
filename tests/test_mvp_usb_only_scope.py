#!/usr/bin/env python3
"""Regress the canonical public MVP USB-only boundary."""

from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class MVPUSBOnlyScopeTests(unittest.TestCase):
    def test_stable_mvp_contract_disables_internal_disk_installation(self):
        profiles = json.loads(
            (ROOT / "docs/contracts/distribution-profiles.json").read_text(encoding="utf-8")
        )
        stable = profiles["profiles"]["stable-mvp"]
        self.assertEqual(stable["mvp_execution_mode"], "usb-only")
        self.assertFalse(stable["native_install_capability_enabled"])
        self.assertFalse(stable["internal_disk_destructive_write_allowed"])
        self.assertFalse(stable["dual_boot_available"])
        self.assertFalse(stable["automatic_partition_resize_available"])
        self.assertFalse(stable["manual_partition_editor_available"])
        self.assertTrue(stable["native_install_foundation_retained"])
        self.assertEqual(stable["native_install_activation_phase"], "post-mvp")

    def test_integrated_mvp_scope_includes_native_without_authorizing_disk_writes(self):
        scope = (ROOT / "MVP.md").read_text(encoding="utf-8")
        decisions = (ROOT / "docs" / "DECISIONS.md").read_text(encoding="utf-8")
        native = json.loads(
            (ROOT / "docs/contracts/native-installation.json").read_text(encoding="utf-8")
        )
        profiles = json.loads(
            (ROOT / "docs/contracts/distribution-profiles.json").read_text(encoding="utf-8")
        )
        stable = profiles["profiles"]["stable-mvp"]
        # Planning scope is additive; runtime activation is an independent gate.
        self.assertIn("Escopo revisado: MVP integrado, progressivo e verificável", scope)
        self.assertIn("OrdaX Native (SSD/NVMe/HD)", scope)
        self.assertIn("ADR-026 - Integrated MVP scope is distinct from per-release availability", decisions)
        self.assertEqual(stable["mvp_execution_mode"], "usb-only")
        self.assertFalse(stable["native_install_capability_enabled"])
        self.assertFalse(stable["internal_disk_destructive_write_allowed"])
        self.assertFalse(native["current_implementation"]["physical_apply_implemented"])
        self.assertFalse(native["current_implementation"]["physical_apply_authorized"])
        self.assertFalse(native["current_implementation"]["first_boot_health_connected"])
        self.assertFalse(native["mvp_availability"]["available"])
        self.assertFalse(native["mvp_availability"]["destructive_operations_allowed"])

    def test_public_site_never_presents_native_installation_as_mvp_feature(self):
        landing = (ROOT / "sites/public/index.html").read_text(encoding="utf-8")
        download = (ROOT / "sites/public/download/index.html").read_text(encoding="utf-8")
        account = (ROOT / "sites/public/conta/index.html").read_text(encoding="utf-8")
        self.assertIn("diretamente pelo pendrive", landing)
        self.assertIn("pós-MVP", landing)
        self.assertNotIn("Usar ou instalar", landing)
        self.assertNotIn("Usar ou instalar", download)
        self.assertIn("não altera o SSD/NVMe/HD interno", download)
        self.assertIn("Em breve", account)
        self.assertIn("Sem preços ou planos definidos", account)

    def test_root_and_account_routes_remain_separate(self):
        contract = json.loads(
            (ROOT / "docs/contracts/public-site.json").read_text(encoding="utf-8")
        )
        self.assertEqual(contract["routes"]["landing"], "/")
        self.assertEqual(contract["routes"]["account"], "/conta/")
        self.assertFalse(contract["product_distribution"]["authenticated_workspace_may_replace_landing"])
        self.assertFalse(contract["account_area"]["public_root_may_render_authenticated_workspace"])
        self.assertTrue(contract["account_area"]["ordax_web_is_separate_product_mode"])

    def test_monetization_is_prepared_but_not_defined(self):
        foundation = json.loads(
            (ROOT / "docs/contracts/foundation.json").read_text(encoding="utf-8")
        )
        plans = foundation["plans"]
        self.assertFalse(plans["billing_implemented"])
        self.assertFalse(plans["pricing_defined"])
        self.assertFalse(plans["commercial_tiers_defined"])
        self.assertFalse(plans["commercial_device_limit_defined"])
        self.assertFalse(plans["second_device_fee_policy_defined"])
        self.assertTrue(plans["entitlement_architecture_prepared"])


if __name__ == "__main__":
    unittest.main()
