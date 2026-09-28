#!/usr/bin/env python3
"""Keep CURRENT-STATE aligned with first-run, keyboard and trust contracts."""

from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CURRENT = ROOT / "docs" / "CURRENT-STATE.md"
FIRST_RUN = ROOT / "docs" / "contracts" / "first-run.json"
KEYBOARD = ROOT / "docs" / "contracts" / "keyboard-layout.json"
BRANDING = ROOT / "docs" / "contracts" / "branding.json"
TRUST_POLICY = ROOT / "docs" / "contracts" / "release-trust-policy.json"
AUTHORIZATION = ROOT / "docs" / "contracts" / "physical-write-authorization.json"


class CurrentStateFirstRunInputTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.current = CURRENT.read_text(encoding="utf-8")
        cls.first_run = json.loads(FIRST_RUN.read_text(encoding="utf-8"))
        cls.keyboard = json.loads(KEYBOARD.read_text(encoding="utf-8"))
        cls.branding = json.loads(BRANDING.read_text(encoding="utf-8"))
        cls.trust = json.loads(TRUST_POLICY.read_text(encoding="utf-8"))
        cls.authorization = json.loads(AUTHORIZATION.read_text(encoding="utf-8"))

    def test_first_run_snapshot_tracks_contract_without_cloud_overclaim(self):
        self.assertEqual(self.first_run["$schema"], "prototype-ordax.first-run/1")
        self.assertTrue(self.first_run["persistence"]["persistent_usb_state"])
        self.assertTrue(self.first_run["account"]["optional"])
        self.assertTrue(self.first_run["account"]["local_only_always_available"])
        self.assertFalse(self.first_run["account"]["cloud_sync_required_for_mvp"])
        self.assertTrue(self.first_run["network"]["skippable"])
        self.assertFalse(self.first_run["mvp"]["web_mode_uses_this_device_oobe"])

        self.assertIn("FIRST_RUN_OOBE=PASS_SOURCE_NATIVE_USB", self.current)
        self.assertIn("FIRST_RUN_PERSISTENT=YES", self.current)
        self.assertIn("FIRST_RUN_ACCOUNT_OPTIONAL=YES", self.current)
        self.assertIn("FIRST_RUN_LOCAL_ONLY_ALWAYS_AVAILABLE=YES", self.current)
        self.assertIn("FIRST_RUN_NETWORK_SKIPPABLE=YES", self.current)
        self.assertIn(
            f'FIRST_RUN_SOURCE_LOCALE={self.first_run["regional"]["default_locale"]}',
            self.current,
        )
        self.assertIn(
            "FIRST_RUN_OOBE_COMPLETE_LOCALES="
            + ",".join(self.first_run["regional"]["complete_locales"]),
            self.current,
        )
        self.assertEqual(
            self.first_run["regional"]["completeness_scope"],
            "first-run-oobe-only",
        )
        self.assertIn(
            f'FIRST_RUN_DEFAULT_TIME_ZONE={self.first_run["regional"]["default_time_zone"]}',
            self.current,
        )
        self.assertIn("FIRST_RUN_WEB_DEVICE_OOBE=NO", self.current)

    def test_keyboard_snapshot_tracks_native_contract_and_keeps_physical_proof_pending(self):
        self.assertEqual(
            self.keyboard["$schema"],
            "prototype-ordax.keyboard-layout/1",
        )
        self.assertEqual(self.keyboard["default_layout_id"], "br-abnt2")
        self.assertEqual(set(self.keyboard["supported_layouts"]), {"br-abnt2", "us"})
        self.assertFalse(self.keyboard["application"]["live_reconfigure_supported"])
        self.assertFalse(self.keyboard["first_run"]["selector_exposed"])

        self.assertIn("KEYBOARD_LAYOUT_NATIVE=PASS_SOURCE", self.current)
        self.assertIn(
            f'KEYBOARD_LAYOUT_DEFAULT={self.keyboard["default_layout_id"]}',
            self.current,
        )
        self.assertIn("KEYBOARD_LAYOUT_ALTERNATIVE=us", self.current)
        self.assertIn("KEYBOARD_LAYOUT_WEB_CAPABILITY=NO", self.current)
        self.assertIn("KEYBOARD_LAYOUT_LIVE_RECONFIGURE=NO", self.current)
        self.assertIn(
            "KEYBOARD_LAYOUT_FIRST_RUN_SELECTOR=NO_GATED_ON_SAFE_APPLY",
            self.current,
        )
        self.assertIn(
            "KEYBOARD_LAYOUT_PHYSICAL_STABLE_MVP_PROOF=PENDING",
            self.current,
        )

    def test_early_boot_snapshot_does_not_claim_graphical_splash(self):
        self.assertFalse(
            self.branding["early_boot"]["graphical_splash_implemented"]
        )
        self.assertEqual(self.branding["early_boot"]["current_mode"], "console-text")
        self.assertIn("EARLY_BOOT_GRAPHICAL_SPLASH=NO_CONSOLE_TEXT", self.current)

    def test_resolved_public_trust_cannot_regress_to_unresolved(self):
        gates = self.trust["gates"]
        self.assertTrue(gates["key_material_generated"])
        self.assertTrue(gates["public_anchor_pinned"])
        self.assertTrue(gates["minimal_bootstrap_resolved"])
        self.assertTrue(gates["physical_authorization_eligible"])

        self.assertIn(
            "RELEASE_TRUST=PASS_CANONICAL_PUBLIC_ANCHOR_PINNED",
            self.current,
        )
        self.assertNotIn("RELEASE_TRUST=UNRESOLVED", self.current)
        self.assertNotIn(
            "complete the canonical Ed25519 release-trust ceremony",
            self.current,
        )
        self.assertNotIn("public anchor is still not pinned", self.current)

    def test_physical_authorization_contract_and_physical_proof_boundary_are_coherent(self):
        proof_pending = (
            self.authorization["status"]
            == "blocked-canonical-v4-release-proof-pending"
            and self.authorization["physical_write_allowed"] is False
            and self.authorization["explicit_owner_authorization"] is False
            and self.authorization["authorization_context_sha256"] is None
            and self.authorization["requirements"]["canonical_v4_release_proof_bound"] is False
        )
        consent_pending = (
            self.authorization["status"]
            == "blocked-explicit-physical-authorization-pending"
            and self.authorization["physical_write_allowed"] is False
            and self.authorization["explicit_owner_authorization"] is False
            and self.authorization["authorization_context_sha256"] is None
            and self.authorization["requirements"]["canonical_v4_release_proof_bound"] is True
        )
        authorized = (
            self.authorization["status"] == "authorized"
            and self.authorization["physical_write_allowed"] is True
            and self.authorization["explicit_owner_authorization"] is True
            and isinstance(self.authorization["authorization_context_sha256"], str)
            and len(self.authorization["authorization_context_sha256"]) == 64
            and self.authorization["requirements"]["canonical_v4_release_proof_bound"] is True
        )
        self.assertEqual(
            sum((proof_pending, consent_pending, authorized)),
            1,
            "authorization contract must be exactly proof-pending, consent-pending, or authorized",
        )
        self.assertEqual(
            self.authorization["scope"],
            "first-real-stable-mvp-usb-proof",
        )
        self.assertEqual(self.authorization["release_sequence"], 1)
        self.assertTrue(
            self.authorization["requirements"][
                "writer_requires_exact_17_artifact_readback"
            ]
        )
        self.assertEqual(
            self.authorization["release_binding"]["source_commit"],
            "b924ff8d74d1761232381ae3f9604bba17497cfd",
        )
        self.assertIn(
            "CANONICAL_V4_RELEASE_PROOF=PASS_SIGNED_MATERIALIZED_EXACT",
            self.current,
        )
        if consent_pending:
            self.assertIn("CANONICAL_V4_RELEASE_PROOF_BINDING=PASS", self.current)
            self.assertIn("PHYSICAL_AUTHORIZATION_ELIGIBLE=YES", self.current)
            self.assertIn(
                "PHYSICAL_OWNER_AUTHORIZATION_REACHABLE=YES_FRESH_CONSENT_REQUIRED",
                self.current,
            )
            self.assertIn(
                "PHYSICAL_WRITE_ALLOWED=NO_EXPLICIT_OWNER_AUTHORIZATION",
                self.current,
            )
        if proof_pending:
            self.assertFalse(
                self.authorization["requirements"]["canonical_v4_release_proof_bound"]
            )
        self.assertIn("PHYSICAL_TARGET_SELECTED=NO", self.current)
        self.assertIn(
            "PHYSICAL_TARGET_DESTRUCTIVE_CONFIRMATION=PENDING",
            self.current,
        )
        self.assertIn(
            "CANONICAL_SIGNED_RELEASE_BOOT_PROVEN=NO_PHYSICAL_STABLE_MVP_PENDING",
            self.current,
        )
        self.assertIn("MVP_SURFACE_SMOKE_HARNESS=PASS_SOURCE", self.current)
        self.assertIn("MVP_SURFACE_SMOKE_PHYSICAL=PENDING", self.current)
        self.assertIn("CANONICAL_STABLE_GRAPHICAL_MODE=PENDING", self.current)
        self.assertIn("PUBLIC_PHYSICAL_APPLY=NO", self.current)
        self.assertIn("all 12 manual tour items", self.current)
        self.assertIn("verified Stable runtime", self.current)


if __name__ == "__main__":
    unittest.main()
