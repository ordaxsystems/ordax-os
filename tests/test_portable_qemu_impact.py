from pathlib import Path
import importlib.util
import json
import sys
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "ci" / "portable_qemu_impact.py"
spec = importlib.util.spec_from_file_location("portable_qemu_impact", MODULE_PATH)
assert spec is not None and spec.loader is not None
impact = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = impact
spec.loader.exec_module(impact)


OWNER_REMOTE_SLICE = [
    ".github/workflows/owner-remote-recovery-contract.yml",
    "bootstrap/base-update/owner-development/ordax-remote",
    "bootstrap/base-update/owner-development/owner-recovery-source.json",
    "docs/REMOTE-CONTROL.md",
    "system/services/base-update/dev-helpers.sh",
    "tests/test_dev_base_helper_refresh.py",
    "tests/test_owner_remote_recovery.py",
]

OWNER_RUN_VISIBLE_STATUS_SLICE = [
    ".github/workflows/owner-remote-recovery-contract.yml",
    "bootstrap/dev-base/ordax-run",
    "tests/test_dev_base_helper_refresh.py",
    "tests/test_dev_git_flow.py",
    "tools/ci/portable_qemu_impact.py",
    "tests/test_portable_qemu_impact.py",
]


class PortableQemuImpactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reachable, cls.graph_errors = impact.native_startup_import_graph(ROOT)

    def test_current_native_runtime_graph_resolves_all_discovered_roots(self):
        self.assertEqual(self.graph_errors, ())
        self.assertIn("system/composition/native/main.mjs", self.reachable)
        self.assertIn("system/composition/native/app-data-bootstrap.mjs", self.reachable)
        self.assertIn("system/composition/native/component-probation.mjs", self.reachable)
        self.assertIn("system/services/local-ai/runtime.mjs", self.reachable)
        self.assertIn("system/contracts/local-ai.mjs", self.reachable)
        self.assertIn("system/services/components/probation-orchestrator.mjs", self.reachable)

    def test_unwired_high_level_web_research_source_does_not_require_qemu(self):
        result = impact.classify_paths(
            [
                "system/contracts/web-research.mjs",
                "system/services/web-research/provider-router.mjs",
            ],
            root=ROOT,
        )
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("no-heavy-portable-impact",))

    def test_space_domain_composition_does_not_require_qemu(self):
        result = impact.classify_paths(
            [
                "system/composition/native/main.mjs",
                "system/contracts/space-experience.mjs",
                "system/contracts/spaces.mjs",
                "system/services/i18n/catalog/account.mjs",
                "system/services/spaces/composition.mjs",
                "system/services/spaces/type-catalog.mjs",
                "system/services/spaces/presentation.mjs",
                "system/services/spaces/aura-provider.mjs",
                "system/surface/ui/account-overview-controls.mjs",
                "system/surface/ui/space-switcher-controls.mjs",
                "system/surface/ui/account.css",
                "docs/SPACES-AND-PROFILES.md",
                "docs/contracts/spaces-and-profile-packs.json",
                "tests/test_account_canonical_navigation.py",
                "tests/test_space_aura_provider.mjs",
                "tests/test_space_experience.mjs",
                "tests/test_space_presentation.mjs",
                "tests/test_space_switcher.mjs",
            ],
            root=ROOT,
        )
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("no-heavy-portable-impact",))

    def test_native_composition_main_is_high_level_but_boot_coupled_component_wiring_stays_heavy(self):
        main = impact.classify_paths(["system/composition/native/main.mjs"], root=ROOT)
        probation = impact.classify_paths(["system/composition/native/component-probation.mjs"], root=ROOT)
        self.assertFalse(main.required)
        self.assertTrue(probation.required)
        self.assertIn("heavy-exact:system/composition/native/component-probation.mjs", probation.reasons)

    def test_app_delivery_policy_changes_use_app_gates_not_portable_boot(self):
        """An app lifecycle policy update must not rebuild unrelated Linux boot."""
        paths = [
            "docs/contracts/app-distribution.json",
            "docs/contracts/first-party-app-delivery.json",
            "docs/contracts/mvp-app-delivery.json",
            "system/services/apps/delivery-policy.mjs",
            "system/services/apps/first-run-selection.mjs",
            "system/services/apps/mvp-delivery-policy.mjs",
            "tests/test_first_party_app_delivery.mjs",
            "tests/test_mvp_app_delivery.mjs",
            "tests/test_zero_removable_bootstrap.mjs",
            "docs/APP-PORTFOLIO-AND-PREINSTALL.md",
        ]
        classified = impact.classify_paths(paths, root=ROOT)
        self.assertFalse(classified.required)
        self.assertEqual(classified.reasons, ("no-heavy-portable-impact",))
        for critical in (
            "system/supervisor",
            "bootstrap/initramfs/portable_init.sh",
            "bootstrap/surface-runtime/build.py",
            "system/surface/bin/ordax-surface",
            "docs/contracts/unclassified-boot-authorization.json",
        ):
            with self.subTest(critical=critical):
                result = impact.classify_paths(paths + [critical], root=ROOT)
                self.assertTrue(result.required)
                self.assertNotEqual(result.reasons, ("no-heavy-portable-impact",))

    def test_boot_coupled_local_ai_runtime_requires_qemu(self):
        result = impact.classify_paths(["system/services/local-ai/runtime.mjs"], root=ROOT)
        self.assertTrue(result.required)
        self.assertIn("heavy-exact:system/services/local-ai/runtime.mjs", result.reasons)

    def test_boot_coupled_component_orchestrator_requires_qemu(self):
        result = impact.classify_paths(
            ["system/services/components/probation-orchestrator.mjs"],
            root=ROOT,
        )
        self.assertTrue(result.required)
        self.assertIn(
            "heavy-exact:system/services/components/probation-orchestrator.mjs",
            result.reasons,
        )

    def test_presentation_stays_light_even_when_native_composition_imports_it(self):
        result = impact.classify_paths(["system/surface/ui/network-quick-panel.mjs"], root=ROOT)
        self.assertFalse(result.required)

    def test_surface_presentation_regression_does_not_require_portable_qemu(self):
        result = impact.classify_paths(
            [
                "system/composition/native/index.html",
                "system/surface/ui/boot-screen.mjs",
                "tests/test_surface_boot_screen.py",
            ],
            root=ROOT,
        )
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("no-heavy-portable-impact",))

    def test_boot_host_and_unknown_system_root_fail_closed(self):
        boot = impact.classify_paths(["system/entrypoint"], root=ROOT)
        unknown = impact.classify_paths(["system/new-kernel-facing-owner/config.bin"], root=ROOT)
        self.assertTrue(boot.required)
        self.assertTrue(unknown.required)
        self.assertIn("heavy-exact:system/entrypoint", boot.reasons)
        self.assertIn(
            "heavy-unclassified-system:system/new-kernel-facing-owner/config.bin",
            unknown.reasons,
        )

    def test_markdown_documentation_is_presentation_light_before_non_system_fail_closed(self):
        result = impact.classify_paths(
            [
                "docs/CURRENT-STATE.md",
                "docs/DECISIONS.md",
                "docs/SPACES-AND-PROFILES.md",
            ],
            root=ROOT,
        )
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("no-heavy-portable-impact",))

    def test_account_space_semantics_backend_slice_does_not_require_qemu(self):
        result = impact.classify_paths(
            [
                "infra/supabase/functions/ordax-account-gateway/index.ts",
                "infra/supabase/product/migrations/20261015153000_space_semantics_v1.sql",
                "services/public-identity/supabase_account.py",
                "system/adapters/web/spaces.mjs",
                "tests/test_account_spaces_source.py",
                "tests/test_spaces_catalog.mjs",
                "tests/test_supabase_account_provider.py",
            ],
            root=ROOT,
        )
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("no-heavy-portable-impact",))

    def test_product_device_presence_slice_does_not_require_portable_qemu(self):
        result = impact.classify_paths(
            [
                "docs/contracts/product-device-presence.json",
                "system/services/device-agent/product-presence-report.sh",
                "tests/test_product_device_presence_agent.py",
            ],
            root=ROOT,
        )
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("no-heavy-portable-impact",))

    def test_product_device_presence_exception_does_not_hide_unrelated_change(self):
        result = impact.classify_paths(
            [
                "docs/contracts/product-device-presence.json",
                "system/services/device-agent/product-presence-report.sh",
                "tests/test_product_device_presence_agent.py",
                "tests/test_product_device_enrollment.py",
            ],
            root=ROOT,
        )
        self.assertTrue(result.required)
        self.assertIn("heavy-non-system:tests/test_product_device_enrollment.py", result.reasons)

    def test_non_system_trigger_is_heavy_by_default(self):
        result = impact.classify_paths(["bootstrap/kernel/source.json"], root=ROOT)
        self.assertTrue(result.required)
        self.assertIn("heavy-non-system:bootstrap/kernel/source.json", result.reasons)

    def test_kernel_module_archive_helper_does_not_require_portable_qemu(self):
        result = impact.classify_paths(["bootstrap/kernel/module_archive.py"], root=ROOT)
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("no-heavy-portable-impact",))

    def test_full_independent_module_slice_does_not_require_direct_stable_qemu(self):
        result = impact.classify_paths(
            [
                ".github/workflows/independent-base-experiment.yml",
                "bootstrap/independent-base/module_parity.py",
                "bootstrap/independent-base/post-build.sh",
                "bootstrap/kernel/module_archive.py",
                "tests/test_independent_kernel_module_workflow.py",
                "tests/test_kernel_module_archive.py",
            ],
            root=ROOT,
        )
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("no-heavy-portable-impact",))

    def test_real_kernel_change_stays_heavy_with_full_independent_module_slice(self):
        result = impact.classify_paths(
            [
                ".github/workflows/independent-base-experiment.yml",
                "bootstrap/independent-base/module_parity.py",
                "bootstrap/independent-base/post-build.sh",
                "bootstrap/kernel/module_archive.py",
                "tests/test_independent_kernel_module_workflow.py",
                "tests/test_kernel_module_archive.py",
                "bootstrap/kernel/source.json",
            ],
            root=ROOT,
        )
        self.assertTrue(result.required)
        self.assertIn("heavy-non-system:bootstrap/kernel/source.json", result.reasons)

    def test_owner_remote_recovery_slice_does_not_require_portable_qemu(self):
        result = impact.classify_paths(OWNER_REMOTE_SLICE, root=ROOT)
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("no-heavy-portable-impact",))

    def test_real_kernel_change_stays_heavy_with_owner_remote_recovery_slice(self):
        result = impact.classify_paths(
            [*OWNER_REMOTE_SLICE, "bootstrap/kernel/source.json"],
            root=ROOT,
        )
        self.assertTrue(result.required)
        self.assertIn("heavy-non-system:bootstrap/kernel/source.json", result.reasons)

    def test_owner_run_visible_status_slice_does_not_require_portable_qemu(self):
        result = impact.classify_paths(OWNER_RUN_VISIBLE_STATUS_SLICE, root=ROOT)
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("no-heavy-portable-impact",))

    def test_real_kernel_change_stays_heavy_with_owner_run_visible_status_slice(self):
        result = impact.classify_paths(
            [*OWNER_RUN_VISIBLE_STATUS_SLICE, "bootstrap/kernel/source.json"],
            root=ROOT,
        )
        self.assertTrue(result.required)
        self.assertIn("heavy-non-system:bootstrap/kernel/source.json", result.reasons)

    def test_impact_policy_change_uses_focused_contract_instead_of_qemu(self):
        result = impact.classify_paths(
            [
                ".github/workflows/portable-qemu-impact-contract.yml",
                "tools/ci/portable_qemu_impact.py",
                "tests/test_portable_qemu_impact.py",
            ],
            root=ROOT,
        )
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("no-heavy-portable-impact",))

    def test_intelligence_disposable_composition_uses_focused_gates_not_qemu(self):
        changed = [
            "system/services/intelligence-source/wrappers/intelligence-runtime.mjs",
            "tools/intelligence-source/compose.py",
            "tests/test_native_release_intelligence_source.py",
            ".github/workflows/local-ai-runtime-candidate.yml",
        ]
        result = impact.classify_paths(changed, root=ROOT)
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("no-heavy-portable-impact",))
        boot = impact.classify_paths([*changed, "system/entrypoint"], root=ROOT)
        self.assertTrue(boot.required)
        self.assertIn("heavy-exact:system/entrypoint", boot.reasons)
        kernel = impact.classify_paths([*changed, "bootstrap/kernel/source.json"], root=ROOT)
        self.assertTrue(kernel.required)
        self.assertIn("heavy-non-system:bootstrap/kernel/source.json", kernel.reasons)

    def test_ci_scope_migration_does_not_require_portable_qemu(self):
        result = impact.classify_paths(
            [
                ".github/workflows/account-memory-local-continuity-flush.yml",
                ".github/workflows/account-memory-protected-mutations.yml",
                ".github/workflows/account-memory-sync-foundation.yml",
                ".github/workflows/application-action-capability-foundation.yml",
                ".github/workflows/component-trusted-context.yml",
                ".github/workflows/first-party-app-delivery.yml",
                ".github/workflows/intelligence-foundation.yml",
                ".github/workflows/native-intelligence-service-foundation.yml",
                ".github/workflows/pre-usb-nova-ordax-audit.yml",
                ".github/workflows/runtime-component-candidate.yml",
                "tools/ci/portable_qemu_impact.py",
                "tests/test_portable_qemu_impact.py",
                "tests/test_heavy_workflow_path_scope.py",
                "tests/test_native_memory_integration.py",
            ],
            root=ROOT,
        )
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("no-heavy-portable-impact",))

    def test_account_gateway_destination_deploy_does_not_require_qemu(self):
        result = impact.classify_paths(
            [
                ".github/workflows/ordax-account-gateway-destination.yml",
                "docs/contracts/ci-supply-chain.json",
                "tools/account/resolve_account_gateway_destination.py",
                "tests/test_account_gateway_destination_deploy.py",
                "tools/ci/portable_qemu_impact.py",
                "tests/test_portable_qemu_impact.py",
            ],
            root=ROOT,
        )
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("no-heavy-portable-impact",))

    def test_space_semantics_write_guard_does_not_require_portable_qemu(self):
        result = impact.classify_paths(
            [
                "infra/supabase/product/migrations/20261015195800_space_semantics_write_guard_v1.sql",
                "tests/test_account_spaces_source.py",
                "docs/SPACES-AND-PROFILES.md",
                "docs/CURRENT-STATE.md",
                "tools/ci/portable_qemu_impact.py",
                "tests/test_portable_qemu_impact.py",
            ],
            root=ROOT,
        )
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("no-heavy-portable-impact",))

    def test_qemu_workflow_change_itself_stays_heavy(self):
        result = impact.classify_paths(
            [".github/workflows/portable-v2-qemu-boot-proof.yml"],
            root=ROOT,
        )
        self.assertTrue(result.required)
        self.assertIn(
            "heavy-exact:.github/workflows/portable-v2-qemu-boot-proof.yml",
            result.reasons,
        )

    def test_windows_only_native_owners_use_installed_desktop_ci_not_qemu(self):
        desktop_paths = [
            ".github/workflows/windows-desktop-dev.yml",
            "tools/windows-desktop/main.cjs",
            "tools/windows-desktop/host.cjs",
            "tools/windows-desktop/materialize-local-ai.cjs",
            "tools/windows-desktop/package.json",
            "tools/windows-desktop/install-smoke.ps1",
            "tools/windows-emulator/native-host.mjs",
            "tools/windows-emulator/desktop-native-server.test.mjs",
            "tests/test_windows_desktop_local_ai_host.mjs",
            "tests/test_windows_desktop_local_ai_package.mjs",
            "system/adapters/desktop/local-ai-host.mjs",
            "system/adapters/desktop/local-ai-package.mjs",
        ]
        classified = impact.classify_paths(desktop_paths, root=ROOT)
        self.assertFalse(classified.required)
        self.assertEqual(classified.reasons, ("no-heavy-portable-impact",))

        # Filename-only claims are not enough to drop a mandatory boot gate.
        guarded = impact.classify_paths(
            [*desktop_paths, impact.WINDOWS_LOCAL_AI_SOURCE_LOCK], root=ROOT,
        )
        self.assertTrue(guarded.required)
        self.assertIn(
            "heavy-exact:system/services/local-ai/source-lock.json", guarded.reasons,
        )

        # Production commit classifier may establish the narrow Windows-only
        # change; any additional Linux or unknown root must still trigger QEMU.
        validated = impact.classify_paths(
            [*desktop_paths, impact.WINDOWS_LOCAL_AI_SOURCE_LOCK],
            root=ROOT, windows_lock_verified=True,
        )
        self.assertFalse(validated.required)
        for linux_change in (
            "bootstrap/kernel/source.json",
            "bootstrap/surface-runtime/build.py",
            "system/services/local-ai/runtime.mjs",
            "system/entrypoint",
        ):
            with self.subTest(linux_change=linux_change):
                guarded = impact.classify_paths(
                    [*desktop_paths, impact.WINDOWS_LOCAL_AI_SOURCE_LOCK, linux_change],
                    root=ROOT, windows_lock_verified=True,
                )
                self.assertTrue(guarded.required)

    def test_git_bound_local_ai_windows_lock_comparison_is_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.run(
                    ["git", *args], cwd=root, check=True,
                    capture_output=True, text=True,
                ).stdout.strip()
            git("init", "-q")
            git("config", "user.name", "QEMU Impact Contract")
            git("config", "user.email", "qemu-impact@example.invalid")
            path = root / impact.WINDOWS_LOCAL_AI_SOURCE_LOCK
            path.parent.mkdir(parents=True, exist_ok=True)
            base_lock = {
                "$schema": "prototype-ordax.local-ai-source-lock/1",
                "engine": {"id": "llama.cpp", "commit": "a" * 40},
                "model": {"id": "pinned-model", "sha256": "b" * 64},
            }
            def commit(obj, message):
                path.write_text(json.dumps(obj, sort_keys=True), encoding="utf-8")
                git("add", ".")
                git("commit", "-qm", message)
                return git("rev-parse", "HEAD")
            before = commit(base_lock, "pinned Linux Local AI source")
            windows = json.loads(json.dumps(base_lock))
            windows["engine"]["windows_artifact"] = {
                "platform": "windows-x86_64",
                "architecture": "x64",
                "binary_format": "PE",
                "source_commit": "a" * 40,
                "files": [
                    {
                        "name": name, "sha256": "d" * 64, "size_bytes": i + 100,
                    }
                    for i, name in enumerate(
                        (
                            "ggml-base.dll", "ggml-cpu-x64.dll",
                            "ggml-cpu-sandybridge.dll", "ggml-cpu-haswell.dll",
                            "ggml.dll", "llama-common.dll", "llama-server-impl.dll",
                            "llama-server.exe", "llama.dll", "mtmd.dll",
                        )
                    )
                ],
            }
            after = commit(windows, "introduce Windows-only engine pins")
            self.assertTrue(
                impact.verified_windows_only_local_ai_lock_delta(before, after, root=root)
            )
            self.assertFalse(
                impact.verified_windows_only_local_ai_lock_delta("invalid", after, root=root)
            )
            self.assertFalse(
                impact.verified_windows_only_local_ai_lock_delta(before, before, root=root)
            )
            malformed_windows_pin = json.loads(json.dumps(windows))
            malformed_windows_pin["engine"]["windows_artifact"]["files"][0]["sha256"] = "bad"
            malformed = commit(malformed_windows_pin, "invalidate Windows file pin")
            self.assertFalse(
                impact.verified_windows_only_local_ai_lock_delta(before, malformed, root=root)
            )
            foreign_windows = json.loads(json.dumps(windows))
            foreign_windows["engine"]["windows_artifact"]["files"][1]["name"] = "unsigned.dll"
            foreign = commit(foreign_windows, "untrusted Windows DLL")
            self.assertFalse(
                impact.verified_windows_only_local_ai_lock_delta(before, foreign, root=root)
            )
            changed_model = json.loads(json.dumps(windows))
            changed_model["model"]["sha256"] = "c" * 64
            latest = commit(changed_model, "alter Linux-consumed model pin")
            self.assertFalse(
                impact.verified_windows_only_local_ai_lock_delta(before, latest, root=root)
            )

    def test_missing_runtime_root_discovery_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            result = impact.classify_paths(
                ["system/contracts/web-research.mjs"],
                root=Path(directory),
            )
        self.assertTrue(result.required)
        self.assertTrue(any(reason.startswith("runtime-graph:") for reason in result.reasons))


if __name__ == "__main__":
    unittest.main()
