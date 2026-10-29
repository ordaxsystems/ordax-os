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

    def test_device_name_receipt_regression_blocks_oobe_persistence_gate(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.copy_audited_sources(root)
            first_run_path = root / "docs/contracts/first-run.json"
            first_run = json.loads(first_run_path.read_text(encoding="utf-8"))
            first_run["device_name"]["must_not_enter_first_run_state"] = False
            first_run_path.write_text(
                json.dumps(first_run, indent=2) + "\n",
                encoding="utf-8",
            )

            status = audit.evaluate(root)

            self.assertFalse(status["source_ready"])
            self.assertIn("gate-failed:OOBE_PERSISTENCE", status["blockers"])
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
        # The real post-hardening receipt is now bound. This clears only
        # pre-authorization source gates; explicit consent and physical
        # write/boot proofs remain independent, not implied.
        self.assertTrue(status["pre_authorization_ready"])
        self.assertTrue(status["canonical_v4_release_proof_valid"])
        self.assertTrue(status["canonical_v4_release_binding_resolved"])
        self.assertEqual(status["pre_authorization_blockers"], [])
        auth = json.loads(
            (ROOT / "docs/contracts/physical-write-authorization.json").read_text(encoding="utf-8")
        )
        if auth["status"] == "authorized":
            # Consent is now recorded, but this is still source-level proof:
            # no CI result claims selection, USB writing, or UEFI boot.
            self.assertFalse(status["owner_authorization_required"])
            self.assertTrue(status["authorized_candidate_materialization_allowed"])
            self.assertTrue(status["ready"])
            self.assertTrue(status["authorization_context_matches_current_source"])
        else:
            self.assertEqual(auth["status"], "blocked-explicit-physical-authorization-pending")
            self.assertTrue(status["owner_authorization_required"])
            self.assertFalse(status["authorized_candidate_materialization_allowed"])
            self.assertFalse(status["ready"])

    def test_audited_sources_are_bound_to_owner_authorization_context(self):
        context_paths = {
            path.relative_to(ROOT).as_posix()
            for path in promotion.authorization_context_files(ROOT)
        }

        self.assertIn("tools/creator/pre_usb_nova_ordax_audit.py", context_paths)
        external_ui = {
            "system/surface/ui/first-run.mjs",
            "system/surface/ui/local-session-lock.mjs",
            "system/surface/ui/settings-overview-controls.mjs",
            "system/surface/ui/system-overview-controls.mjs",
        }
        asserted_external = set()
        for source in audit.required_source_paths(ROOT):
            relative = source.relative_to(ROOT).as_posix()
            if relative in external_ui:
                # Auditing the verified Source is mandatory; the OS must not
                # hash a duplicate or disposable copy of Surface visual files.
                self.assertNotIn(relative, context_paths)
                asserted_external.add(relative)
            else:
                self.assertIn(relative, context_paths)
        self.assertEqual(asserted_external, external_ui)
        self.assertIn("docs/contracts/surface-source.json", context_paths)
        self.assertIn(".github/actions/prepare-verified-surface/action.yml", context_paths)
        preparer = (
            ROOT / ".github/actions/prepare-verified-surface/action.yml"
        ).read_text(encoding="utf-8")
        self.assertIn("uses: ./.github/actions/assemble-surface", preparer)
        self.assertIn("Materialize one canonical external source", preparer)
        self.assertIn("diff -qr", preparer)
        self.assertIn("ORDAX_VISUAL_SOURCE_REPOSITORY=ordaxsystems/ordax-surface", preparer)


    def test_external_surface_checkout_uses_verified_pinned_git_source(self):
        """CI must not use an anonymous clone of main as release source."""
        action = (ROOT / ".github/actions/assemble-surface/action.yml").read_text(encoding="utf-8")
        self.assertIn("docs/contracts/surface-source.json", action)
        self.assertIn('data["source_repository"] == "ordaxsystems/ordax-surface"', action)
        self.assertIn("repository: ordaxsystems/ordax-surface", action)
        self.assertIn("ref: ${{ steps.surface-lock.outputs.commit }}", action)
        self.assertIn("persist-credentials: false", action)
        self.assertIn('git -C "$source_dir" rev-parse HEAD', action)
        self.assertIn('test -z "$(git -C "$source_dir" status --porcelain)"', action)
        self.assertIn("--surface-root \"$source_dir\"", action)
        self.assertIn("if: always()", action)
        self.assertNotIn("git clone --filter=blob:none", action)
        self.assertNotIn("checkout --detach", action)

if __name__ == "__main__":
    unittest.main()
