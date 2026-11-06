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
        self.assertIn("needs: [owner-dev-contract, impact]", text)
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
            impact.BUILD_GUARD_NEW, impact.BUILD_GUARD_OLD,
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

    def test_pull_script_only_pr_uses_owner_preflight_main_still_produces_usb(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        preflight = (ROOT / ".github/workflows/owner-dev-preflight.yml").read_text(encoding="utf-8")
        inventory = (ROOT / "tools/ci/preflight_owner_dev.py").read_text(encoding="utf-8")
        self.assertIn("'bootstrap/dev-base/**'", preflight)
        self.assertIn('"tests/test_dev_pull_expected_sha.py"', inventory)
        self.assertIn('"tests/test_dev_checkout_exchange.py"', inventory)
        self.assertIn('GITHUB_EVENT_NAME', (ROOT / "tools/ci/creator_owner_impact.py").read_text())

        base = self.commit(workflow, VISUAL)
        pull = self.commit(path="bootstrap/dev-base/ordax-pull")
        self.assertEqual(impact.classify(base, pull, root=self.root, event="pull_request"),
                         (False, "pull-pr-owner-preflight"))
        self.assertEqual(impact.classify(base, pull, root=self.root, event="push"),
                         (True, "real-or-unknown-usb-producer:bootstrap/dev-base/ordax-pull"))
        self.assertTrue(impact.classify(base, pull, root=self.root, event="workflow_dispatch")[0])
        self.assertTrue(impact.classify(base, pull, root=self.root, event="unknown")[0])

        # A reviewed Pull change and its own regression tests/docs are light;
        # the same merged main payload is still published with full USB proof.
        for path in ("tests/test_dev_pull_expected_sha.py",
                     "tests/test_dev_checkout_exchange.py",
                     "docs/DEV-USB-GIT.md"):
            head = self.commit(path=path)
            self.assertEqual(impact.classify(base, head, root=self.root, event="pull_request"),
                             (False, "pull-pr-owner-preflight"))
            self.assertTrue(impact.classify(base, head, root=self.root, event="push")[0])

        # A mixed Native, Base, boot or untrusted delta must never be hidden
        # behind the otherwise eligible Pull script.
        for path in ("bootstrap/dev-base/ordax-main-watch",
                     "bootstrap/dev-base/ordax_checkout_exchange.c",
                     "bootstrap/dev-base/build.py",
                     "system/supervisor",
                     "bootstrap/initramfs/build.py",
                     "docs/contracts/unowned-release.json"):
            head = self.commit(path=path)
            self.assertTrue(impact.classify(base, head, root=self.root, event="pull_request")[0],
                            path)

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
            "tests/test_windows_desktop_client_diagnostics.mjs",
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

    def test_exact_windows_product_bridge_has_no_usb_producer_delta(self):
        # This is an exact *source-diff* proof, never a wildcard exclusion:
        # shared Native modules are additive and Windows-guarded, translations
        # contain only added data, and sidecar/evidence bytes are pinned.
        native, catalog = tuple(impact.WINDOWS_PRODUCT_SHARED_ADDITIONS)
        for path in (native, catalog):
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("// existing shared native data\n", encoding="utf-8")
        base = self.commit(workflow=WORKFLOW.read_text(encoding="utf-8"), lock=VISUAL)
        for path, additions in impact.WINDOWS_PRODUCT_SHARED_ADDITIONS.items():
            target = self.root / path
            with target.open("a", encoding="utf-8") as output:
                output.write("\n".join(additions) + "\n")
        for path in impact.WINDOWS_PRODUCT_PINNED_BLOBS:
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((ROOT / path).read_bytes())
        head = self.commit(path="docs/DEVELOPMENT-WORKFLOW.md")
        for path in impact.WINDOWS_PRODUCT_SHARED_ADDITIONS:
            self.assertTrue(impact.verified_windows_product_additions(
                base, head, path, root=self.root), path)
        for path in impact.WINDOWS_PRODUCT_PINNED_BLOBS:
            self.assertTrue(impact.verified_windows_product_blob(
                head, path, root=self.root), path)
        self.assertEqual(impact.classify(base, head, root=self.root),
                         (False, "nonproducer-contract-only"))
        # An actual boot-side edit cannot piggyback on the approved lines.
        bad = self.commit(path="system/composition/native/main.mjs")
        self.assertEqual(impact.classify(base, bad, root=self.root)[0], True)
        self.assertFalse(impact.verified_windows_product_additions(
            base, bad, native, root=self.root))
        # A candidate's signature or authority cannot change under a stale
        # content pin, even if its path looks Windows-only.
        suspect = self.commit(path="docs/evidence/desktop-runtime-windows-candidate-2026-10-31.json")
        self.assertEqual(impact.classify(base, suspect, root=self.root)[0], True)

    def test_exact_windows_semantic_surface_mount_is_not_a_usb_producer(self):
        # Exact source-diff proof: the same Linux Native composition remains
        # byte-identical except for one call inside an existing Windows guard.
        path = "system/composition/native/main.mjs"
        source = self.root / path
        source.parent.mkdir(parents=True, exist_ok=True)
        old = (
            "const something = true;\n"
            "  const desktopSurfaceReporter = windowsDesktopHost\n"
            "    ? mountNativeDesktopSurfaceStateReport(window, root, surface, appActivation)\n"
            "    : null;\n"
        )
        source.write_text(old, encoding="utf-8")
        base = self.commit(workflow=WORKFLOW.read_text(encoding="utf-8"), lock=VISUAL)
        new = old.replace(
            "mountNativeDesktopSurfaceStateReport(window, root, surface, appActivation)",
            "mountNativeDesktopSurfaceStateReport(window, surface, appActivation)",
        )
        source.write_text(new, encoding="utf-8")
        head = self.commit()
        self.assertTrue(impact.verified_windows_semantic_surface_mount(
            base, head, root=self.root
        ))
        self.assertEqual(impact.classify(base, head, root=self.root),
                         (False, "nonproducer-contract-only"))
        # Any extra Native or USB mutation invalidates the exception.
        source.write_text(new + "\nconst unexpectedNativeChange = true;\n", encoding="utf-8")
        bad = self.commit()
        self.assertFalse(impact.verified_windows_semantic_surface_mount(
            base, bad, root=self.root
        ))
        self.assertTrue(impact.classify(base, bad, root=self.root)[0])
        # Even if the same call text is moved out of the Windows guard, no skip.
        source.write_text(old.replace(
            "const desktopSurfaceReporter = windowsDesktopHost",
            "const desktopSurfaceReporter = true",
        ).replace(
            "mountNativeDesktopSurfaceStateReport(window, root, surface, appActivation)",
            "mountNativeDesktopSurfaceStateReport(window, surface, appActivation)",
        ), encoding="utf-8")
        unguarded = self.commit()
        self.assertTrue(impact.classify(base, unguarded, root=self.root)[0])

    def test_unrecognized_native_and_catalog_additions_remain_usb_gated(self):
        native, catalog = tuple(impact.WINDOWS_PRODUCT_SHARED_ADDITIONS)
        for path in (native, catalog):
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("baseline\n", encoding="utf-8")
        base = self.commit(workflow=WORKFLOW.read_text(encoding="utf-8"), lock=VISUAL)
        for path in (native, catalog):
            self.commit(path=path)
            self.assertTrue(impact.classify(base,
                subprocess.check_output(["git", "-C", str(self.root),
                "rev-parse", "HEAD"], text=True).strip(), root=self.root)[0])

    def test_exact_freshness_only_workflow_migration_skips_physical_usb_producer(self):
        current = WORKFLOW.read_text(encoding="utf-8")
        old = current.replace(
            "      required: ${{ steps.scope.outputs.required == 'true' && steps.freshness.outputs.publish_allowed != 'false' }}\n"
            "      reason: ${{ steps.freshness.outputs.reason || steps.scope.outputs.reason }}",
            "      required: ${{ steps.scope.outputs.required }}\n"
            "      reason: ${{ steps.scope.outputs.reason }}",
        )
        self.assertNotEqual(old, current)
        early = old.index("      # On a queued main push, avoid an expensive build")
        early_end = old.index("  owner-dev-contract:", early)
        old = old[:early] + old[early_end:]
        late = old.index("          # Recheck immediately before mutating the rolling channel")
        late_end = old.index("          if ! gh release view creator-owner-prototype", late)
        old = old[:late] + old[late_end:]
        base = self.commit(workflow=old, lock=VISUAL)
        head = self.commit(workflow=current, path="tools/ci/creator_owner_publish_freshness.py")
        self.assertTrue(impact.verified_creator_freshness_wiring_only(
            base, head, root=self.root))
        self.assertEqual(
            impact.classify(base, head, root=self.root, event="pull_request"),
            (False, "nonproducer-contract-only"),
        )
        self.assertEqual(
            impact.classify(base, head, root=self.root, event="push"),
            (False, "nonproducer-contract-only"),
        )
        # A changed publisher command, permissions, raw USB producer or unknown
        # extension cannot be smuggled through this exact governance proof.
        tampered = current.replace(
            "gh release upload creator-owner-prototype",
            "gh release upload untrusted-owner-prototype")
        self.assertNotEqual(current, tampered)
        bad = self.commit(workflow=tampered)
        self.assertFalse(impact.verified_creator_freshness_wiring_only(
            base, bad, root=self.root))
        self.assertTrue(impact.classify(base, bad, root=self.root)[0])
        mixed = self.commit(path="bootstrap/dev-base/ordax-main-watch")
        self.assertTrue(impact.classify(base, mixed, root=self.root)[0])

    def test_new_workflow_producer_step_forces_usb(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        base = self.commit(workflow, VISUAL)
        changed = workflow.replace("timeout-minutes: 360", "timeout-minutes: 365")
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
            "00-PLANOS-PRIORITARIOS/README.md",
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
        pull = contract["owner_dev_pull_ci"]
        self.assertEqual(pull["distribution_owner_ssot"],
                         "docs/contracts/distribution-profiles.json#profiles.owner-development")
        self.assertEqual(pull["pull_review_fast_path_scope"],
                         "tools/ci/creator_owner_impact.py#PULL_REVIEW_ONLY_PATHS")
        self.assertEqual(pull["pull_review_validation_owner"], "Owner Development Preflight")
        self.assertTrue(pull["pull_only_pull_request_skips_creator_usb_build"])
        self.assertTrue(pull["pull_source_change_on_main_preserves_creator_usb_publish"])
        self.assertTrue(pull["mixed_boot_base_native_or_unknown_changes_require_full_usb_proof"])
        self.assertTrue(pull["manual_creator_usb_production_requires_full_proof"])
        self.assertFalse(pull["installed_git_updates_require_creator"])
        self.assertIn("docs/DEV-USB-GIT.md", impact.LIGHT_EXACT)

if __name__ == "__main__":
    unittest.main()
