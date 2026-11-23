#!/usr/bin/env python3
"""Regress the crash-safe Stable/MVP exact activation transaction."""

from __future__ import annotations

from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
ENTRYPOINT = ROOT / "system" / "entrypoint"
SUPERVISOR = ROOT / "system" / "supervisor"


def function_body(text: str, name: str) -> str:
    marker = f"{name}() {{"
    return text.split(marker, 1)[1].split("\n}", 1)[0]


class StableReleaseActivationTransactionTests(unittest.TestCase):
    def test_shell_boundaries_are_valid(self):
        subprocess.run(["sh", "-n", str(ENTRYPOINT)], check=True)
        subprocess.run(["sh", "-n", str(SUPERVISOR)], check=True)

    def test_guardian_derives_stable_identity_from_current_symlink(self):
        text = ENTRYPOINT.read_text(encoding="utf-8")
        resolver = function_body(text, "stable_current_release_sha")
        self.assertIn("current=$STABLE_ROOT/current", resolver)
        self.assertIn('[ -L "$current" ]', resolver)
        self.assertIn('releases/*)', resolver)
        self.assertIn('[ -x "$STABLE_ROOT/releases/$value/system/entrypoint" ]', resolver)

        stable_runtime = function_body(text, "stable_release_identity_sha")
        self.assertIn("legacy-tree)", stable_runtime)
        self.assertIn("stable_current_release_sha", stable_runtime)
        self.assertIn("portable-v2)", stable_runtime)
        self.assertIn("portable_stable_source_sha", stable_runtime)

        runtime = function_body(text, "runtime_source_sha")
        self.assertIn("stable_release_identity_sha", runtime)

        refresh = text.split('if [ "$supervisor_rc" -eq 75 ]; then', 1)[1].split(
            "\n    fi",
            1,
        )[0]
        self.assertIn("legacy-tree)", refresh)
        self.assertIn("stable_current_release_sha", refresh)
        self.assertIn("ORDAX_SOURCE_SHA=$SOURCE_SHA_HINT", refresh)
        self.assertIn("SYSTEM_ROOT=$STABLE_ROOT/current/system", refresh)
        self.assertIn("portable-v2)", refresh)
        self.assertIn("portable-v2 guardian refresh is blocked", refresh)
        self.assertIn('exec "$SYSTEM_ENTRYPOINT"', refresh)

    def test_stable_current_sha_tracks_symlink_not_inherited_hint(self):
        text = SUPERVISOR.read_text(encoding="utf-8")
        resolver = function_body(text, "stable_current_release_sha")
        self.assertIn("current=$STABLE_ROOT/current", resolver)
        current = function_body(text, "current_sha")
        self.assertIn("stable_release_identity_sha", current)

        stable_runtime = function_body(text, "stable_release_identity_sha")
        legacy_case = stable_runtime.split("legacy-tree)", 1)[1].split(";;", 1)[0]
        portable_case = stable_runtime.split("portable-v2)", 1)[1].split(";;", 1)[0]
        self.assertIn("stable_current_release_sha", legacy_case)
        self.assertNotIn("SOURCE_SHA_HINT", legacy_case)
        self.assertIn("portable_stable_source_sha", portable_case)

    def test_portable_v2_identity_is_verified_boot_hint_not_legacy_symlink(self):
        for path in (ENTRYPOINT, SUPERVISOR):
            text = path.read_text(encoding="utf-8")
            self.assertIn('STABLE_LAYOUT=${ORDAX_STABLE_LAYOUT:-legacy-tree}'.replace("\\", ""), text)
            portable = function_body(text, "portable_stable_source_sha")
            self.assertIn('[ "$PRODUCT_MODE" = "usb" ]', portable)
            self.assertIn('is_sha "$SOURCE_SHA_HINT"', portable)
            self.assertNotIn("$STABLE_ROOT/current", portable)
            self.assertNotIn("readlink", portable)

        guardian = ENTRYPOINT.read_text(encoding="utf-8")
        startup = guardian.split('case "$PRODUCT_MODE" in', 1)[1]
        stable_profile = startup.split("stable-mvp)", 1)[1].split("\n    *)", 1)[0]
        self.assertIn("portable-v2)", stable_profile)
        self.assertIn("portable_stable_source_sha", stable_profile)
        portable_branch = stable_profile.split("portable-v2)", 1)[1].split(";;", 1)[0]
        self.assertNotIn("SYSTEM_ROOT=$STABLE_ROOT/current/system", portable_branch)

        supervisor = SUPERVISOR.read_text(encoding="utf-8")
        update = function_body(supervisor, "check_for_update")
        portable_update = update.split("portable-v2)", 1)[1].split(";;", 1)[0]
        self.assertIn('check_stable_portable_update "$current"', portable_update)
        self.assertNotIn("check_stable_signed_update", portable_update)
        self.assertNotIn("activate-exact", portable_update)

    def test_portable_update_selects_v3_or_v4_then_arms_one_shot_boot(self):
        text = SUPERVISOR.read_text(encoding="utf-8")
        check = function_body(text, "check_stable_portable_update")
        verify = function_body(text, "portable_release_is_verified")
        materialize = function_body(text, "portable_materialize_release")

        self.assertIn('"$STABLE_RELEASE_AGENT" inspect', check)
        self.assertIn("manifest_schema", check)
        self.assertIn('portable_release_schema_supported "$remote_manifest_schema"', check)
        self.assertIn('portable_release_is_verified "$remote_sha" "$remote_manifest_schema"', check)
        self.assertIn(
            'portable_materialize_release "$remote_sha" "$remote_manifest_schema" "$channel_url"',
            check,
        )
        self.assertIn("verify-portable-v3-exact", verify)
        self.assertIn("verify-portable-v4-exact", verify)
        self.assertIn("materialize-portable-v3", materialize)
        self.assertIn("materialize-portable-v4", materialize)
        self.assertIn("materialized-portable-v3", materialize)
        self.assertIn("materialized-portable-v4", materialize)
        self.assertIn('--expected-commit "$expected_sha"', materialize)
        self.assertIn('portable_prepare_candidate "$remote_sha"', check)
        self.assertIn('write_state_value "$STAGED_RELEASE_FILE" "$remote_sha"', check)
        self.assertIn("candidate-armed signed-release", check)
        self.assertNotIn("portable_reboot_now", check)
        self.assertNotIn("git ", check.lower())
        self.assertNotIn("activate-exact", check)

    def test_portable_v4_current_blocks_remote_v3_downgrade(self):
        text = SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn(
            'PORTABLE_RELEASE_MANIFEST_SCHEMA=${ORDAX_RELEASE_MANIFEST_SCHEMA:-}',
            text,
        )
        check = function_body(text, "check_stable_portable_update")
        self.assertIn('[ "$PORTABLE_RELEASE_MANIFEST_SCHEMA" = "4" ]', check)
        self.assertIn(
            '[ "$remote_manifest_schema" != "prototype-ordax.release-manifest/4" ]',
            check,
        )
        self.assertIn('"portable-release-schema-downgrade-blocked"', check)
        downgrade = check.index('"portable-release-schema-downgrade-blocked"')
        materialize = check.index(
            'portable_materialize_release "$remote_sha" "$remote_manifest_schema" "$channel_url"'
        )
        self.assertLess(downgrade, materialize)

    def test_portable_candidate_commits_only_after_cold_health(self):
        text = SUPERVISOR.read_text(encoding="utf-8")
        handler = function_body(text, "handle_portable_candidate_boot")
        self.assertIn('[ "$PORTABLE_BOOT_SLOT" = "candidate" ]', handler)
        self.assertIn("surface_stays_running 4", handler)
        self.assertIn(
            'wait_for_surface_health "$candidate_sha" "$INITIAL_SURFACE_HEALTH_TIMEOUT"',
            handler,
        )
        self.assertIn('portable_commit_candidate "$candidate_sha"', handler)
        self.assertIn('record_applied "$candidate_sha" signed-release', handler)
        self.assertIn("ORDAX_PORTABLE_COLD_HEALTH_COMMIT=%s\\n", handler)
        self.assertIn(">/dev/console", handler)
        self.assertIn('portable_rollback_candidate "$candidate_sha"', handler)
        self.assertIn('write_state_value "$STABLE_HEALTH_REJECTED_FILE" "$candidate_sha"', handler)
        self.assertIn("portable_reboot_now", handler)

        health = handler.index(
            'wait_for_surface_health "$candidate_sha" "$INITIAL_SURFACE_HEALTH_TIMEOUT"'
        )
        commit = handler.index('portable_commit_candidate "$candidate_sha"')
        self.assertLess(health, commit)

    def test_portable_activation_helper_is_retained_from_verified_initramfs(self):
        text = SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn(
            'PORTABLE_STATE_HELPER=${ORDAX_PORTABLE_STATE_HELPER:-/run/ordax/bootstrap-tools/ordax-portable-state}',
            text,
        )
        ready = function_body(text, "portable_state_helper_ready")
        self.assertIn('[ -x "$PORTABLE_STATE_HELPER" ]', ready)
        self.assertIn('[ ! -L "$PORTABLE_STATE_HELPER" ]', ready)

    def test_portable_failed_sha_is_blocked_until_channel_advances(self):
        text = SUPERVISOR.read_text(encoding="utf-8")
        check = function_body(text, "check_stable_portable_update")
        self.assertIn('rejected_sha=$(portable_rejected_sha || true)', check)
        self.assertIn('[ "$remote_sha" = "$rejected_sha" ]', check)
        self.assertIn('"stable-release-health-rejected"', check)
        self.assertIn('rm -f "$STABLE_HEALTH_REJECTED_FILE"', check)

    def test_guard_is_persisted_before_exact_activation(self):
        text = SUPERVISOR.read_text(encoding="utf-8")
        guard = function_body(text, "write_stable_activation_guard")
        self.assertIn('printf \'%s %s %s', guard)
        self.assertIn('mv -f "$temporary" "$STABLE_ACTIVATION_GUARD_FILE"', guard)
        self.assertIn("/bin/busybox sync", guard)

        activate = function_body(text, "activate_health_ready_stable_release")
        staged = 'staged_sha=$(read_state_value "$STAGED_RELEASE_FILE")'
        ready = 'ready_sha=$(read_state_value "$STABLE_HEALTH_READY_FILE")'
        staged_match = '[ "$staged_sha" = "$candidate_sha" ]'
        ready_match = '[ "$ready_sha" = "$candidate_sha" ]'
        write_guard = 'write_stable_activation_guard "$previous_sha" "$candidate_sha" "$attempt_id"'
        swap = 'stable_activate_exact_to "$candidate_sha" "$STABLE_ACTIVATION_RECEIPT"'
        for needle in (staged, ready, staged_match, ready_match, write_guard, swap):
            self.assertIn(needle, activate)
        self.assertLess(activate.index(staged_match), activate.index(write_guard))
        self.assertLess(activate.index(ready_match), activate.index(write_guard))
        self.assertLess(activate.index(write_guard), activate.index(swap))

    def test_exact_activation_helper_has_no_network_or_git(self):
        text = SUPERVISOR.read_text(encoding="utf-8")
        helper = function_body(text, "stable_activate_exact_to")
        self.assertIn('"$STABLE_RELEASE_AGENT" activate-exact', helper)
        self.assertIn('--trust "$STABLE_TRUST_FILE"', helper)
        self.assertIn('--root "$STABLE_ROOT"', helper)
        self.assertIn('--expected-commit "$expected_sha"', helper)
        self.assertNotIn("--envelope-url", helper)
        self.assertNotIn("ls-remote", helper)
        self.assertNotIn("fetch ", helper)
        self.assertNotIn("git ", helper.lower())

    def test_ambiguous_activation_is_recovered_by_guard(self):
        text = SUPERVISOR.read_text(encoding="utf-8")
        activate = function_body(text, "activate_health_ready_stable_release")
        self.assertIn('active_sha=$(stable_current_release_sha', activate)
        self.assertIn('[ "$active_sha" = "$previous_sha" ]', activate)
        self.assertIn('[ "$active_sha" != "$candidate_sha" ]', activate)
        self.assertIn(
            "transaction guard will arbitrate cold health",
            activate,
        )
        self.assertIn("exit 75", activate)

    def test_cold_health_commits_candidate_only_after_exact_sha_handshake(self):
        text = SUPERVISOR.read_text(encoding="utf-8")
        handler = function_body(text, "handle_stable_activation_guard")
        self.assertIn('[ "$initial_sha_value" = "$guard_candidate" ]', handler)
        self.assertIn("surface_stays_running 4", handler)
        self.assertIn(
            'wait_for_surface_health "$guard_candidate" "$SURFACE_HEALTH_TIMEOUT"',
            handler,
        )
        self.assertIn('record_applied "$guard_candidate" signed-release', handler)
        self.assertIn('record_runtime_surface_sha "$guard_candidate"', handler)
        self.assertIn('"$STABLE_ACTIVATION_GUARD_FILE"', handler)
        wait = handler.index(
            'wait_for_surface_health "$guard_candidate" "$SURFACE_HEALTH_TIMEOUT"'
        )
        committed = handler.index('record_applied "$guard_candidate" signed-release')
        self.assertLess(wait, committed)

    def test_failed_cold_health_uses_exact_offline_rollback(self):
        text = SUPERVISOR.read_text(encoding="utf-8")
        rollback = function_body(text, "rollback_stable_activation")
        self.assertIn(
            'stable_activate_exact_to "$previous_sha" "$STABLE_ROLLBACK_RECEIPT"',
            rollback,
        )
        self.assertIn(
            '[ "$rollback_sha" != "$previous_sha" ]',
            rollback,
        )
        self.assertIn(
            '[ "$rollback_previous" != "$failed_sha" ]',
            rollback,
        )
        self.assertIn(
            'write_state_value "$STABLE_HEALTH_REJECTED_FILE" "$failed_sha"',
            rollback,
        )
        self.assertIn('rm -f "$STABLE_HEALTH_READY_FILE" "$STABLE_ACTIVATION_GUARD_FILE"', rollback)
        self.assertIn("exit 75", rollback)
        self.assertNotIn("reset --hard", rollback)
        self.assertNotIn("ls-remote", rollback)
        self.assertNotIn("--envelope-url", rollback)

    def test_stable_transaction_guard_precedes_legacy_git_guard(self):
        text = SUPERVISOR.read_text(encoding="utf-8")
        stable = (
            'if [ "$DISTRIBUTION_PROFILE" = "stable-mvp" ] && '
            '[ -s "$STABLE_ACTIVATION_GUARD_FILE" ]; then'
        )
        legacy = 'elif [ -s "$SUPERVISOR_GUARD_FILE" ]; then'
        self.assertIn(stable, text)
        self.assertIn(legacy, text)
        self.assertLess(text.index(stable), text.index(legacy))

    def test_health_ready_state_is_the_only_activation_entry(self):
        text = SUPERVISOR.read_text(encoding="utf-8")
        check = function_body(text, "check_stable_signed_update")
        self.assertIn('ready_sha=$(read_state_value "$STABLE_HEALTH_READY_FILE")', check)
        self.assertIn('[ "$ready_sha" = "$remote_sha" ]', check)
        self.assertIn(
            'activate_health_ready_stable_release "$current" "$remote_sha"',
            check,
        )
        self.assertNotIn("activate-exact", check)


if __name__ == "__main__":
    unittest.main()
