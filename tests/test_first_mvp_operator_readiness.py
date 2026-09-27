from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "ops" / "first_mvp_operator_readiness.py"
AUTHORIZATION_PATH = ROOT / "docs" / "contracts" / "physical-write-authorization.json"


def _load():
    spec = importlib.util.spec_from_file_location("first_mvp_operator_readiness", MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load first MVP operator readiness module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


readiness = _load()


class FirstMvpOperatorReadinessTests(unittest.TestCase):
    def test_current_source_separates_first_usb_from_official_creator_publication(self):
        status = readiness.evaluate(ROOT)
        authorization = json.loads(AUTHORIZATION_PATH.read_text(encoding="utf-8"))

        pending = (
            authorization["status"] == "blocked-explicit-physical-authorization-pending"
            and authorization["physical_write_allowed"] is False
            and authorization["explicit_owner_authorization"] is False
            and authorization["authorization_context_sha256"] is None
        )
        authorized = (
            authorization["status"] == "authorized"
            and authorization["physical_write_allowed"] is True
            and authorization["explicit_owner_authorization"] is True
            and isinstance(authorization["authorization_context_sha256"], str)
            and len(authorization["authorization_context_sha256"]) == 64
        )
        self.assertNotEqual(pending, authorized)

        self.assertEqual(status["$schema"], "prototype-ordax.first-mvp-operator-readiness/1")

        first_usb = status["first_usb"]
        self.assertIs(first_usb["creator_physical_public_release_required"], True)
        self.assertIs(first_usb["offline_canonical_ed25519_signing_required"], True)
        self.assertIs(first_usb["physical_target_selected"], False)
        self.assertIs(first_usb["physical_write_performed"], False)

        if pending:
            self.assertEqual(status["status"], "blocked")
            self.assertIs(first_usb["source_authorized"], False)
            self.assertIs(first_usb["publisher_source_ready"], False)
            self.assertEqual(first_usb["next_stage"], "resolve-first-usb-source-blockers")
            self.assertIn(
                "explicit-physical-write-authorization-missing",
                first_usb["blockers"],
            )
        else:
            self.assertEqual(status["status"], "ready-for-operator-handoff")
            self.assertIs(first_usb["source_authorized"], True)
            self.assertIs(first_usb["publisher_source_ready"], True)
            self.assertEqual(first_usb["next_stage"], "offline-sign-and-publish-creator-physical")
            self.assertEqual(first_usb["blockers"], [])

        official = status["official_creator"]
        self.assertIs(official["source_ready"], True)
        self.assertIs(official["publication_ready"], False)
        self.assertIs(official["authenticode_required"], True)
        self.assertIs(official["authenticode_configured"], False)
        self.assertIs(official["may_block_first_usb_proof"], False)
        self.assertIn("creator-authenticode-identity-unconfigured", official["blockers"])
        self.assertIn("creator-publisher-subject-unconfigured", official["blockers"])
        self.assertIn("creator-publisher-certificate-pin-unconfigured", official["blockers"])
        self.assertIn("creator-code-signing-custody-provider-unconfigured", official["blockers"])
        self.assertIn("creator-official-publication-not-authorized", official["blockers"])

        native = status["native_installation"]
        self.assertIs(native["foundation_present_policy"], True)
        self.assertIs(native["mvp_visible"], False)
        self.assertIs(native["mvp_enabled"], False)
        self.assertIs(native["internal_disk_destructive_apply_enabled"], False)

        for value in status["boundaries"].values():
            self.assertIs(value, False)

    def test_unconfigured_authenticode_contract_fails_closed(self):
        contract = {
            "$schema": "prototype-ordax.creator-code-signing/2",
            "status": "unconfigured",
            "publisher_identity": {
                "expected_subject": None,
                "allowed_leaf_certificate_sha256": [],
            },
            "custody": {"provider": "unconfigured"},
            "release_policy": {"publish_allowed": False},
        }
        ready, blockers = readiness._official_creator_signing_ready(contract)
        self.assertIs(ready, False)
        self.assertIn("creator-authenticode-identity-unconfigured", blockers)
        self.assertIn("creator-publisher-subject-unconfigured", blockers)
        self.assertIn("creator-publisher-certificate-pin-unconfigured", blockers)
        self.assertIn("creator-code-signing-custody-provider-unconfigured", blockers)
        self.assertIn("creator-official-publication-not-authorized", blockers)

    def test_configured_authenticode_contract_can_be_ready(self):
        contract = {
            "$schema": "prototype-ordax.creator-code-signing/2",
            "status": "configured",
            "publisher_identity": {
                "expected_subject": "CN=OrdaX Publisher",
                "allowed_leaf_certificate_sha256": ["a" * 64],
            },
            "custody": {"provider": "managed-signing-provider"},
            "release_policy": {"publish_allowed": True},
        }
        ready, blockers = readiness._official_creator_signing_ready(contract)
        self.assertIs(ready, True)
        self.assertEqual(blockers, [])


if __name__ == "__main__":
    unittest.main()
