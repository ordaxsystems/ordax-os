#!/usr/bin/env python3
"""Regress Stable/MVP runtime selection without operational Git."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
BOOTSTRAP = ROOT / "bootstrap" / "entrypoint"
DEV_RUN = ROOT / "bootstrap" / "dev-base" / "ordax-run"
ENTRYPOINT = ROOT / "system" / "entrypoint"
SUPERVISOR = ROOT / "system" / "supervisor"
SURFACE = ROOT / "system" / "surface" / "bin" / "ordax-surface"
PROOF_RUNTIME = ROOT / "system" / "surface" / "bin" / "ordax-proof-runtime.sh"
BASE_OWNER = ROOT / "system" / "services" / "base-update" / "agent.sh"
TELEMETRY = ROOT / "system" / "services" / "telemetry" / "base-agent.sh"
CONTRACT = json.loads(
    (ROOT / "docs/contracts/distribution-profiles.json").read_text(encoding="utf-8")
)


class StableRuntimeProfileTests(unittest.TestCase):
    def test_shell_boundaries_remain_syntax_valid(self):
        for path in (
            BOOTSTRAP,
            DEV_RUN,
            ENTRYPOINT,
            SUPERVISOR,
            SURFACE,
            PROOF_RUNTIME,
            BASE_OWNER,
            TELEMETRY,
        ):
            subprocess.run(["sh", "-n", str(path)], check=True)

    def test_canonical_bootstrap_binds_verified_release_identity_to_stable(self):
        text = BOOTSTRAP.read_text(encoding="utf-8")
        self.assertIn("current_release_sha()", text)
        self.assertIn("[ -L /ordax/current ]", text)
        self.assertIn('case "$target" in', text)
        self.assertIn("releases/*)", text)
        self.assertIn("ORDAX_DISTRIBUTION_PROFILE=stable-mvp", text)
        self.assertIn('ORDAX_SOURCE_SHA="$source_sha"', text)
        self.assertIn('ORDAX_PRODUCT_MODE="$mode"', text)
        self.assertIn('PRODUCT_MODE_FILE=/ordax/bootstrap/config/product-mode', text)
        self.assertIn('ACCOUNT_GATEWAY_FILE=/ordax/bootstrap/config/account-gateway-origin', text)
        self.assertIn('account_gateway_base_url() {', text)
        self.assertIn('https://*)', text)
        self.assertIn('ORDAX_ACCOUNT_GATEWAY_ORIGIN=$gateway_origin', text)
        self.assertIn('export ORDAX_ACCOUNT_GATEWAY_ORIGIN', text)
        self.assertIn('unset ORDAX_ACCOUNT_GATEWAY_ORIGIN', text)
        self.assertIn('boot_current || recovery "verified release handoff failed"', text)

    def test_owner_handoff_binds_git_head_to_owner_profile(self):
        text = DEV_RUN.read_text(encoding="utf-8")
        self.assertIn('"$GIT_BIN" -C "$WORKTREE" rev-parse HEAD', text)
        self.assertIn("ORDAX_DISTRIBUTION_PROFILE=owner-development", text)
        self.assertIn('ORDAX_SOURCE_SHA="$source_sha"', text)
        self.assertIn("ORDAX_PRODUCT_MODE=usb", text)

    def test_guardian_rebinds_stable_identity_from_current_release(self):
        text = ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn('DISTRIBUTION_PROFILE=${ORDAX_DISTRIBUTION_PROFILE:-owner-development}', text)
        self.assertIn('STABLE_ROOT=${ORDAX_STABLE_ROOT:-/ordax}', text)
        self.assertIn('PRODUCT_MODE=${ORDAX_PRODUCT_MODE:-}', text)
        self.assertIn('fail_closed "OrdaX product mode identity is missing or invalid"', text)
        self.assertIn("export ORDAX_PRODUCT_MODE", text)
        resolver = text.split("stable_current_release_sha() {", 1)[1].split("\n}", 1)[0]
        self.assertIn('current=$STABLE_ROOT/current', resolver)
        self.assertIn('[ -L "$current" ]', resolver)
        self.assertIn('releases/*)', resolver)
        stable_runtime = text.split("stable_release_identity_sha() {", 1)[1].split("\n}", 1)[0]
        self.assertIn("legacy-tree)", stable_runtime)
        self.assertIn("stable_current_release_sha", stable_runtime)
        self.assertIn("portable-v2)", stable_runtime)
        self.assertIn("portable_stable_source_sha", stable_runtime)
        runtime = text.split("runtime_source_sha() {", 1)[1].split("\n}", 1)[0]
        self.assertIn("stable-mvp)", runtime)
        self.assertIn("stable_release_identity_sha", runtime)
        heartbeat = text.split("write_base_update_heartbeat() {", 1)[1].split("\n}", 1)[0]
        self.assertIn("runtime_source_sha", heartbeat)
        refresh = text.split('if [ "$supervisor_rc" -eq 75 ]; then', 1)[1].split("\n    fi", 1)[0]
        self.assertIn("legacy-tree)", refresh)
        self.assertIn("stable_current_release_sha", refresh)
        self.assertIn("ORDAX_SOURCE_SHA=$SOURCE_SHA_HINT", refresh)
        self.assertIn("portable-v2)", refresh)
        self.assertIn("portable-v2 guardian refresh is blocked", refresh)

    def test_stable_supervisor_stages_signed_release_before_owner_git_path(self):
        text = SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn('DISTRIBUTION_PROFILE=${ORDAX_DISTRIBUTION_PROFILE:-owner-development}', text)
        current = text.split("current_sha() {", 1)[1].split("\n}", 1)[0]
        self.assertIn("stable-mvp)", current)
        self.assertIn("stable_release_identity_sha", current)
        layout = text.split("stable_release_identity_sha() {", 1)[1].split("\n}", 1)[0]
        self.assertIn("legacy-tree)", layout)
        self.assertIn("stable_current_release_sha", layout)
        self.assertIn("portable-v2)", layout)

        check = text.split("check_for_update() {", 1)[1].split("\n}", 1)[0]
        stable_guard = '[ "$DISTRIBUTION_PROFILE" = "stable-mvp" ]'
        self.assertIn(stable_guard, check)
        self.assertIn('check_stable_signed_update "$current"', check)
        self.assertLess(check.index(stable_guard), check.index("ls-remote"))

        channel = text.split("stable_channel_url() {", 1)[1].split("\n}", 1)[0]
        self.assertIn('[ ! -L "$STABLE_CHANNEL_FILE" ]', channel)
        self.assertIn("https://*", channel)
        stable_stage = text.split("check_stable_signed_update() {", 1)[1].split("\n}", 1)[0]
        self.assertIn('[ -L "$STABLE_RELEASE_AGENT" ]', stable_stage)
        self.assertIn('[ -L "$STABLE_TRUST_FILE" ]', stable_stage)
        self.assertIn('"$STABLE_RELEASE_AGENT" inspect', stable_stage)
        self.assertIn('"$STABLE_RELEASE_AGENT" materialize', stable_stage)
        self.assertIn('--expected-commit "$remote_sha"', stable_stage)
        self.assertIn('write_state_value "$STAGED_RELEASE_FILE" "$remote_sha"', stable_stage)
        self.assertIn("stable_release_tree_is_valid", stable_stage)
        self.assertIn("activate_health_ready_stable_release", stable_stage)
        self.assertIn("probe_staged_stable_release_health", stable_stage)
        self.assertNotIn(" install ", stable_stage)
        self.assertNotIn("/ordax/current", stable_stage)
        self.assertNotIn("ls-remote", stable_stage)
        self.assertNotIn("fetch --no-tags", stable_stage)

        rollback = text.split("rollback_boot_candidate() {", 1)[1].split("\n}", 1)[0]
        self.assertIn(
            '[ "$DISTRIBUTION_PROFILE" = "owner-development" ] || return 1',
            rollback,
        )
        start = text.split("start_surface() {", 1)[1].split("\n}", 1)[0]
        self.assertIn('start_surface_from_system "$SYSTEM_ROOT" "$(current_sha)"', start)
        shared_start = text.split("start_surface_from_system() {", 1)[1].split("\n}", 1)[0]
        self.assertIn('ORDAX_DISTRIBUTION_PROFILE="$DISTRIBUTION_PROFILE"', shared_start)
        self.assertIn('ORDAX_PRODUCT_MODE="$PRODUCT_MODE"', shared_start)
        self.assertIn('ORDAX_SOURCE_SHA="$surface_source_sha"', shared_start)
        self.assertIn(
            'if [ "$DISTRIBUTION_PROFILE" = "stable-mvp" ]; then\n    rm -f "$SUPERVISOR_GUARD_FILE"',
            text,
        )

    def test_surface_uses_release_sha_and_disables_dev_rescue_in_stable(self):
        text = SURFACE.read_text(encoding="utf-8")
        identity = text.split("resolve_source_identity() {", 1)[1].split("\n}", 1)[0]
        self.assertIn("stable-mvp)", identity)
        self.assertIn("SOURCE_SHA=$SOURCE_SHA_HINT", identity)
        self.assertIn("owner-development)", identity)
        self.assertIn('/usr/bin/git -C "$repo_root" rev-parse HEAD', identity)
        self.assertIn('[ "$candidate_sha" = "$SOURCE_SHA_HINT" ]', identity)
        configure = text.split("configure_graphics_host() {", 1)[1].split("\n}", 1)[0]
        self.assertIn('is_source_sha "$SOURCE_SHA"', configure)
        self.assertIn('PRODUCT_MODE=${ORDAX_PRODUCT_MODE:-}', text)
        self.assertIn('--product-mode "$PRODUCT_MODE"', text)
        self.assertIn('--distribution-profile "$DISTRIBUTION_PROFILE"', text)
        self.assertIn('--native-install-capability "$NATIVE_INSTALL_CAPABILITY"', text)
        self.assertIn('[ "$PRODUCT_MODE" = "usb" ] || return 0', text)
        self.assertIn(
            '[ "$DISTRIBUTION_PROFILE" = "stable-mvp" ] && NATIVE_INSTALL_CAPABILITY=disabled',
            text,
        )
        self.assertIn(
            '[ "$DISTRIBUTION_PROFILE" = "owner-development" ] || return 0',
            text,
        )

        rescue = text.split("ensure_rescue_agent() {", 1)[1].split("\n}", 1)[0]
        self.assertIn('[ "$DISTRIBUTION_PROFILE" = "stable-mvp" ]', rescue)
        self.assertIn("development Git rescue is disabled in Stable/MVP", rescue)

        owner = text.split("ensure_base_update_agent() {", 1)[1].split("\n}", 1)[0]
        self.assertIn('[ "$DISTRIBUTION_PROFILE" = "owner-development" ]', owner)
        self.assertIn('[ "$DISTRIBUTION_PROFILE" = "stable-mvp" ]', owner)
        self.assertIn(
            "Base update owner is disabled in Stable/MVP until signed update integration is connected",
            owner,
        )
        self.assertIn('ORDAX_BASE_SOURCE_SHA="$SOURCE_SHA"', owner)

        bindings = text.split("bind_runtime_mounts() {", 1)[1].split("\n}", 1)[0]
        self.assertIn("owner-development)", bindings)
        self.assertIn("stable-mvp)", bindings)
        self.assertIn(
            "Stable/MVP owns a verified /system tree, not a Git checkout",
            bindings,
        )
        owner_bind = bindings.split(
            'if [ "$DISTRIBUTION_PROFILE" = "owner-development" ]; then',
            1,
        )[1]
        self.assertIn(
            'mount -o bind "$repo_root" "$RUNTIME_ROOT/srv/ordax-repo"',
            owner_bind,
        )
        stable_case = bindings.split("stable-mvp)", 1)[1].split(";;", 1)[0]
        self.assertNotIn("/srv/ordax-repo", stable_case)
        self.assertIn(
            'mount -o bind "$SYSTEM_ROOT" "$RUNTIME_ROOT/srv/ordax-system"',
            bindings,
        )

        self.assertIn(
            "RUNTIME_PROOF_CONTEXT=$SESSION_DIR/runtime-proof-context",
            text,
        )
        publish = text.split("publish_runtime_proof_context() {", 1)[1].split("\n}", 1)[0]
        self.assertIn("dynamic-native-runtime", publish)
        self.assertIn("verified-erofs-overlay", publish)
        self.assertIn("canonical-stable-mvp", publish)
        self.assertIn('chmod 600 "$temporary"', publish)
        self.assertIn('rm -f "$RUNTIME_PROOF_CONTEXT"', text)
        self.assertLess(
            text.index("\nconfigure_keyboard_layout\n"),
            text.index("\nprepare_keyboard_session_restart_broker ||"),
        )
        self.assertLess(
            text.index("\nprepare_keyboard_session_restart_broker ||"),
            text.index("\npublish_runtime_proof_context || fallback_with_reason"),
        )

        resolver = PROOF_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("/run/ordax-surface/runtime-proof-context", resolver)
        self.assertIn("duplicate distribution profile", resolver)
        self.assertIn("unknown field in runtime proof context", resolver)
        self.assertIn("canonical-stable-mvp", resolver)
        self.assertIn("ORDAX_PROOF_RUNTIME_SHA256", resolver)

    def test_stable_base_owner_does_not_run_development_candidate_pipeline(self):
        text = BASE_OWNER.read_text(encoding="utf-8")
        loop = text.rsplit("while :; do", 1)[1]
        self.assertIn('case "$DISTRIBUTION_PROFILE" in', loop)
        self.assertIn("stable-mvp)", loop)
        self.assertIn("source_sha=$SOURCE_SHA_HINT", loop)
        self.assertIn('if [ "$DISTRIBUTION_PROFILE" = "owner-development" ]; then', loop)
        owner_only = loop.split(
            'if [ "$DISTRIBUTION_PROFILE" = "owner-development" ]; then',
            1,
        )[1].split("\n        fi", 1)[0]
        for call in (
            "prepare_dev_base_candidate",
            "prepare_esp_readonly_preflight",
            "prepare_dev_base_physical_stage",
            "prepare_dev_base_activation_readiness",
            "prepare_dev_base_postboot_promotion",
        ):
            self.assertIn(call, owner_only)

    def test_telemetry_uses_explicit_stable_sha(self):
        text = TELEMETRY.read_text(encoding="utf-8")
        self.assertIn('SOURCE_SHA_HINT=${ORDAX_SOURCE_SHA:-}', text)
        source = text.split('source_sha=""', 1)[1].split("update_status=", 1)[0]
        self.assertIn("stable-mvp)", source)
        self.assertIn("source_sha=$SOURCE_SHA_HINT", source)
        self.assertIn("owner-development)", source)
        self.assertIn("rev-parse HEAD", source)

    def test_contract_marks_signed_polling_materialization_and_portable_activation(self):
        stable = CONTRACT["profiles"]["stable-mvp"]
        self.assertEqual(stable["mvp_execution_mode"], "usb-only")
        self.assertFalse(stable["native_install_capability_enabled"])
        self.assertFalse(stable["internal_disk_destructive_write_allowed"])
        self.assertTrue(stable["runtime_profile_selection_implemented"])
        self.assertEqual(stable["runtime_layout_default"], "legacy-tree")
        self.assertEqual(stable["runtime_layouts_supported"], ["legacy-tree", "portable-v2"])
        self.assertTrue(stable["portable_v2_runtime_layout_support_implemented"])
        self.assertEqual(
            stable["portable_v2_runtime_identity_source"],
            "verified-boot-handoff-source-sha",
        )
        self.assertFalse(stable["portable_v2_legacy_current_symlink_required"])
        self.assertTrue(stable["portable_v2_update_activation_connected"])
        self.assertEqual(
            stable["portable_v2_update_activation_mode"],
            "signed-v3-one-shot-reboot-cold-health",
        )
        self.assertTrue(stable["portable_v2_update_requires_reboot"])
        self.assertTrue(stable["portable_v2_candidate_rejected_sha_persisted"])
        self.assertFalse(stable["portable_v2_candidate_rearm_same_sha_allowed"])
        self.assertFalse(stable["portable_v2_guardian_refresh_via_legacy_swap_allowed"])
        self.assertFalse(stable["git_update_polling_enabled"])
        self.assertFalse(stable["development_git_rescue_enabled"])
        self.assertFalse(stable["development_base_channel_enabled"])
        self.assertTrue(stable["continuous_signed_runtime_update_connected"])
        self.assertFalse(stable["base_update_owner_active"])
        self.assertEqual(
            stable["base_update_owner_activation_gate"],
            "stable-base-signed-update-integration",
        )
        self.assertTrue(stable["signed_release_discovery_implemented"])
        self.assertTrue(stable["signed_release_discovery_source_implemented"])
        self.assertFalse(stable["signed_release_discovery_physical_agent_ready"])
        self.assertTrue(stable["signed_release_discovery_asset_published"])
        self.assertTrue(stable["signed_release_seed_media_includes_inspect"])
        self.assertFalse(stable["signed_release_discovery_downloads_artifact"])
        self.assertFalse(stable["signed_release_discovery_changes_current"])
        self.assertTrue(stable["periodic_signed_channel_polling_connected"])
        self.assertEqual(stable["periodic_signed_channel_default_seconds"], 60)
        self.assertTrue(stable["signed_release_materialization_connected"])
        self.assertTrue(stable["signed_release_materialization_exact_commit_required"])
        self.assertFalse(stable["signed_release_staging_changes_current"])
        self.assertFalse(stable["signed_release_staging_activation_performed"])
        self.assertTrue(stable["signed_release_activation_connected"])
        self.assertTrue(stable["continuous_signed_runtime_update_connected"])
        self.assertTrue(stable["staged_release_health_connected"])
        self.assertTrue(stable["staged_release_health_requires_candidate_sha_match"])
        self.assertTrue(stable["staged_release_health_requires_process_survival"])
        self.assertTrue(stable["staged_release_health_requires_heartbeat"])
        self.assertTrue(stable["staged_release_health_requires_known_good_restore"])
        self.assertFalse(stable["staged_release_health_changes_current"])
        self.assertFalse(stable["staged_release_health_activation_performed"])
        self.assertTrue(stable["exact_release_activation_primitive_implemented"])
        self.assertTrue(stable["exact_release_activation_supervisor_connected"])
        self.assertTrue(stable["exact_release_activation_seed_media_includes_primitive"])
        self.assertEqual(
            stable["exact_release_activation_physical_agent_target_sha256"],
            "721f8a3fcec1ccfd2dd75c4d633ff2efd960909287c5e11fcf9abf19e5372740",
        )
        self.assertTrue(stable["exact_release_activation_asset_published"])
        self.assertTrue(stable["activation_requires_staged_sha_equals_health_ready_sha"])
        self.assertTrue(stable["activation_guard_persisted_before_current_swap"])
        self.assertTrue(stable["activated_release_requires_cold_health"])
        self.assertTrue(stable["activated_release_failure_rolls_back_exact_previous_commit"])
        self.assertTrue(stable["activation_and_rollback_require_no_git"])
        self.assertTrue(stable["activation_and_rollback_require_no_network"])
        self.assertTrue(stable["guardian_rebinds_source_identity_from_current"])
        self.assertEqual(
            CONTRACT["next_gate"]["id"],
            "stable-base-signed-update-integration",
        )


if __name__ == "__main__":
    unittest.main()
