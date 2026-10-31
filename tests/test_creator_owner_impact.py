"""Owner USB causal classification: no boot/provenance bypass on unknown deltas."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from tools.ci import creator_owner_impact as impact

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/creator-owner-dev-git.yml"
VISUAL = {
    "$schema": "prototype-ordax.surface-source/1", "status": "canonical",
    "source_repository": "ordaxsystems/ordax-surface", "source_commit": "a" * 40,
    "visual_source_paths": ["system/surface/ui", "system/surface/workspace"],
    "os_host_paths": ["system/surface/entrypoint"],
}

class CreatorOwnerImpactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for cmd in (["init", "-q"], ["config", "user.email", "ci@example.invalid"],
                    ["config", "user.name", "CI"]):
            subprocess.run(["git", "-C", str(self.root), *cmd], check=True, capture_output=True)

    def commit(self, workflow=None, lock=None, path=None,
               intelligence_workflow=None, delete_path=None):
        if workflow is not None:
            f = self.root / impact.WORKFLOW
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(workflow, encoding="utf-8")
        if intelligence_workflow is not None:
            f = self.root / impact.INTELLIGENCE_WORKFLOW
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(intelligence_workflow, encoding="utf-8")
        if delete_path is not None:
            f = self.root / delete_path
            if not f.is_file():
                raise AssertionError("delete fixture path must exist")
            f.unlink()
        if lock is not None:
            f = self.root / impact.SURFACE_LOCK
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps(lock) + "\n", encoding="utf-8")
        if path is not None:
            f = self.root / path
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text("changed\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(self.root), "add", "-A"], check=True)
        subprocess.run(["git", "-C", str(self.root), "commit", "-qm", "test"], check=True)
        return subprocess.check_output(["git", "-C", str(self.root), "rev-parse", "HEAD"], text=True).strip()

    def test_real_current_workflow_keeps_full_usb_on_push_or_unknown_changes(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("needs: impact", text)
        self.assertIn("if: needs.impact.outputs.required == 'true'", text)
        self.assertIn("CREATOR_OWNER_USB_REQUIRED=", (ROOT / "tools/ci/creator_owner_impact.py").read_text())
        self.assertIn("github.event_name", text)
        self.assertIn("gh release upload creator-owner-prototype", text)
        self.assertEqual(text.count("build-and-publish:"), 1)

    def test_canonical_visual_and_ci_only_changes_skip_real_usb(self):
        base_source = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn(impact.EXPECTED_IMPACT_JOB, base_source)
        # Simulate the exact previous Creator workflow: remove the added gate
        # and reinstate only the three preexisting presentation triggers.
        before_source = base_source.replace(impact.EXPECTED_IMPACT_JOB, "\n")
        before_source = before_source.replace(
            "\n  build-and-publish:\n    needs: impact\n    if: needs.impact.outputs.required == 'true'\n",
            "\n  build-and-publish:\n",
        )
        old_pr = before_source.index("  pull_request:\n")
        pre, post = before_source[:old_pr], before_source[old_pr:]
        for selector in impact.PR_ADDED:
            post = post.replace(f"      - '{selector}'\n", "")
        for selector in impact.PR_REMOVED:
            post = post.replace("  pull_request:\n    paths:\n", f"  pull_request:\n    paths:\n      - '{selector}'\n", 1)
        before_source = pre + post
        for selector in impact.PUSH_EXCLUDES:
            before_source = before_source.replace(f"      - '{selector}'\n", "")
        base = self.commit(before_source, VISUAL)
        after = self.commit(base_source, {**VISUAL, "source_commit": "b" * 40},
                            "system/adapters/desktop/local-ai-host.mjs")
        self.assertTrue(impact.workflow_trigger_only(base, after, root=self.root))
        self.assertEqual(impact.classify(base, after, root=self.root), (False, "nonproducer-contract-only"))

    def test_push_and_pr_use_same_fail_closed_diff_manual_dispatch_forces_build(self):
        w = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn('case "$ORDAX_EVENT_NAME" in', w)
        self.assertIn("pull_request|push)", w)
        self.assertIn("workflow_dispatch)", w)
        self.assertEqual(w.count('git fetch --no-tags --depth=1 origin "$ORDAX_BASE_SHA"'), 1)
        normal = 'python3 tools/ci/creator_owner_impact.py classify --base "$ORDAX_BASE_SHA" --head "$ORDAX_HEAD_SHA"'
        self.assertEqual(w.count(normal + "\n"), 1)
        self.assertEqual(w.count(normal + " --force"), 1)
        self.assertIn("Unsupported Owner USB event: fail closed", w)
        self.assertIn("if: needs.impact.outputs.required == 'true'", w)
        self.assertIn("case \"$ORDAX_EVENT_NAME\" in", impact.EXPECTED_IMPACT_JOB)

    def test_causal_main_push_decisions_match_real_git_deltas(self):
        base = self.commit(WORKFLOW.read_text(encoding="utf-8"), VISUAL)
        light = self.commit(path="tools/ci/creator_owner_impact.py")
        self.assertEqual(impact.classify(base, light, root=self.root),
                         (False, "nonproducer-contract-only"))
        boot = self.commit(path="bootstrap/initramfs/build.py")
        self.assertTrue(impact.classify(light, boot, root=self.root)[0])
        self.assertTrue(impact.classify("0" * 40, boot, root=self.root)[0])

    def test_boot_and_unknown_owner_changes_require_real_usb(self):
        base = self.commit(WORKFLOW.read_text(encoding="utf-8"), VISUAL)
        for path in ("bootstrap/initramfs/build.py", "bootstrap/surface-runtime/build.py",
                     "system/supervisor", "tools/creator/assemble.py",
                     "docs/contracts/unknown-owner.json"):
            with self.subTest(path=path):
                current = self.commit(path=path)
                self.assertTrue(impact.classify(base, current, root=self.root)[0])

    def test_signed_windows_broker_only_changes_do_not_start_usb_producer(self):
        base = self.commit(WORKFLOW.read_text(encoding="utf-8"), VISUAL)
        desktop_only = (
            ".github/workflows/windows-desktop-dev.yml",
            "system/adapters/desktop/verified-component-slot-host.mjs",
            "system/adapters/native/signed-current-compatibility.mjs",
            "tests/test_native_signed_current_compatibility.mjs",
            "tests/test_native_verified_installed_apps.mjs",
            "tools/windows-emulator/desktop-verified-component-slot.test.mjs",
            "tools/surface-web/browser-smoke.mjs",
        )
        for path in desktop_only:
            current = self.commit(path=path)
        self.assertEqual(impact.classify(base, current, root=self.root),
                         (False, "nonproducer-contract-only"))
        # The Linux/Windows shared Native mount owner is still part of the
        # bootable USB payload, despite accompanying Windows-only changes.
        shared = self.commit(path="system/composition/native/verified-installed-apps.mjs")
        self.assertEqual(impact.classify(base, shared, root=self.root),
                         (True, "real-or-unknown-usb-producer:system/composition/native/verified-installed-apps.mjs"))
        # Fail closed if a Windows path change accompanies a real OS producer.
        boot = self.commit(path="bootstrap/surface-runtime/build.py")
        self.assertTrue(impact.classify(base, boot, root=self.root)[0])

    def test_new_workflow_producer_step_forces_usb(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        base = self.commit(workflow, VISUAL)
        changed = workflow.replace("timeout-minutes: 120", "timeout-minutes: 125")
        self.assertNotEqual(workflow, changed)
        current = self.commit(changed)
        self.assertTrue(impact.classify(base, current, root=self.root)[0])

    def test_malformed_revisions_and_nonvisual_pin_fail_closed(self):
        base = self.commit(WORKFLOW.read_text(encoding="utf-8"), VISUAL)
        current = self.commit(lock={**VISUAL, "source_commit": "b" * 40,
                                    "os_host_paths": ["system/entrypoint"]})
        self.assertTrue(impact.classify(base, current, root=self.root)[0])
        self.assertTrue(impact.classify("not-a-sha", current, root=self.root)[0])

    def test_desktop_and_web_client_owners_do_not_depend_on_usb_creator(self):
        base = self.commit(WORKFLOW.read_text(encoding="utf-8"), VISUAL)
        for path in (
            "system/adapters/desktop/space-create.mjs",
            "system/adapters/desktop/display-current-mode-host.mjs",
            "system/composition/web/account-session.mjs",
            "tools/windows-desktop/native-build.cjs",
            "tools/windows-emulator/account-gateway.mjs",
            "system/contracts/space-create-port.mjs",
            "tests/test_space_create_bridge.mjs",
            "docs/contracts/build-autonomy.json",
            "docs/BUILD-AUTONOMY.md",
            "docs/CURRENT-STATE.md",
            "docs/DECISIONS.md",
            "docs/README.md",
            "docs/SPACES-AND-PROFILES.md",
            "README.md",
            "00-PLANOS-PRIORITARIOS/REGISTRY.md",
            "PLANO-00-ESTADO-ATUAL-E-PRIORIDADES.md",
            "PLANO-04-FUNDACAO-ECOSSISTEMA-PRE-MVP.md",
            "00-PLANOS-PRIORITARIOS/ROADMAP.md",
            "00-PLANOS-PRIORITARIOS/plans/MODE-001-WEB-CLOUD-DEVICE-RUNTIME.md",
            "00-PLANOS-PRIORITARIOS/plans/FOOD-001-ORDAX-FOOD-PIZZA-PILOT.md",
            "00-PLANOS-PRIORITARIOS/plans/FAB-001-ORDAX-FABRICATION-3D-PRINTING-PILOT.md",
        ):
            with self.subTest(path=path):
                next_rev = self.commit(path=path)
                self.assertEqual(impact.classify(base, next_rev, root=self.root),
                                 (False, "nonproducer-contract-only"))
        for shared in (
            "system/composition/native/main.mjs",
            "system/adapters/native/space-selection.mjs",
            "system/adapters/web/spaces.mjs",
            "system/contracts/space-creation.mjs",
            "system/supervisor",
            "bootstrap/initramfs/build.py",
            "docs/contracts/unknown-new-owner.json",
        ):
            with self.subTest(shared=shared):
                next_rev = self.commit(path=shared)
                self.assertTrue(impact.classify(base, next_rev, root=self.root)[0])

    def test_archived_profile_plan_deletion_and_exact_intelligence_trigger(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        source = (ROOT / impact.INTELLIGENCE_WORKFLOW).read_text(encoding="utf-8")
        self.assertEqual(source.count(impact.CURRENT_PROFILE_TRIGGER), 2)
        self.assertNotIn(impact.LEGACY_PROFILE_TRIGGER, source)
        old = source.replace(impact.CURRENT_PROFILE_TRIGGER, impact.LEGACY_PROFILE_TRIGGER)
        self.commit(workflow=workflow, lock=VISUAL, intelligence_workflow=old,
                    path=impact.LEGACY_PROFILE_DOC)
        (self.root / impact.LEGACY_PROFILE_DOC).write_text(
            "# OrdaX\\n\\nARCHIVED / SUPERSEDED\\n", encoding="utf-8")
        base = self.commit()
        head = self.commit(intelligence_workflow=source,
                           delete_path=impact.LEGACY_PROFILE_DOC)
        self.assertEqual(impact.classify(base, head, root=self.root),
                         (False, "nonproducer-contract-only"))
        self.assertTrue(impact.verified_legacy_profile_trigger_migration(base, head, root=self.root))
        self.assertTrue(impact.verified_legacy_profile_deletion(base, head, root=self.root))
        tampered = self.commit(intelligence_workflow=source.replace(
            "name: Intelligence Foundation", "name: Malicious Change"))
        self.assertTrue(impact.classify(base, tampered, root=self.root)[0])
        restored = self.commit(intelligence_workflow=source, path=impact.LEGACY_PROFILE_DOC)
        self.assertTrue(impact.classify(base, restored, root=self.root)[0])
        extended = self.commit(intelligence_workflow=source + "\\n# unrelated")
        self.assertTrue(impact.classify(restored, extended, root=self.root)[0])

    def test_build_autonomy_has_no_creator_dependency_for_web_or_desktop(self):
        contract = json.loads((ROOT / "docs/contracts/build-autonomy.json").read_text(encoding="utf-8"))
        graph = contract["target_relationships"]
        independent = contract["client_build_independence"]
        for target in ("web-client", "desktop-client"):
            self.assertNotIn("creator", graph[target])
            self.assertNotIn("minimal-bootstrap", graph[target])
            self.assertNotIn("native-system-release", graph[target])
            self.assertFalse(independent[target]["requires_creator"])
            self.assertFalse(independent[target]["requires_usb_producer"])
        self.assertTrue(independent["shared_native_changes_require_usb_proof"])
        self.assertTrue(independent["unknown_owner_changes_fail_closed"])
        self.assertEqual(tuple(impact.CLIENT_ONLY_PREFIXES),
                         tuple(independent["client_only_source_prefixes"]))

if __name__ == "__main__":
    unittest.main()
