import fcntl
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SYSTEM_ENTRYPOINT = ROOT / "system" / "entrypoint"
SYSTEM_SUPERVISOR = ROOT / "system" / "supervisor"
SURFACE_RUNTIME = ROOT / "system" / "surface" / "bin" / "ordax-surface"
NATIVE_HOST_SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
NATIVE_UPDATE_ADAPTER = ROOT / "system" / "adapters" / "native" / "update-runtime.mjs"
NATIVE_COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"
UPDATE_CONTROLS = ROOT / "system" / "surface" / "ui" / "update-controls.mjs"
SYSTEM_OVERVIEW = ROOT / "system" / "surface" / "ui" / "system-overview-controls.mjs"
UPDATE_PRESENTATION = ROOT / "system" / "services" / "update" / "presentation.mjs"
BASE_UPDATE_AGENT = ROOT / "system" / "services" / "base-update" / "agent.sh"
DEV_PULL = ROOT / "bootstrap" / "dev-base" / "ordax-pull"


class HotUpdateSupervisorContractTests(unittest.TestCase):
    def test_supervisor_shell_is_syntactically_valid(self):
        subprocess.run(["sh", "-n", str(SYSTEM_ENTRYPOINT)], check=True)
        subprocess.run(["sh", "-n", str(SYSTEM_SUPERVISOR)], check=True)
        subprocess.run(["sh", "-n", str(SURFACE_RUNTIME)], check=True)
        subprocess.run(["python3", "-m", "py_compile", str(NATIVE_HOST_SERVER)], check=True)

    def test_owner_first_poll_witness_is_bounded_diagnostic_not_update_authority(self):
        import json
        import re
        import shlex
        import stat

        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn(
            "OWNER_POLL_BOOT_FILE=$STATE_DIR/native-state/supervisor-boot-witness.json",
            text,
        )
        body = text.split("record_owner_poll_boot_stage() {", 1)[1].split("\n}\n", 1)[0]
        witness = "record_owner_poll_boot_stage() {" + body + "\n}\n"
        self.assertIn('[ "$DISTRIBUTION_PROFILE" = owner-development ] || return 0', witness)
        self.assertIn('[ "$OWNER_POLL_BOOT_FINISHED" -eq 0 ] || return 0', witness)
        self.assertIn('[ ! -L "$OWNER_POLL_BOOT_FILE" ]', witness)
        self.assertIn('witness_tmp=$OWNER_POLL_BOOT_FILE.tmp.$$', witness)
        self.assertIn('"ordax.owner-supervisor-first-poll/1"', witness)
        for forbidden in ("git ", "pull ", "reboot ", "mount ", "efi-updatevar", "activation_authorized"):
            self.assertNotIn(forbidden, witness)

        self.assertIn("record_owner_poll_boot_stage initialized", text)
        self.assertIn("record_owner_poll_boot_stage poll-loop-entered", text)
        self.assertIn("record_owner_poll_boot_stage first-run-pending", text)
        self.assertIn("record_owner_poll_boot_stage first-run-verified", text)
        self.assertIn("record_owner_poll_boot_stage git-remote-started", text)
        self.assertIn("record_owner_poll_boot_stage git-remote-failed", text)
        self.assertIn("record_owner_poll_boot_stage git-remote-completed", text)
        if not Path("/bin/busybox").exists():
            return  # Structural contract still applies to non-BusyBox hosts.
        with tempfile.TemporaryDirectory() as temporary:
            native = Path(temporary) / "native-state"
            native.mkdir()
            destination = native / "supervisor-boot-witness.json"
            script = (
                "set -eu\n"
                "utc_now() { printf '2026-10-20T00:00:00Z\\n'; }\n"
                "DISTRIBUTION_PROFILE=owner-development\n"
                f"OWNER_POLL_BOOT_FILE={shlex.quote(str(destination))}\n"
                'OWNER_POLL_BOOT_STAGE=""\n'
                "OWNER_POLL_BOOT_FINISHED=0\n"
                + witness
            )
            completed = script + "\n".join(
                f"record_owner_poll_boot_stage {stage}"
                for stage in (
                    "initialized", "poll-loop-entered", "first-run-pending",
                    "first-run-verified", "git-remote-started", "git-remote-completed",
                    "first-run-pending",
                )
            )
            execution = subprocess.run(
                ["/bin/sh", "-c", completed + '\nprintf "WITNESS_TMP=%s\\n" "$witness_tmp"\n'],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertRegex(
                execution.stdout,
                r"WITNESS_TMP=" + re.escape(str(destination)) + r"\.tmp\.[0-9]+",
            )
            self.assertEqual(stat.S_IMODE(destination.stat().st_mode), 0o600)
            self.assertFalse(list(native.glob("supervisor-boot-witness.json.tmp.*")))
            result = json.loads(destination.read_text(encoding="utf-8"))
            self.assertEqual(result["schema"], "ordax.owner-supervisor-first-poll/1")
            self.assertEqual(result["stage"], "git-remote-completed")
            self.assertEqual(result["observedAt"], "2026-10-20T00:00:00Z")
            outside = Path(temporary) / "sentinel"
            outside.write_text("untouched", encoding="utf-8")
            destination.unlink()
            destination.symlink_to(outside)
            subprocess.run(["/bin/sh", "-c", script + "record_owner_poll_boot_stage initialized\n"], check=True)
            self.assertTrue(destination.is_symlink())
            self.assertEqual(outside.read_text(encoding="utf-8"), "untouched")

    def test_supervisor_polls_git_without_rebooting_for_normal_updates(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn('UPDATE_INTERVAL=${ORDAX_UPDATE_INTERVAL_SECONDS:-5}', text)
        self.assertIn('REMOTE_TIMEOUT=${ORDAX_REMOTE_TIMEOUT_SECONDS:-20}', text)
        self.assertIn('FETCH_TIMEOUT=${ORDAX_FETCH_TIMEOUT_SECONDS:-45}', text)
        self.assertIn('STAGE_TIMEOUT=${ORDAX_STAGE_TIMEOUT_SECONDS:-8}', text)
        self.assertIn('GIT_LOW_SPEED_TIME=${ORDAX_GIT_LOW_SPEED_SECONDS:-15}', text)
        self.assertIn('SURFACE_HEALTH_TIMEOUT=${ORDAX_SURFACE_HEALTH_TIMEOUT_SECONDS:-30}', text)
        self.assertIn('INITIAL_SURFACE_HEALTH_TIMEOUT=${ORDAX_INITIAL_SURFACE_HEALTH_TIMEOUT_SECONDS:-30}', text)
        self.assertIn('RELOAD_HEALTH_TIMEOUT=${ORDAX_RELOAD_HEALTH_TIMEOUT_SECONDS:-8}', text)
        self.assertIn('RELOAD_FALLBACK_HEALTH_TIMEOUT=${ORDAX_RELOAD_FALLBACK_HEALTH_TIMEOUT_SECONDS:-$SURFACE_HEALTH_TIMEOUT}', text)
        self.assertIn('GIT_TERMINAL_PROMPT=0', text)
        self.assertIn('run_bounded_git "$REMOTE_TIMEOUT" -C "$WORKTREE" ls-remote', text)
        self.assertIn('apply_remote_checkout "$old_sha" "$remote_sha"', text)
        self.assertIn('PULL_BIN=${ORDAX_PULL_BIN:-/usr/local/bin/ordax-pull}', text)
        self.assertIn("classify_changes", text)
        self.assertIn("APPLY_MODE=reload", text)
        self.assertIn("APPLY_MODE=surface-restart", text)
        self.assertIn("APPLY_MODE=supervisor-restart", text)
        self.assertNotIn("poweroff -f", text)

        # Owner/Development live updates remain rebootless. The single reboot
        # primitive belongs only to immutable Portable Stable activation.
        self.assertEqual(text.count("reboot -f"), 1)
        portable_reboot = text.split("portable_reboot_now() {", 1)[1].split("\n}", 1)[0]
        self.assertIn("/bin/busybox reboot -f", portable_reboot)
        for owner_function in (
            "apply_remote_checkout",
            "stage_candidate_release",
            "classify_changes",
            "apply_update",
        ):
            marker = f"{owner_function}() {{"
            if marker not in text:
                continue
            body = text.split(marker, 1)[1].split("\n}", 1)[0]
            self.assertNotIn("reboot -f", body, owner_function)

    def test_surface_health_recovery_is_bounded_to_seconds_not_minutes(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn(
            'SURFACE_HEALTH_TIMEOUT=${ORDAX_SURFACE_HEALTH_TIMEOUT_SECONDS:-30}',
            text,
        )
        self.assertIn(
            'INITIAL_SURFACE_HEALTH_TIMEOUT=${ORDAX_INITIAL_SURFACE_HEALTH_TIMEOUT_SECONDS:-30}',
            text,
        )
        self.assertIn(
            '[ "$SURFACE_HEALTH_TIMEOUT" -ge 15 ] 2>/dev/null || SURFACE_HEALTH_TIMEOUT=30',
            text,
        )
        self.assertIn(
            '[ "$INITIAL_SURFACE_HEALTH_TIMEOUT" -ge 15 ] 2>/dev/null || INITIAL_SURFACE_HEALTH_TIMEOUT=30',
            text,
        )
        self.assertNotIn(
            'SURFACE_HEALTH_TIMEOUT=${ORDAX_SURFACE_HEALTH_TIMEOUT_SECONDS:-180}',
            text,
        )
        self.assertNotIn(
            'INITIAL_SURFACE_HEALTH_TIMEOUT=${ORDAX_INITIAL_SURFACE_HEALTH_TIMEOUT_SECONDS:-180}',
            text,
        )
    def test_remote_main_behind_current_checkout_is_not_treated_as_an_update(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        check = text.split("check_for_update() {", 1)[1].split("\n}\n", 1)[0]
        guard_start = 'if "$GIT_BIN" -C "$WORKTREE" cat-file -e "$remote_sha^{commit}"'
        ancestor_check = (
            '"$GIT_BIN" -C "$WORKTREE" merge-base --is-ancestor '
            '"$remote_sha" "$current"'
        )
        self.assertIn(guard_start, check)
        self.assertIn(ancestor_check, check)
        guard_pos = check.index(guard_start)
        old_sha_pos = check.index("    old_sha=$current")
        self.assertLess(guard_pos, old_sha_pos)
        behind = check[guard_pos:old_sha_pos]
        self.assertIn('refresh_dev_helpers "$current"', behind)
        self.assertIn("clear_update_context", behind)
        self.assertIn('write_update_state "$current" running none', behind)
        self.assertIn("return 0", behind)
        self.assertNotIn("apply_remote_checkout", behind)
        self.assertNotIn("fetch --no-tags", behind)
    def test_git_update_operations_are_bounded(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn('/bin/busybox setsid /bin/sh -c', text)
        self.assertIn('wait "$watchdog_pid" 2>/dev/null || true', text)
        self.assertIn('kill -TERM "-$$"', text)
        self.assertIn('-c http.lowSpeedLimit=1', text)
        self.assertIn('-c "http.lowSpeedTime=$GIT_LOW_SPEED_TIME"', text)
        self.assertIn('remote check failed or timed out after ${REMOTE_TIMEOUT}s', text)
        self.assertIn('Git fetch failed or timed out after ${FETCH_TIMEOUT}s', text)
        self.assertIn('write_update_state "$current" network-error none', text)
        self.assertIn('write_update_state "$old_sha" pull-error none', text)

    def test_hot_update_checkout_transaction_has_one_atomic_owner(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        pull = DEV_PULL.read_text(encoding="utf-8")
        self.assertIn("apply_remote_checkout()", text)
        self.assertIn('fetch --no-tags origin', text)
        self.assertIn('merge-base --is-ancestor "$checkout_previous_sha" "$checkout_target_sha"', text)
        self.assertIn('PULL_BIN=${ORDAX_PULL_BIN:-/usr/local/bin/ordax-pull}', text)
        self.assertIn('ORDAX_EXPECTED_SHA="$checkout_target_sha"', text)
        self.assertIn('"$PULL_BIN" >>"$UPDATE_LOG" 2>&1', text)
        apply = text.split("apply_remote_checkout() {", 1)[1].split("\n}\n\n/bin/busybox mkdir -p", 1)[0]
        self.assertNotIn('reset --hard "$expected_sha"', apply)
        self.assertNotIn('sparse-checkout set --no-cone', apply)
        self.assertNotIn("repair_dirty_checkout", apply)
        self.assertIn("replace_runtime_checkout()", pull)
        self.assertIn('mv "$WORKTREE" "$retired"', pull)
        self.assertIn('mv "$stage" "$WORKTREE"', pull)
        self.assertIn('EXPECTED_SHA=${ORDAX_EXPECTED_SHA:-}', pull)
        self.assertIn('checkout_target_sha=$2', apply)
        self.assertIn('checkout_fetched_sha', apply)
        self.assertIn('CHECKOUT_ERROR=handoff-target-mutation', apply)
        base_progress = text.split("derive_base_update_progress() {", 1)[1].split("\n}\n", 1)[0]
        self.assertIn("base_progress_target_sha=$1", base_progress)
        self.assertNotIn("expected_sha=$1", base_progress)
        self.assertIn('PULL_PHASE=handoff-validation', pull)
        self.assertIn('[ "$cached_main" != "$EXPECTED_SHA" ]', pull)
        self.assertIn('cat-file -e "$EXPECTED_SHA^{commit}"', pull)
        # Supervisor-owned delivery uses local fetched Git objects only.
        # Remote discovery remains available solely to standalone Pull.
        self.assertIn('if remote_sha=$(remote_main_sha "$REMOTE_STDERR_FILE"); then', pull)
        self.assertIn('PULL_PHASE=$(remote_failure_phase "$REMOTE_STDERR_FILE")', pull)
        self.assertIn('PULL_PHASE=handoff-ref-mismatch', pull)
        self.assertNotIn('remote_sha=$(remote_main_sha || true)', pull)
        self.assertIn('checkout local sera preservado', pull)

    def test_pull_error_stage_and_committed_helper_receipt_are_consistent(self):
        supervisor = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        pull = DEV_PULL.read_text(encoding="utf-8")
        # A stale volatile stage cannot be associated with another attempt.
        self.assertIn('PULL_RESULT_FILE=$UPDATE_RUN_DIR/pull-result', supervisor)
        self.assertIn('rm -f "$PULL_RESULT_FILE"', supervisor)
        self.assertIn('PULL_RESULT_FILE=$RUN_DIR/pull-result', pull)
        self.assertIn('trap \'record_pull_exit "$?"\' EXIT', pull)
        self.assertIn('PULL_PHASE=helper-refresh', pull)
        self.assertIn('refresh_dev_helpers "$current" || exit 1', pull)
        self.assertIn('CHECKOUT_ERROR="pull-$checkout_pull_phase-failed"', supervisor)
        # Atomic source checkout is durable before helper activation, so the
        # displayed sourceSha must reflect the actual checkout on error.
        self.assertIn('active_after_failure=$(current_sha)', supervisor)
        self.assertIn('[ "$active_after_failure" = "$remote_sha" ]', supervisor)
        self.assertIn('write_update_state "$active_after_failure" pull-error none', supervisor)
        # Never mark this SHA healthy until canonical installed helpers agree.
        self.assertIn('helper_sha=$(read_state_value "$DEV_HELPERS_SHA_FILE")', supervisor)
        self.assertIn('[ "$helper_sha" != "$current" ]', supervisor)
        self.assertIn('set_update_context error "$current" "" "helper-refresh-failed"', supervisor)

    def test_dirty_runtime_checkout_is_diagnosed_and_atomically_replaced_by_pull_owner(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        pull = DEV_PULL.read_text(encoding="utf-8")
        self.assertNotIn("record_dirty_checkout()", text)
        self.assertNotIn("repair_dirty_checkout()", text)
        self.assertIn("DIRTY_CHECKOUT_DIR=$STATE_DIR/dirty-checkout", pull)
        self.assertIn("record_dirty_checkout()", pull)
        self.assertIn('diff --binary --no-ext-diff HEAD', pull)
        self.assertIn('replace_runtime_checkout "$remote_sha" dirty', pull)
        self.assertIn("checkout local alterado; substituindo cache por clone limpo validado", pull)

    def test_candidate_is_preflighted_before_live_checkout_switch(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("validate_candidate_tree()", text)
        self.assertIn('show "$candidate_sha:$candidate_path"', text)
        self.assertIn('cat-file -e "$candidate_sha:$candidate_path"', text)
        self.assertIn('ls-tree "$candidate_sha" -- "$candidate_path"', text)
        self.assertIn('candidate_shell_is_valid "$candidate_sha" system/supervisor', text)
        self.assertIn("candidate-preflight-failed", text)
        self.assertIn('reason=${CHECKOUT_ERROR:-checkout-failed}', text)
        self.assertIn('temporary=$UPDATE_RUN_DIR/candidate-shell.tmp', text)
        self.assertLess(
            text.index('validate_candidate_tree "$checkout_target_sha"'),
            text.index('ORDAX_EXPECTED_SHA="$checkout_target_sha"'),
        )

    def test_common_reload_path_uses_fast_staged_preflight(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn('classify_changes "$checkout_previous_sha" "$checkout_target_sha"', text)
        self.assertIn('validate_candidate_tree "$checkout_target_sha" "$APPLY_MODE"', text)
        self.assertLess(
            text.index('classify_changes "$checkout_previous_sha" "$checkout_target_sha"'),
            text.index('ORDAX_EXPECTED_SHA="$checkout_target_sha"'),
        )
        candidate = text.split("validate_candidate_tree() {", 1)[1].split(
            "surface-restart|supervisor-restart)", 1
        )[0]
        self.assertIn("reload)", candidate)
        self.assertIn(
            'candidate_path_exists "$candidate_sha" system/composition/native/main.mjs',
            candidate,
        )
        self.assertNotIn("candidate_shell_is_valid", candidate)
        self.assertIn(
            'wait_for_surface_health "$new_sha" "$RELOAD_HEALTH_TIMEOUT"',
            text,
        )
        self.assertIn('validate_updated_tree "$APPLY_MODE"', text)

    def test_candidate_release_is_staged_before_live_checkout_switch(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn('RELEASES_DIR=${ORDAX_RELEASES_DIR:-$STATE_DIR/releases}', text)
        self.assertIn('STAGED_RELEASE_FILE=$STATE_DIR/staged-release-sha', text)
        self.assertIn('STAGE_TIMEOUT=${ORDAX_STAGE_TIMEOUT_SECONDS:-8}', text)
        self.assertIn("stage_candidate_release()", text)
        self.assertIn("staged_release_tree_is_valid()", text)
        self.assertIn(
            'archive --format=tar "$candidate_sha" system >"$stage_archive"',
            text,
        )
        self.assertIn(
            '/bin/busybox timeout -k 2 "$STAGE_TIMEOUT" /bin/busybox tar -xf',
            text,
        )
        self.assertIn('write_state_value "$STAGED_RELEASE_FILE" "$candidate_sha"', text)
        self.assertIn('CHECKOUT_ERROR=candidate-stage-failed', text)
        self.assertLess(
            text.index('stage_candidate_release "$checkout_target_sha" "$APPLY_MODE"'),
            text.index('ORDAX_EXPECTED_SHA="$checkout_target_sha"'),
        )

    def test_runtime_neutral_update_does_not_materialize_a_release_slot(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        staging = text.split("stage_candidate_release() {", 1)[1].split("\n}\n", 1)[0]
        self.assertIn('if [ "$candidate_mode" = none ]; then', staging)
        self.assertIn('write_state_value "$LAST_STAGE_DURATION_FILE" "0"', staging)
        self.assertIn("return 0", staging)
        self.assertNotIn("fetch --no-tags", staging)
        self.assertNotIn("ls-remote", staging)

    def test_runtime_neutral_main_change_is_not_recorded_as_notebook_application(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        apply_case = text.split('    case "$APPLY_MODE" in', 1)[1]
        none_block = apply_case.split('        none)\n', 1)[1].split('            ;;', 1)[0]
        self.assertNotIn('record_applied "$new_sha"', none_block)
        self.assertIn('rm -f "$ATTEMPT_STARTED_EPOCH_FILE"', none_block)
        self.assertIn('refresh_release_history', none_block)
        self.assertIn("repository update has no device delivery effect", none_block)
        self.assertIn("low-level delivery observed; application remains pending boot refresh", none_block)

    def test_live_reload_uses_lightweight_git_object_staging(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        staging = text.split("stage_candidate_release() {", 1)[1].split("\n}\n", 1)[0]
        reload_fast_path = staging.split('if [ "$candidate_mode" = reload ]; then', 1)[1].split("fi", 1)[0]
        self.assertIn('write_state_value "$STAGED_RELEASE_FILE" "$candidate_sha"', reload_fast_path)
        self.assertIn('write_state_value "$LAST_STAGE_DURATION_FILE" "0"', reload_fast_path)
        self.assertIn("live-safe candidate staged in fetched Git objects", reload_fast_path)
        self.assertIn("return 0", reload_fast_path)
        self.assertNotIn("archive --format=tar", reload_fast_path)
        self.assertNotIn("tar -xf", reload_fast_path)


    def test_update_latency_is_recorded_without_external_timing(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("LAST_APPLY_DURATION_FILE=$STATE_DIR/last-apply-duration-seconds", text)
        self.assertIn("LAST_STAGE_DURATION_FILE=$STATE_DIR/last-stage-duration-seconds", text)
        self.assertIn("ATTEMPT_STARTED_EPOCH_FILE=$UPDATE_RUN_DIR/attempt-started-epoch", text)
        self.assertIn("record_elapsed_seconds()", text)
        self.assertIn('write_state_value "$ATTEMPT_STARTED_EPOCH_FILE" "$(epoch_now)"', text)
        self.assertIn('record_elapsed_seconds "$attempt_started" "$LAST_APPLY_DURATION_FILE"', text)
        self.assertIn('record_elapsed_seconds "$stage_started" "$LAST_STAGE_DURATION_FILE"', text)
        self.assertIn('"lastApplyDurationSeconds":%s', text)
        self.assertIn('"lastStageDurationSeconds":%s', text)
        self.assertIn('"stagedReleaseSha":"%s"', text)

    def test_delivery_numbers_are_pr_independent_and_history_is_bounded(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        host = NATIVE_HOST_SERVER.read_text(encoding="utf-8")
        presentation = UPDATE_PRESENTATION.read_text(encoding="utf-8")
        overview = SYSTEM_OVERVIEW.read_text(encoding="utf-8")
        self.assertIn("delivery_number_for_sha()", text)
        self.assertIn('rev-list --first-parent --count "$DELIVERY_EPOCH_SHA..$source_sha"', text)
        self.assertIn("DELIVERY_EPOCH_NUMBER=220", text)
        self.assertIn("system boot bootstrap", text)
        self.assertIn(":(exclude,glob)system/**/*.md", text)
        self.assertIn(":(exclude,glob)boot/**/*.md", text)
        self.assertIn(":(exclude,glob)bootstrap/**/*.md", text)
        self.assertIn(":(exclude,glob)bootstrap/**/prove_*", text)
        self.assertNotIn("Merge pull request #", text)
        self.assertNotIn("version_number_for_sha()", text)
        self.assertIn("UPDATE_HISTORY_FILE=$STATE_DIR/native-state/update-history.tsv", text)
        self.assertIn("RELEASE_HISTORY_FILE=$STATE_DIR/native-state/release-history.tsv", text)
        self.assertIn("UPDATE_HISTORY_MAX_ENTRIES=200", text)
        self.assertIn("RELEASE_HISTORY_MAX_ENTRIES=80", text)
        self.assertIn("refresh_release_history()", text)
        self.assertIn("append_application_history()", text)
        self.assertIn('/bin/busybox tail -n "$UPDATE_HISTORY_MAX_ENTRIES"', text)
        self.assertIn('"deliveryNumber":%s', text)
        self.assertIn('"versionNumber":%s', text)
        self.assertIn('record_applied "$guard_current" supervisor-restart', text)
        self.assertIn("rolled-back", text)
        self.assertIn('UPDATE_HISTORY_PATH = "/__ordax/native/update-history"', host)
        self.assertIn('"deliveryNumber": version', host)
        self.assertIn("export function deliveryLabel", presentation)
        self.assertIn('t("system.overview.delivery.number"', overview)

    def test_surface_runs_continuous_fail_soft_ntp_sync(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("start_time_sync_agent()", text)
        self.assertIn("/bin/busybox ntpd -n", text)
        self.assertIn("-p time.cloudflare.com", text)
        self.assertIn("-p time.google.com", text)
        self.assertIn("-p pool.ntp.org", text)
        self.assertIn("TIME_SYNC_PID=$!", text)
        self.assertIn('"$POWER_BROKER_PID" "$KEYBOARD_SESSION_RESTART_BROKER_PID"', text)
        self.assertIn('"$NATIVE_INSTALL_BROKER_PID" "$NETWORK_BROKER_PID" "$TIME_SYNC_PID"', text)
        self.assertIn("quiesce_surface_children()", text)
        self.assertIn("quiesce_surface_children\n", text.split("cleanup() {", 1)[1])
        self.assertIn("automatic time synchronization unavailable; continuing Surface startup", text)

    def test_system_markdown_is_runtime_neutral_before_system_fallback(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        markdown = text.index("system/*.md|boot/*.md|bootstrap/*.md|boot/*/prove_*|bootstrap/*/prove_*)")
        next_case = text.index("boot/*|bootstrap/*)", markdown + 1)
        broad_system = text.index("system/*)", next_case + 1)
        self.assertLess(markdown, next_case)
        self.assertLess(next_case, broad_system)
        markdown_block = text[markdown:next_case]
        self.assertIn(";;", markdown_block)
        self.assertNotIn("surface_host_changed=1", markdown_block)
        self.assertNotIn("live_surface_changed=1", markdown_block)

    def test_live_safe_and_host_changes_have_distinct_apply_modes(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn(
            "system/apps/*|system/adapters/*|system/contracts/*|system/services/*|system/composition/*|system/surface/ui/*",
            text,
        )
        self.assertIn(
            "system/surface/bin/*|system/surface/runtime/*|system/surface/entrypoint",
            text,
        )
        self.assertIn("system/services/base-update/agent.sh", text)
        host_case = text.split(
            "system/surface/bin/*|system/surface/runtime/*|system/surface/entrypoint",
            1,
        )[1].split(";;", 1)[0]
        self.assertIn("system/services/base-update/agent.sh", host_case)
        self.assertIn("surface_host_changed=1", host_case)
        self.assertIn('log "live-safe system update applied; waiting for Surface health acknowledgement"', text)
        self.assertIn('log "native host update applied; restarting Surface only"', text)
        self.assertIn("exit 75", text)

    def test_base_update_agent_change_requires_surface_launcher_restart(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        classification = text.split("classify_changes() {", 1)[1].split(
            "check_for_update() {",
            1,
        )[0]
        host_case = classification.split(
            "system/services/base-update/agent.sh)",
            1,
        )[0]
        self.assertIn("surface_host_changed=1", classification)
        self.assertNotIn(
            "system/services/base-update/agent.sh",
            classification.split(
                "system/apps/*|system/adapters/*|system/contracts/*|system/services/*",
                1,
            )[1],
        )

    def test_git_owned_development_helpers_refresh_without_base_candidate(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        classification = text.split("classify_changes() {", 1)[1].split(
            "check_for_update() {",
            1,
        )[0]
        self.assertIn("dev-helper-manifest.tsv", classification)
        self.assertIn('show "$new_sha:system/services/base-update/dev-helper-manifest.tsv"', classification)
        self.assertIn("DEV_HELPERS_CHANGED=1", classification)
        self.assertLess(
            classification.index("dev-helper-manifest.tsv"),
            classification.index("boot/*|bootstrap/*)"),
        )
        self.assertNotIn("configure_runtime_sparse_checkout()", text)
        refresh = text.split("refresh_dev_helpers() {", 1)[1].split("\n}\n", 1)[0]
        self.assertIn('ORDAX_EXPECTED_SHA="$source_sha"', refresh)
        self.assertIn('"$PULL_BIN" >>"$UPDATE_LOG" 2>&1', refresh)
        self.assertIn("refresh_dev_helpers()", text)
        # Canonical ordax-pull owns initial helper installation, not the Supervisor.
        apply = text.split("apply_remote_checkout() {", 1)[1].split("\n}\n", 1)[0]
        self.assertNotIn('refresh_dev_helpers "$expected_sha"', apply)
        self.assertIn('refresh_dev_helpers "$current"', text)
        self.assertIn("DEV_HELPERS_SHA_FILE=$STATE_DIR/dev-helpers-sha", text)
        self.assertIn(
            "system/services/base-update/dev-helpers.sh",
            text,
        )

    def test_low_level_git_update_requests_exact_commit_base_without_host_python_dependency(self):
        supervisor = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        owner = BASE_UPDATE_AGENT.read_text(encoding="utf-8")

        self.assertIn("DEV_BASE_READY_FILE=$STATE_DIR/dev-base-ready-sha", supervisor)
        self.assertIn("DEV_BASE_REQUEST_FILE=$STATE_DIR/dev-base-request-sha", supervisor)
        self.assertIn("request_dev_base_candidate()", supervisor)
        self.assertIn('request_dev_base_candidate "$new_sha"', supervisor)
        self.assertIn('request_dev_base_candidate "$pending_boot_sha"', supervisor)
        self.assertIn(
            'write_state_value "$DEV_BASE_REQUEST_FILE" "$source_sha"',
            supervisor,
        )
        self.assertNotIn('/usr/bin/python3 "$DEV_BASE_CHANNEL"', supervisor)
        self.assertNotIn("DEV_BASE_CANDIDATE_ROOT=", supervisor)
        self.assertNotIn("DEV_BASE_CHANNEL=", supervisor)

        self.assertIn("prepare_dev_base_candidate()", owner)
        self.assertIn('DEV_BASE_REQUEST_FILE=$HOST_STATE_ROOT/dev-base-request-sha', owner)
        self.assertIn('/usr/bin/python3 "$channel"', owner)
        self.assertIn('--source-commit "$request_sha"', owner)
        self.assertIn('--destination-root "$destination"', owner)
        self.assertIn('--version-root "$version_root"', owner)
        self.assertIn("candidate not published yet", owner)
        self.assertIn("current runtime remains active", owner)

        request = supervisor.split("request_dev_base_candidate() {", 1)[1].split(
            "\n}",
            1,
        )[0]
        self.assertNotIn("python3", request)
        self.assertNotIn("reboot", request)
        self.assertNotIn("poweroff", request)

    def test_low_level_changes_are_marked_not_auto_rebooted(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("boot/*|bootstrap/*", text)
        self.assertIn("boot/*/prove_*|bootstrap/*/prove_*", text)
        self.assertLess(
            text.index("boot/*/prove_*|bootstrap/*/prove_*"),
            text.index("boot/*|bootstrap/*"),
        )
        self.assertIn("BOOT_REFRESH_FILE=$STATE_DIR/boot-refresh-required", text)
        self.assertIn("mark_boot_refresh_required", text)
        self.assertIn(
            "Base candidate acquisition is delegated to the replaceable base-update owner",
            text,
        )

    def test_rollback_pin_disables_automatic_pull(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("PINNED_FILE=$STATE_DIR/pinned-commit", text)
        self.assertIn("BOOT_REJECTED_FILE=$STATE_DIR/boot-rejected-commit", text)
        self.assertIn('if [ -s "$PINNED_FILE" ]', text)
        self.assertIn('write_update_state "$current" pinned none', text)

    def test_boot_rollback_pin_retries_only_after_remote_main_advances(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn('boot_rejected_sha=$(read_state_value "$BOOT_REJECTED_FILE")', text)
        self.assertIn('if [ "$remote_sha" = "$boot_rejected_sha" ]; then', text)
        self.assertIn('"boot-rollback-pinned"', text)
        self.assertIn('rm -f "$PINNED_FILE" "$BOOT_REJECTED_FILE"', text)
        self.assertIn("remote main advanced beyond boot-rejected", text)

    def test_failed_update_is_rolled_back_and_rejected(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("REJECTED_FILE=$STATE_DIR/rejected-commit", text)
        self.assertIn("rollback_update()", text)
        self.assertIn('reset --hard "$previous_sha"', text)
        self.assertIn('write_update_state "$previous_sha" rolled-back "$failed_mode"', text)
        self.assertIn('if [ -n "$rejected_sha" ] && [ "$remote_sha" = "$rejected_sha" ]', text)
        self.assertIn('write_update_state "$current" rejected none', text)
        self.assertIn("validate_updated_tree", text)

    def test_healthy_current_checkout_clears_stale_rejection(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn('healthy_sha=$(read_state_value "$HEALTH_FILE")', text)
        self.assertIn('[ "$rejected_sha" = "$current" ] && [ "$healthy_sha" = "$current" ]', text)
        self.assertIn('rm -f "$REJECTED_FILE"', text)
        self.assertIn('cleared stale rejected state for healthy current checkout', text)

    def test_host_base_telemetry_changes_restart_surface(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("system/services/telemetry/base-agent.sh", text)
        self.assertIn("system/services/telemetry/relay.json", text)
        self.assertIn("surface_host_changed=1", text)

    def test_surface_health_is_bound_to_rendered_ui_sha(self):
        supervisor = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        host = NATIVE_HOST_SERVER.read_text(encoding="utf-8")
        adapter = NATIVE_UPDATE_ADAPTER.read_text(encoding="utf-8")
        self.assertIn("SURFACE_HEARTBEAT_FILE=$UPDATE_RUN_DIR/surface-heartbeat.json", supervisor)
        self.assertIn("surface_heartbeat_sha()", supervisor)
        self.assertIn('rendered_sha=$(surface_heartbeat_sha)', supervisor)
        self.assertIn('[ "$healthy_sha" = "$expected_sha" ] && [ "$rendered_sha" = "$expected_sha" ]', supervisor)
        self.assertIn("clear_surface_health()", supervisor)
        self.assertIn('snapshot.sourceSha !== renderedSourceSha', adapter)
        self.assertIn('JSON.stringify({ sourceSha: renderedSourceSha })', adapter)
        self.assertIn('update_state.get("sourceSha") != source_sha', host)
        self.assertIn("self._empty(409)", host)

    def test_live_reload_requires_surface_health_acknowledgement(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("HEALTH_FILE=$UPDATE_RUN_DIR/healthy-sha", text)
        self.assertIn("surface_health_matches()", text)
        self.assertIn("wait_for_surface_health", text)
        self.assertIn('wait_for_surface_health "$new_sha" "$SURFACE_HEALTH_TIMEOUT"', text)
        self.assertIn('wait_for_surface_health "$guard_current" "$SURFACE_HEALTH_TIMEOUT"', text)
        self.assertIn('rollback_update "$old_sha" "$new_sha" reload', text)
        self.assertIn('wait_for_surface_health "$new_sha" "$SURFACE_HEALTH_TIMEOUT"', text)
        self.assertIn('wait_for_surface_health "$new_sha" "$RELOAD_HEALTH_TIMEOUT"', text)
        self.assertIn("recover_reload_with_surface_restart()", text)
        self.assertIn('wait_for_surface_health "$expected_sha" "$RELOAD_FALLBACK_HEALTH_TIMEOUT"', text)
        self.assertIn("live reload health acknowledgement timed out; restarting Surface once", text)
        self.assertIn("Surface restart fallback acknowledged healthy state", text)
        self.assertIn("late Surface health acknowledgement arrived before rollback commit", text)
        self.assertIn('surface_health_matches "$new_sha"', text)
        self.assertIn("Surface did not acknowledge healthy state after reload and one Surface restart", text)
        recovery = text.split("recover_reload_with_surface_restart() {", 1)[1].split("\n}\n", 1)[0]
        self.assertEqual(recovery.count("stop_surface"), 1)
        self.assertEqual(recovery.count("start_surface"), 1)
        self.assertLess(
            text.index('recover_reload_with_surface_restart "$new_sha"'),
            text.index('rollback_update "$old_sha" "$new_sha" reload'),
        )
        self.assertIn("updated native Surface host did not render and acknowledge healthy state", text)
        self.assertIn("SUPERVISOR_GUARD_FILE=$STATE_DIR/pending-supervisor-update", text)

    def test_native_server_exposes_loopback_update_state_and_health_endpoint(self):
        text = NATIVE_HOST_SERVER.read_text(encoding="utf-8")
        self.assertIn('UPDATE_PATH = "/__ordax/native/update"', text)
        self.assertIn('HEALTH_PATH = "/__ordax/native/health"', text)
        self.assertIn('UPDATE_STATE_FILE = "/run/ordax-update/state.json"', text)
        self.assertIn('HEALTH_STATE_FILE = "/run/ordax-update/healthy-sha"', text)
        self.assertIn('HEALTH_TOKEN_HEADER = "X-OrdaX-Health-Token"', text)
        self.assertIn("record_surface_health", text)
        self.assertIn("bootRefreshRequired", text)
        self.assertIn(
            'if opaque_signed_module_read_is_trusted(self.headers, self.path, self.command):',
            text,
        )
        self.assertIn('self.send_header("Access-Control-Allow-Origin", "null")', text)
        self.assertNotIn('self.send_header("Access-Control-Allow-Origin", "*")', text)

    def test_native_server_disables_static_surface_cache(self):
        text = NATIVE_HOST_SERVER.read_text(encoding="utf-8")
        self.assertIn('self.send_header("Cache-Control", "no-store, max-age=0")', text)
        self.assertIn('self.send_header("Pragma", "no-cache")', text)
        self.assertIn('if not parsed_path.startswith("/__ordax/native/"):', text)

    def test_native_composition_owns_reload_watcher_and_update_center(self):
        adapter = NATIVE_UPDATE_ADAPTER.read_text(encoding="utf-8")
        composition = NATIVE_COMPOSITION.read_text(encoding="utf-8")
        controls = UPDATE_CONTROLS.read_text(encoding="utf-8")
        overview = SYSTEM_OVERVIEW.read_text(encoding="utf-8")
        presentation = UPDATE_PRESENTATION.read_text(encoding="utf-8")
        self.assertIn('UPDATE_STATE_PATH = "/__ordax/native/update"', adapter)
        self.assertIn('UPDATE_HEALTH_PATH = "/__ordax/native/health"', adapter)
        self.assertIn("const DEFAULT_INTERVAL_MS = 750;", adapter)
        self.assertIn('state.applyMode === "reload"', adapter)
        self.assertIn("windowRef.location.reload()", adapter)
        self.assertIn("markHealthy()", adapter)
        self.assertIn("subscribe(listener)", adapter)
        self.assertIn("Network/update polling must never take the running Surface down", adapter)
        self.assertIn("createNativeUpdateWatcher", composition)
        self.assertIn("mountUpdateControls", composition)
        self.assertIn("updateWatcher.markHealthy()", composition)
        self.assertIn("updateControls.destroy()", composition)
        self.assertIn('target: "updates"', controls)
        self.assertIn("updateIsAlerting", controls)
        self.assertIn('"rolled-back": "Atualização revertida"', presentation)
        self.assertIn('"Atualização de base pendente"', presentation)
        self.assertIn('"Baixando atualização de Base"', presentation)
        self.assertIn('"Base gravada no slot inativo"', presentation)
        self.assertIn('"Base pronta para ativação"', presentation)
        self.assertIn("overviewUpdateSummaryMessageId", overview)
        self.assertIn('t("system.updates.attention.generic")', overview)
        self.assertNotIn('"Reinício necessário"', overview)
        self.assertIn("lastAppliedAt", overview)
        self.assertIn("rejectedSha", overview)

    def test_stale_rendered_surface_heartbeat_recovers_once_without_restart_storm(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn('SURFACE_STALE_SECONDS=${ORDAX_SURFACE_STALE_SECONDS:-90}', text)
        self.assertIn('[ "$SURFACE_STALE_SECONDS" -ge 45 ]', text)
        self.assertIn("surface_heartbeat_epoch()", text)
        self.assertIn("surface_heartbeat_is_fresh()", text)
        self.assertIn("surface_start_grace_active()", text)
        self.assertIn("recover_stale_surface_if_needed()", text)
        self.assertIn('expected_sha=$(read_state_value "$RUNTIME_SURFACE_SHA_FILE")', text)
        self.assertIn('[ "$rendered_sha" = "$expected_sha" ] || return 1', text)
        self.assertIn('SURFACE_STARTED_AT=$(epoch_now)', text)
        self.assertIn('SURFACE_STALE_RECOVERY_ARMED=0', text)
        self.assertIn('SURFACE_STALE_RECOVERY_ARMED=1', text)
        self.assertIn("Surface heartbeat stale or mismatched", text)
        self.assertIn('clear_surface_health', text)
        self.assertIn('stop_surface', text)
        self.assertIn('start_surface || fail_closed "Surface heartbeat recovery restart failed"', text)
        self.assertIn('wait_for_surface_health "$expected_sha" "$SURFACE_HEALTH_TIMEOUT"', text)
        self.assertIn('fail_closed "Surface heartbeat recovery restart did not acknowledge healthy state"', text)
        self.assertIn("Surface heartbeat recovery restart acknowledged healthy state", text)
        self.assertIn("check_owner_initial_surface_health", text)
        self.assertIn("recover_stale_surface_if_needed", text)
        self.assertIn("    check_for_update", text)

        recovery = text.split("recover_stale_surface_if_needed() {", 1)[1].split("\n}\n", 1)[0]
        self.assertEqual(recovery.count('stop_surface'), 1)
        self.assertEqual(recovery.count('start_surface'), 1)
        self.assertIn('[ "$SURFACE_STALE_RECOVERY_ARMED" -eq 1 ] || return 0', recovery)
        self.assertIn('SURFACE_STALE_RECOVERY_ARMED=1', recovery)

    def test_cold_boot_requires_health_and_can_restore_last_rendered_runtime(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn('boot_runtime_sha=$(read_state_value "$RUNTIME_SURFACE_SHA_FILE")', text)
        self.assertIn('clear_surface_health\nif [ "$DISTRIBUTION_PROFILE" = "stable-mvp" ]; then', text)
        self.assertIn("starting shared OrdaX Surface with Stable/MVP signed-release profile", text)
        self.assertIn("starting shared OrdaX Surface with Owner/Development Git hot-update supervisor", text)
        self.assertIn("begin_owner_initial_surface_health", text)
        self.assertIn("check_owner_initial_surface_health", text)
        self.assertIn('wait_for_surface_health "$initial_sha" "$INITIAL_SURFACE_HEALTH_TIMEOUT"', text)
        self.assertIn("owner_monotonic_seconds()", text)
        self.assertIn("OWNER_INITIAL_PROVISION_SINCE", text)
        self.assertIn('rollback_boot_candidate()', text)
        self.assertIn('validate_candidate_tree "$previous_sha" supervisor-restart', text)
        self.assertIn('reset --hard "$previous_sha"', text)
        self.assertIn('cold-boot Surface candidate $failed_sha failed health', text)
        self.assertIn('exit 75', text)
        self.assertIn('cold-boot Surface did not become healthy; retrying current checkout once', text)
        self.assertIn('fail_closed "cold-boot Surface failed health after one retry"', text)
        self.assertIn('record_runtime_surface_sha "$initial_sha"', text)

    def test_runtime_surface_sha_tracks_only_runtime_effective_updates(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("RUNTIME_SURFACE_SHA_FILE=$STATE_DIR/runtime-surface-sha", text)
        self.assertIn("record_runtime_surface_sha()", text)
        self.assertIn('"runtimeSurfaceSha":"%s"', text)
        self.assertIn('record_runtime_surface_sha "$previous_sha"', text)
        self.assertGreaterEqual(text.count('record_runtime_surface_sha "$new_sha"'), 2)
        self.assertIn('record_runtime_surface_sha "$guard_current"', text)
        self.assertIn('record_runtime_surface_sha "$(current_sha)"', text)
        none_block = text.split('        none)\n', 1)[1].split('            ;;', 1)[0]
        self.assertNotIn("record_runtime_surface_sha", none_block)

    def test_update_state_carries_operator_visible_metadata(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn('"targetSha":"%s"', text)
        self.assertIn('"phase":"%s"', text)
        self.assertIn('"attemptId":"%s"', text)
        self.assertIn('"baseUpdatePhase":"%s"', text)
        self.assertIn('"baseUpdateSha":"%s"', text)
        self.assertIn("derive_base_update_progress()", text)
        self.assertIn("DEV_BASE_STAGED_FILE=$STATE_DIR/base-update/dev-base-staged-sha", text)
        self.assertIn(
            "DEV_BASE_ACTIVATION_READINESS_SHA_FILE=$STATE_DIR/base-update/dev-base-activation-readiness-sha",
            text,
        )
        self.assertIn('"checkedAt":"%s"', text)
        self.assertIn('"lastAppliedSha":"%s"', text)
        self.assertIn('"lastAppliedAt":"%s"', text)
        self.assertIn('"rejectedSha":"%s"', text)
        self.assertIn('"lastError":"%s"', text)
        self.assertIn("set_update_context()", text)
        self.assertIn("clear_update_context()", text)
        self.assertIn("record_applied", text)

    def test_update_transaction_phases_are_explicit_and_bounded(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn('set_update_context fetching "$remote_sha" "$attempt_id" ""', text)
        self.assertIn('set_update_context validating "$new_sha" "$attempt_id" ""', text)
        self.assertIn('set_update_context health-wait "$new_sha" "$attempt_id" ""', text)
        self.assertIn('set_update_context activating "$new_sha" "$attempt_id" ""', text)
        self.assertIn('set_update_context rollback "$failed_sha" "$UPDATE_ATTEMPT_ID" "$reason"', text)
        self.assertIn('printf \'%s %s %s\\n\' "$old_sha" "$new_sha" "$attempt_id"', text)
        self.assertIn('guard_attempt=${3:-}', text)

    def test_update_center_surfaces_transaction_diagnostics(self):
        overview = SYSTEM_OVERVIEW.read_text(encoding="utf-8")
        self.assertIn("UPDATE_PHASE_MESSAGE_IDS", overview)
        self.assertIn("BASE_PHASE_MESSAGE_IDS", overview)
        self.assertIn("baseUpdatePhase", overview)
        self.assertIn("baseUpdateSha", overview)
        self.assertIn('t("system.updates.fact.baseProgress")', overview)
        self.assertIn("targetSha", overview)
        self.assertIn('t("system.updates.fact.attempt")', overview)
        self.assertIn('t("system.updates.fact.diagnostic")', overview)
        self.assertIn("lastError", overview)

    def test_guardian_owns_supervisor_lifetime_without_git_or_network(self):
        guardian = SYSTEM_ENTRYPOINT.read_text(encoding="utf-8")
        supervisor = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("SUPERVISOR=$SYSTEM_ROOT/supervisor", guardian)
        self.assertIn("ORDAX_SUPERVISOR_STALE_SECONDS:-120", guardian)
        self.assertIn('/bin/busybox stat -c %Y "$UPDATE_STATE"', guardian)
        self.assertIn("supervisor heartbeat stale", guardian)
        self.assertIn('exec "$SYSTEM_ENTRYPOINT"', guardian)
        self.assertIn("supervisor requested guardian refresh", guardian)
        self.assertNotIn("ls-remote", guardian)
        self.assertNotIn("fetch --no-tags", guardian)
        self.assertNotIn("reset --hard", guardian)
        self.assertNotIn("surface/entrypoint", guardian)
        self.assertIn("SURFACE_ENTRYPOINT=$SYSTEM_ROOT/surface/entrypoint", supervisor)

    def test_supervisor_updates_refresh_guardian_through_exit_75(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("system/entrypoint|system/supervisor)", text)
        self.assertIn("SUPERVISOR_SCRIPT=$SYSTEM_ROOT/supervisor", text)
        self.assertIn('/bin/sh -n "$SUPERVISOR_SCRIPT"', text)
        self.assertIn("asking guardian to restart supervisor without reboot", text)
        self.assertIn("exit 75", text)
        self.assertNotIn('exec "$SYSTEM_ENTRYPOINT"', text)

    def test_supervisor_does_not_confuse_launcher_exit_with_native_host_shutdown(self):
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        helper = text.split("native_host_quiesced() {", 1)[1].split("\n}", 1)[0]
        stopped = text.split("stop_surface() {", 1)[1].split("\n}", 1)[0]
        self.assertIn('native_lock=/run/ordax-surface/native-host-instance.lock', helper)
        self.assertIn('/bin/busybox flock -n "$native_lock" /bin/true', helper)
        self.assertIn('[ ! -L "$native_lock" ] || return 1', helper)
        starter = text.split("start_surface_from_system() {", 1)[1].split("\n}", 1)[0]
        self.assertIn('if ! native_host_quiesced; then', starter)
        self.assertIn('if ! native_host_quiesced; then', stopped)
        self.assertIn('trap - EXIT HUP INT TERM', stopped)
        self.assertIn('exit 1', stopped)
        self.assertNotIn('[ -n "$SURFACE_PID" ] || return 0', stopped)

    def test_native_host_lock_quiescence_with_real_processes(self):
        # GitHub's generic Ubuntu runner has a minimal BusyBox build with
        # no flock applet. Use the host's util-linux flock to test the kernel
        # contention semantics; the independent Base build separately proves
        # the ACTUAL target BusyBox supports this applet in both directions.
        host_flock = shutil.which("flock")
        if host_flock is None:
            self.skipTest("no host flock; target applet proof runs in Base build")
        text = SYSTEM_SUPERVISOR.read_text(encoding="utf-8")
        helper = "native_host_quiesced() {" + text.split(
            "native_host_quiesced() {", 1
        )[1].split("\n}", 1)[0] + "\n}"
        with tempfile.TemporaryDirectory() as temporary:
            lock_path = Path(temporary) / "native-host-instance.lock"
            # Use precisely the production helper, replacing only the test's
            # isolated lock path. No environment-controlled production override.
            helper = helper.replace(
                "/run/ordax-surface/native-host-instance.lock", str(lock_path)
            ).replace("/bin/busybox flock -n", host_flock + " -n")
            def probe():
                return subprocess.run(["sh", "-c", helper + "\nnative_host_quiesced"],
                                      capture_output=True, timeout=10)
            self.assertEqual(probe().returncode, 0)  # Host never started.
            lock_path.write_bytes(b"")
            lock_path.chmod(0o600)
            self.assertEqual(probe().returncode, 0)  # Stopped host.
            with lock_path.open("rb") as locked:
                fcntl.flock(locked, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self.assertNotEqual(probe().returncode, 0)  # Orphan host alive.
            self.assertEqual(probe().returncode, 0)  # Kernel released lock.
            lock_path.unlink()
            lock_path.symlink_to(Path(temporary) / "another-inode")
            self.assertNotEqual(probe().returncode, 0)  # Unsafe symlink.

    def test_surface_launcher_is_gracefully_restartable(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn('GRAPHICS_PID=""', text)
        self.assertIn('terminate_child "$GRAPHICS_PID" "graphics host"', text)
        self.assertIn('kill -KILL "$pid"', text)
        self.assertIn('wait "$pid"', text)
        self.assertIn("trap terminate HUP INT TERM", text)
        self.assertIn("GRAPHICS_PID=$!", text)


if __name__ == "__main__":
    unittest.main()
