#!/usr/bin/env python3
"""Regression coverage for the executable Nova OrdaX pre-USB source audit."""

import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
AUDIT_PATH = ROOT / "tools" / "creator" / "pre_usb_nova_ordax_audit.py"
PROMOTION_PATH = ROOT / "tools" / "creator" / "physical_promotion.py"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


audit = load_module("ordax_pre_usb_nova_ordax_audit_test", AUDIT_PATH)
promotion = load_module("ordax_physical_promotion_pre_usb_test", PROMOTION_PATH)


class PreUsbNovaOrdaxAuditTests(unittest.TestCase):
    def copy_audited_sources(self, destination_root: Path) -> None:
        for source in audit.required_source_paths(ROOT):
            destination = destination_root / source.relative_to(ROOT)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)

    def test_current_repository_passes_source_only_audit(self):
        status = audit.evaluate(ROOT)

        self.assertTrue(status["source_ready"], status["blockers"])
        self.assertEqual(status["status"], "pass-source")
        self.assertEqual(set(status["gates"]), set(audit.GATE_NAMES))
        self.assertTrue(all(gate["passed"] for gate in status["gates"].values()))
        self.assertTrue(status["canonical_v4_release_proof_required_separately"])
        self.assertFalse(status["physical_target_selected"])
        self.assertFalse(status["physical_write_authorized"])
        self.assertFalse(status["physical_write_performed"])

    def test_missing_canonical_source_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.copy_audited_sources(root)
            (root / "docs/contracts/local-session.json").unlink()

            status = audit.evaluate(root)

            self.assertFalse(status["source_ready"])
            self.assertIn(
                "gate-failed:LOCAL_SESSION_LOCK_POLICY",
                status["blockers"],
            )
            self.assertIn(
                "source-unavailable:docs/contracts/local-session.json",
                status["blockers"],
            )
            self.assertFalse(status["physical_write_authorized"])

    def test_public_locale_regression_blocks_audit_without_touching_physical_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.copy_audited_sources(root)
            first_run_path = root / "docs/contracts/first-run.json"
            first_run = json.loads(first_run_path.read_text(encoding="utf-8"))
            first_run["regional"]["public_mvp_locales"].append("es-ES")
            first_run_path.write_text(
                json.dumps(first_run, indent=2) + "\n",
                encoding="utf-8",
            )

            status = audit.evaluate(root)

            self.assertFalse(status["source_ready"])
            self.assertIn(
                "gate-failed:OOBE_LOCALE_COVERAGE",
                status["blockers"],
            )
            self.assertFalse(status["physical_target_selected"])
            self.assertFalse(status["physical_write_performed"])

    def test_physical_promotion_consumes_audit_as_pre_authorization_gate(self):
        status = promotion.evaluate(ROOT)

        self.assertTrue(status["pre_usb_nova_ordax_audit_passed"])
        self.assertEqual(status["pre_usb_nova_ordax_audit_status"], "pass-source")
        self.assertNotIn(
            "pre-usb-nova-ordax-audit-not-pass",
            status["pre_authorization_blockers"],
        )
        # Product/source closure and the canonical v4 proof binding are complete.
        # That makes the flow eligible to request explicit owner authorization,
        # but it still must not authorize or perform any destructive write.
        self.assertTrue(status["pre_authorization_ready"])
        self.assertTrue(status["canonical_v4_release_proof_valid"])
        self.assertTrue(status["canonical_v4_release_binding_resolved"])
        self.assertNotIn(
            "physical-authorization-requirements-invalid",
            status["pre_authorization_blockers"],
        )
        self.assertTrue(status["owner_authorization_required"])
        self.assertFalse(status["physical_write_allowed"])
        self.assertFalse(status["physical_write_performed"])

    def test_audited_sources_are_bound_to_owner_authorization_context(self):
        context_paths = {
            path.relative_to(ROOT).as_posix()
            for path in promotion.authorization_context_files(ROOT)
        }

        self.assertIn("tools/creator/pre_usb_nova_ordax_audit.py", context_paths)
        for source in audit.required_source_paths(ROOT):
            self.assertIn(source.relative_to(ROOT).as_posix(), context_paths)


if __name__ == "__main__":
    unittest.main()
