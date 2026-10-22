#!/usr/bin/env python3
"""Validate Owner USB power is gated by quiescence + durable sync, never mount guesses."""

from pathlib import Path
import os
import subprocess
import time
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
GUARDIAN = ROOT / "system/entrypoint"


def function_source(text, name):
    anchor = f"{name}() {{\n"
    assert text.count(anchor) == 1
    return anchor + text.split(anchor, 1)[1].split("\n}\n", 1)[0] + "\n}\n"


class OwnerUsbDurablePowerTransitionTests(unittest.TestCase):
    def test_all_persistent_agent_idle_children_close_rootfs_log_fds(self):
        # The real QEMU ACPI proof exposed busybox sleep descendants whose
        # stdout/stderr still held / (root ext4) writable after the parent
        # telemetry/rescue agents were terminated. Closing only the parent
        # does not close the child FDs. Keep agent status logging persistent,
        # but idle descendants must never inherit persistent launcher logs.
        for source_path, interval in (
            ("system/services/telemetry/base-agent.sh", "interval"),
            ("system/rescue/agent.sh", "INTERVAL"),
            ("system/services/base-update/agent.sh", "INTERVAL"),
        ):
            with self.subTest(agent=source_path):
                source = (ROOT / source_path).read_text(encoding="utf-8")
                subprocess.run(["/bin/sh", "-n", str(ROOT / source_path)], check=True)
                expected = (
                    f'/bin/busybox sleep "${interval}" '
                    '</dev/null >/dev/null 2>&1'
                )
                self.assertIn(expected, source)
                self.assertEqual(source.count(expected), 1)
                # Exercise the exact shell FD redirection on a harmless
                # disposable log, without a USB, ext4 remount or privileged
                # test. The only substitution is sleep's binary so this test
                # works on hosts without BusyBox installed.
                command = expected.replace("/bin/busybox sleep", "/bin/sleep")
                with tempfile.TemporaryDirectory(prefix="ordax-power-idle-fd-") as temp:
                    logfile = Path(temp) / "agent-persistent.log"
                    with logfile.open("wb") as log:
                        proc = subprocess.Popen(
                            ["/bin/sh", "-c", f"{interval}=30; {command}"],
                            stdin=subprocess.DEVNULL,
                            stdout=log, stderr=log,
                            start_new_session=True,
                        )
                        try:
                            deadline = time.monotonic() + 3
                            observed = False
                            while time.monotonic() < deadline:
                                if proc.poll() is not None:
                                    self.fail(f"idle child exited early: {proc.returncode}")
                                fd1 = Path(f"/proc/{proc.pid}/fd/1")
                                fd2 = Path(f"/proc/{proc.pid}/fd/2")
                                if fd1.exists() and fd2.exists():
                                    if os.readlink(fd1) == "/dev/null" and os.readlink(fd2) == "/dev/null":
                                        observed = True
                                        break
                                time.sleep(0.05)
                            self.assertTrue(observed, f"idle child inherits persistent log FDs: {source_path}")
                        finally:
                            proc.terminate()
                            proc.wait(timeout=5)

    def test_base_update_aura_child_remains_owned_during_usb_shutdown(self):
        # The Owner USB safety patch must not replace or regress the single
        # canonical Base Update agent when Aura is updated on main. The agent
        # terminates its Aura child before closing its own rootfs-backed logs;
        # meanwhile its idle sleep children must keep independent null FDs.
        source = (ROOT / "system/services/base-update/agent.sh").read_text(encoding="utf-8")
        self.assertEqual(source.count("stop_aura_worker() {"), 1)
        self.assertEqual(source.count("launch_optional_aura_worker() {"), 1)
        self.assertEqual(source.splitlines().count("    launch_optional_aura_worker"), 1)
        self.assertEqual(source.count("reconcile_optional_aura_worker() {"), 1)
        self.assertEqual(source.splitlines().count("        reconcile_optional_aura_worker"), 1)
        self.assertLess(
            source.rindex("prepare_dev_base_postboot_promotion\n        fi"),
            source.rindex("reconcile_optional_aura_worker\n    else"),
        )
        self.assertIn('if base_update_priority_pending; then\n            stop_aura_worker', source)
        self.assertEqual(source.count("trap stop_aura_worker EXIT"), 1)
        for signal, code in (("TERM", 143), ("INT", 130), ("HUP", 129)):
            self.assertIn(f"trap 'stop_aura_worker; exit {code}' {signal}", source)
        self.assertIn('AURA_WORKER_PID=$!', source)
        self.assertIn('/bin/busybox sleep "$INTERVAL" </dev/null >/dev/null 2>&1', source)

    def test_owner_usb_contract_and_profile_isolation(self):
        source = GUARDIAN.read_text(encoding="utf-8")
        subprocess.run(["/bin/sh", "-n", str(GUARDIAN)], check=True)
        transition = function_source(source, "perform_host_power_transition")
        self.assertIn('[ "$DISTRIBUTION_PROFILE" = "owner-development" ] && [ "$PRODUCT_MODE" = "usb" ]', transition)
        self.assertIn("if ! quiesce_supervisor_for_power_transition; then", transition)
        self.assertIn("if ! terminate_persistent_host_agents; then", transition)
        self.assertIn("if ! /bin/busybox sync", transition)
        self.assertIn('record_host_power_stage root-readonly', transition)
        self.assertIn("owner_usb_seal_root_for_power", transition)
        self.assertIn("owner_usb_restore_root_after_abort", transition)
        self.assertIn("owner_usb_all_root_mounts_read_only", source)
        self.assertIn("owner_usb_auxiliary_partitions_quiesced", source)
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

    def _run_simulated_transition(self, profile, mode, *, sync_fails=False, agents_fail=False, seal_fails=False):
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
                'owner_usb_seal_root_for_power() { echo owner-usb-seal >>"$TRACE"; [ "$SEAL_FAIL" != 1 ]; }',
                'owner_usb_restore_root_after_abort() { echo owner-usb-restore >>"$TRACE"; return 0; }',
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
                "SEAL_FAIL": "1" if seal_fails else "0",
            }
            result = subprocess.run(
                ["/bin/sh", "-c", script],
                env=env, capture_output=True, text=True, timeout=8,
            )
            return result, trace.read_text(encoding="utf-8").splitlines()

    def test_owner_usb_kernel_handoff_requires_sealed_root_and_two_syncs(self):
        result, trace = self._run_simulated_transition("owner-development", "usb")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(trace.count("kernel-tool:sync"), 2)
        self.assertIn("kernel-tool:poweroff", trace)
        self.assertIn("restored:kernel-transition-returned", trace)
        self.assertIn("owner-usb-seal", trace)
        self.assertIn("owner-usb-restore", trace)
        self.assertLess(trace.index("owner-usb-seal"), trace.index("kernel-tool:poweroff"))
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
        self.assertIn("owner-usb-restore", trace)
        self.assertNotIn("kernel-tool:poweroff", trace)

    def test_failed_usb_superblock_seal_prevents_forced_kernel_power(self):
        result, trace = self._run_simulated_transition(
            "owner-development", "usb", seal_fails=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("owner-usb-seal", trace)
        self.assertIn("owner-usb-restore", trace)
        self.assertIn("restored:remount-failed", trace)
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
