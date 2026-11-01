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
               intelligence_workflow=None, delete_path=None, client_contract=None):
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
        if client_contract is not None:
            f = self.root / impact.CLIENT_AUTONOMY_CONTRACT
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps(client_contract, sort_keys=True) + "\n", encoding="utf-8")
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
        self.assertIn("      - 'system/surface/entrypoint'",
                      WORKFLOW.read_text(encoding="utf-8"),
                      "A Linux Surface boot change must trigger the PR Owner USB gate")
        base = self.commit(WORKFLOW.read_text(encoding="utf-8"), VISUAL)
        for path in ("bootstrap/initramfs/build.py", "bootstrap/surface-runtime/build.py",
                     "system/supervisor", "system/surface/entrypoint",
                     "tools/creator/assemble.py",
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
            # The exact build-autonomy JSON is validated in its own test.
            # Arbitrary edits to its dependency graph must remain USB-heavy.
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
        # A malformed or unknown change to the build dependency contract
        # is explicitly NOT an exclusive Windows/Web no-op.
        changed = self.commit(path="docs/contracts/build-autonomy.json")
        self.assertEqual(impact.classify(base, changed, root=self.root),
                         (True, "client-delivery-contract-unknown-or-producer-delta"))
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

    def test_client_contract_metadata_addition_skips_usb_but_dependency_mutation_does_not(self):
        contract = json.loads((ROOT / impact.CLIENT_AUTONOMY_CONTRACT).read_text(encoding="utf-8"))
        new_keys = ("separation_roadmap", "client_validation_workflows",
                    "windows_package_forbidden_linux_boot_paths",
                    "windows_package_forbidden_linux_shell_paths",
                    "linux_only_client_package_manifest",
                    "linux_only_client_probe_paths",
                    "client_delivery_gate_decoupling_fully_proven",
                    "windows_physical_and_web_live_independence_proven")
        old = json.loads(json.dumps(contract))
        for key in new_keys:
            old["client_build_independence"].pop(key)
        # The classifier checks file shebang and Git source provenance, not
        # a hardcoded duplicate list of approved Linux exclusions.
        for relative in contract["client_build_independence"]["windows_package_forbidden_linux_shell_paths"]:
            source = self.root / "system" / relative
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        for relative in contract["client_build_independence"]["linux_only_client_probe_paths"]:
            probe = self.root / "system" / relative
            probe.parent.mkdir(parents=True, exist_ok=True)
            probe.write_text("#!/usr/bin/env python3\nprint('ok')\n", encoding="utf-8")
        manifest_path = self.root / "system" / contract["client_build_independence"]["linux_only_client_package_manifest"]
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text("alpine-baselayout\nbusybox\n", encoding="utf-8")
        base = self.commit(workflow=WORKFLOW.read_text(encoding="utf-8"),
                           lock=VISUAL, client_contract=old)
        changed = self.commit(client_contract=contract)
        self.assertEqual(impact.classify(base, changed, root=self.root),
                         (False, "nonproducer-contract-only"))
        unsafe = json.loads(json.dumps(contract))
        unsafe["target_relationships"]["desktop-client"].append("creator")
        dangerous = self.commit(client_contract=unsafe)
        self.assertEqual(impact.classify(changed, dangerous, root=self.root),
                         (True, "client-delivery-contract-unknown-or-producer-delta"))

    def test_linux_only_alpine_manifest_is_single_source_and_fail_closed(self):
        client = json.loads((ROOT / impact.CLIENT_AUTONOMY_CONTRACT).read_text(encoding="utf-8"))["client_build_independence"]
        manifest = client["linux_only_client_package_manifest"]
        self.assertEqual(manifest, "surface/runtime/packages.txt")
        source = (ROOT / "system" / manifest).read_text(encoding="utf-8")
        self.assertTrue(source.endswith("\n"))
        self.assertIn("alpine-baselayout", source)
        for line in source.splitlines():
            self.assertRegex(line, r"^[a-z0-9][a-z0-9+._-]*$")

    def test_surface_web_workflow_is_owned_by_web_not_usb_creator(self):
        base = self.commit(WORKFLOW.read_text(encoding="utf-8"), VISUAL)
        head = self.commit(path=".github/workflows/surface-web-candidate.yml")
        self.assertEqual(impact.classify(base, head, root=self.root),
                         (False, "nonproducer-contract-only"))

    def test_linux_shell_exclusion_must_be_real_posix_source(self):
        contract = json.loads((ROOT / impact.CLIENT_AUTONOMY_CONTRACT).read_text(encoding="utf-8"))
        shell = contract["client_build_independence"]["windows_package_forbidden_linux_shell_paths"]
        self.assertGreaterEqual(len(shell), 15)
        for relative in shell:
            with self.subTest(script=relative):
                self.assertTrue(relative.startswith(("rescue/", "services/", "surface/")))
                self.assertTrue((ROOT / "system" / relative).read_bytes().startswith(b"#!/bin/sh\n"))

    def test_linux_only_physical_probes_have_proven_python_entrypoints(self):
        client = json.loads((ROOT / impact.CLIENT_AUTONOMY_CONTRACT).read_text(encoding="utf-8"))["client_build_independence"]
        probes = client["linux_only_client_probe_paths"]
        self.assertEqual(len(probes), 4)
        for relative in probes:
            with self.subTest(path=relative):
                self.assertTrue(relative.startswith("surface/runtime/"))
                self.assertTrue((ROOT / "system" / relative).read_bytes().startswith(b"#!/usr/bin/env python3\n"))
        self.assertIn("surface/runtime/audio-session.sh",
                      client["windows_package_forbidden_linux_shell_paths"])

    def test_web_only_composition_is_excluded_from_windows_not_web_delivery(self):
        scope = json.loads((ROOT / "docs/contracts/build-autonomy.json").read_text(encoding="utf-8"))
        self.assertIn("system/composition/web/",
                      scope["client_build_independence"]["client_only_source_prefixes"])
        windows = (ROOT / ".github/workflows/windows-desktop-dev.yml").read_text(encoding="utf-8")
        web = (ROOT / ".github/workflows/surface-web-candidate.yml").read_text(encoding="utf-8")
        self.assertEqual(windows.count("      - '!system/composition/web/**'"), 1)
        self.assertIn("paths: *desktop_product_sources", windows)
        self.assertEqual(web.count("      - 'system/composition/web/**'"), 2)
        self.assertEqual(web.count("      - '!system/composition/web/**'"), 0)
        self.assertIn("      - 'system/**'", windows)
        self.assertEqual(windows.count("      - 'system/composition/native/**'"), 0)


    def test_ci_exclusions_exactly_match_ssot_and_are_terminal(self):
        """A later positive glob must never re-include a Linux or Web payload.

        Use the checked-in build autonomy contract, not a second exclusion
        list, for both the single Windows YAML anchor and Web push/PR events.
        """
        boundary = json.loads((ROOT / "docs/contracts/build-autonomy.json")
                              .read_text(encoding="utf-8"))["client_build_independence"]
        linux = (
            boundary["windows_package_forbidden_linux_boot_paths"]
            + boundary["windows_package_forbidden_linux_shell_paths"]
            + boundary["linux_only_client_probe_paths"]
            + [boundary["linux_only_client_package_manifest"]]
        )
        expected_web = {"!system/" + path for path in linux}
        expected_desktop = expected_web | {"!system/composition/web/**"}
        self.assertEqual(len(linux), len(expected_web),
                         "Duplicate Linux ownership in build-autonomy contract")

        windows = (ROOT / ".github/workflows/windows-desktop-dev.yml").read_text(encoding="utf-8")
        web = (ROOT / ".github/workflows/surface-web-candidate.yml").read_text(encoding="utf-8")
        self.assertIn("paths: *desktop_product_sources", windows)
        self.assertEqual(web.count("\n  pull_request:\n"), 1)
        web_push, web_pr = web.split("\n  pull_request:\n", 1)

        def patterns(body):
            return [line[9:-1] for line in body.splitlines()
                    if line.startswith("      - '") and line.endswith("'")]

        def prove_exact_terminal_negatives(source, expected):
            seen = patterns(source)
            negatives = [path for path in seen if path.startswith("!")]
            self.assertEqual(set(negatives), expected,
                             "Client workflow has a missing or extra exclusion")
            self.assertEqual(len(negatives), len(expected),
                             "Client workflow duplicates a negative pattern")
            self.assertEqual(seen[-len(negatives):], negatives,
                             "An event has positive includes after negative filters")
            self.assertTrue(all(not path.startswith("!") for path in
                                seen[:-len(negatives)]),
                            "Client workflow has an early negative filter")

        prove_exact_terminal_negatives(windows.split("\n  push:\n", 1)[0],
                                       expected_desktop)
        for event in (web_push, web_pr):
            prove_exact_terminal_negatives(event, expected_web)

        # The order invariant must protect real client inputs as well.
        self.assertIn("system/**", patterns(windows))
        self.assertIn("system/surface/**", patterns(web_push))
        self.assertIn("system/composition/native/**", patterns(web_push))
        self.assertIn("system/composition/web/**", patterns(web_pr))

    def test_usb_boot_only_paths_do_not_trigger_client_builds(self):
        contract = json.loads((ROOT / "docs/contracts/build-autonomy.json").read_text(encoding="utf-8"))
        windows = (ROOT / ".github/workflows/windows-desktop-dev.yml").read_text(encoding="utf-8")
        web = (ROOT / ".github/workflows/surface-web-candidate.yml").read_text(encoding="utf-8")
        # Windows uses one shared event-path YAML anchor for both push and PR.
        self.assertIn("paths: *desktop_product_sources", windows)
        self.assertIn("- 'system/**'", windows)
        for field in ("windows_package_forbidden_linux_boot_paths",
                      "windows_package_forbidden_linux_shell_paths",
                      "linux_only_client_probe_paths"):
            for path in contract["client_build_independence"][field]:
                self.assertEqual(windows.count(f"      - '!system/{path}'"), 1,
                                 "Linux-only input must not rebuild Windows CI")
                self.assertEqual(web.count(f"      - '!system/{path}'"), 2,
                                 "Linux-only input must not rebuild Web CI")
        # Web has separate push and pull_request path tables; both must exclude.
        self.assertEqual(web.count("      - 'system/surface/**'"), 2)
        for path in ("system/surface/bin/ordax-surface",
                     "system/surface/runtime/packages.txt"):
            self.assertEqual(web.count(f"      - '!{path}'"), 2,
                             "must exclude USB-specific inputs on both Web events")
        self.assertEqual(web.count("      - 'system/composition/native/**'"), 2,
                         "shared Native integration remains validated")
        self.assertEqual(web.count("      - 'system/composition/web/**'"), 2,
                         "Web source remains validated")

    def test_client_workflows_have_no_direct_usb_creator_producer_dependency(self):
        contract = json.loads((ROOT / "docs/contracts/build-autonomy.json").read_text(encoding="utf-8"))
        independent = contract["client_build_independence"]
        self.assertEqual(independent["separation_roadmap"], "REMOVER-DEPENDENCIA.md")
        self.assertTrue((ROOT / independent["separation_roadmap"]).is_file())
        for target, workflow in independent["client_validation_workflows"].items():
            with self.subTest(target=target):
                self.assertIn(target, ("desktop-client", "web-client"))
                source = (ROOT / workflow).read_text(encoding="utf-8")
                # Exclude prose comments: only executable jobs and actions count.
                executable = "\n".join(line for line in source.splitlines()
                                       if not line.lstrip().startswith("#"))
                self.assertIn("jobs:", executable)
                for forbidden in ("needs: build-and-publish", "needs: creator",
                                  "uses: ./.github/actions/resolve-creator-source",
                                  "tools/creator/", "bootstrap/dev-base/build.py",
                                  "bootstrap/surface-runtime/build.py", "qemu-system",
                                  "apk add --no-cache"):
                    self.assertNotIn(forbidden, executable)
        self.assertFalse(independent["client_delivery_gate_decoupling_fully_proven"])
        self.assertFalse(independent["windows_physical_and_web_live_independence_proven"])

    def test_root_dependency_roadmap_is_nonproducer_but_unknown_root_stays_heavy(self):
        base = self.commit(WORKFLOW.read_text(encoding="utf-8"), VISUAL)
        plan = self.commit(path="REMOVER-DEPENDENCIA.md")
        self.assertEqual(impact.classify(base, plan, root=self.root),
                         (False, "nonproducer-contract-only"))
        dangerous = self.commit(path="UNKNOWN-BOOT-GATE.md")
        self.assertTrue(impact.classify(plan, dangerous, root=self.root)[0])

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
