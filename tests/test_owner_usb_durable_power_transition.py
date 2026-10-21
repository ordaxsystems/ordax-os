#!/usr/bin/env python3
"""Validate Owner USB power is gated by quiescence + durable sync, never mount guesses."""

from pathlib import Path
import os
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
GUARDIAN = ROOT / "system/entrypoint"


def function_source(text, name):
    anchor = f"{name}() {{\n"
    assert text.count(anchor) == 1
    return anchor + text.split(anchor, 1)[1].split("\n}\n", 1)[0] + "\n}\n"


class OwnerUsbDurablePowerTransitionTests(unittest.TestCase):
    def test_owner_usb_contract_and_profile_isolation(self):
        source = GUARDIAN.read_text(encoding="utf-8")
        subprocess.run(["/bin/sh", "-n", str(GUARDIAN)], check=True)
        transition = function_source(source, "perform_host_power_transition")
        self.assertIn('[ "$DISTRIBUTION_PROFILE" = "owner-development" ] && [ "$PRODUCT_MODE" = "usb" ]', transition)
        self.assertIn("if ! quiesce_supervisor_for_power_transition; then", transition)
        self.assertIn("if ! terminate_persistent_host_agents; then", transition)
        self.assertIn("if ! /bin/busybox sync", transition)
        self.assertIn('record_host_power_stage root-readonly', transition)
        self.assertIn("if ! remount_root_read_only_for_power; then", transition)
        self.assertIn("if ! root_filesystem_is_read_only; then", transition)
        self.assertIn("if remount_root_read_write_after_power_abort; then", transition)
        self.assertIn("restore_runtime_after_power_failure", transition)
        self.assertLess(
            transition.index("quiesce_supervisor_for_power_transition"),
            transition.index("terminate_persistent_host_agents"),
        )
        self.assertLess(
            transition.index("terminate_persistent_host_agents"),
            transition.index('record_host_power_stage filesystem-sync'),
        )
        self.assertLess(
            transition.index('record_host_power_stage filesystem-sync'),
            transition.index('/bin/busybox poweroff -f'),
        )

    def _run_simulated_transition(self, profile, mode, *, sync_fails=False, agents_fail=False):
        """Execute the Guardian's actual function; replace only external effects."""
        with tempfile.TemporaryDirectory(prefix="ordax-owner-shutdown-gate-") as temp:
            source = GUARDIAN.read_text(encoding="utf-8")
            transition = function_source(source, "perform_host_power_transition")
            transition = transition.replace("/bin/busybox sync", "busybox_mock sync")
            transition = transition.replace("/bin/busybox poweroff -f", "busybox_mock poweroff -f")
            transition = transition.replace("/bin/busybox reboot -f", "busybox_mock reboot -f")
            transition = transition.replace("if [ -w /proc/sysrq-trigger ]; then", "if false; then")
            script = "\n".join([
                "set -u",
                'log() { printf "log\\n" >>"$TRACE"; }',
                'record_host_power_stage() { printf "stage:%s\\n" "$1" >>"$TRACE"; }',
                'quiesce_supervisor_for_power_transition() { echo quiesced >>"$TRACE"; }',
                'stop_acpi_button_listener() { echo acpi-stopped >>"$TRACE"; }',
                'terminate_persistent_host_agents() { echo agents-stopped >>"$TRACE"; [ "$AGENT_FAIL" != 1 ]; }',
                'remount_root_read_only_for_power() { echo readonly-remount >>"$TRACE"; return 1; }',
                'root_filesystem_is_read_only() { echo readonly-proof >>"$TRACE"; return 0; }',
                'remount_root_read_write_after_power_abort() { echo readonly-reversal >>"$TRACE"; return 0; }',
                'restore_runtime_after_power_failure() { printf "restored:%s\\n" "$3" >>"$TRACE"; return 1; }',
                'SYNC_CALLS=0',
                'busybox_mock() { printf "kernel-tool:%s\\n" "$1" >>"$TRACE"; if [ "$1" = sync ]; then SYNC_CALLS=$((SYNC_CALLS + 1)); [ "$SYNC_FAIL" = 1 ] && [ "$SYNC_CALLS" -eq 2 ] && return 1; fi; return 0; }',
                transition,
                "perform_host_power_transition shutdown || :",
            ])
            trace = Path(temp) / "trace"
            env = {
                **os.environ,
                "DISTRIBUTION_PROFILE": profile,
                "PRODUCT_MODE": mode,
                "GUARDIAN_LOG": str(Path(temp) / "guardian.log"),
                "POWER_LAST_FAILURE": str(Path(temp) / "last-failure"),
                "TRACE": str(trace),
                "SYNC_FAIL": "1" if sync_fails else "0",
                "AGENT_FAIL": "1" if agents_fail else "0",
            }
            result = subprocess.run(
                ["/bin/sh", "-c", script],
                env=env, capture_output=True, text=True, timeout=8,
            )
            return result, trace.read_text(encoding="utf-8").splitlines()

    def test_owner_usb_kernel_handoff_after_two_successful_syncs_without_root_remount(self):
        result, trace = self._run_simulated_transition("owner-development", "usb")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(trace.count("kernel-tool:sync"), 2)
        self.assertIn("kernel-tool:poweroff", trace)
        self.assertIn("restored:kernel-transition-returned", trace)
        self.assertNotIn("readonly-remount", trace)
        self.assertNotIn("readonly-proof", trace)
        self.assertNotIn("readonly-reversal", trace)
        self.assertLess(trace.index("quiesced"), trace.index("agents-stopped"))
        self.assertLess(trace.index("agents-stopped"), trace.index("kernel-tool:sync"))
        self.assertLess(trace.index("kernel-tool:sync"), trace.index("kernel-tool:poweroff"))

    def test_final_sync_failure_prevents_kernel_power_and_restores_surface(self):
        result, trace = self._run_simulated_transition(
            "owner-development", "usb", sync_fails=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("restored:sync-failed", trace)
        self.assertNotIn("kernel-tool:poweroff", trace)

    def test_unquiesced_agents_never_reach_final_sync_or_kernel_power(self):
        result, trace = self._run_simulated_transition(
            "owner-development", "usb", agents_fail=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("restored:host-agents-failed", trace)
        self.assertNotIn("kernel-tool:sync", trace)
        self.assertNotIn("kernel-tool:poweroff", trace)

    def test_stable_mvp_remains_readonly_gated(self):
        result, trace = self._run_simulated_transition("stable-mvp", "usb")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("readonly-remount", trace)
        self.assertIn("restored:remount-failed", trace)
        self.assertNotIn("kernel-tool:poweroff", trace)

    def test_non_usb_dev_is_not_authorized_for_usb_handoff(self):
        result, trace = self._run_simulated_transition("owner-development", "desktop")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("readonly-remount", trace)
        self.assertNotIn("kernel-tool:poweroff", trace)


if __name__ == "__main__":
    unittest.main()
