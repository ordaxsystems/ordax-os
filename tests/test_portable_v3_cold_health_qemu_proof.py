import json
import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "bootstrap" / "portable-v2" / "qemu_cold_health_commit.py"
BASE_RUNNER = ROOT / "bootstrap" / "portable-v2" / "qemu_boot.py"
SUPERVISOR = ROOT / "system" / "supervisor"
WORKFLOW = ROOT / ".github" / "workflows" / "portable-v2-qemu-boot-proof.yml"
SPEC = ROOT / "docs" / "contracts" / "portable-v3-cold-health-qemu-proof-spec.json"


class StateInspectionJournalTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("qemu_inspection_test", BASE_RUNNER)
        self.qemu = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.qemu)

    def test_replay_changes_only_copy_and_accepts_success_statuses(self):
        for status in (0, 1):
            with self.subTest(status=status), tempfile.TemporaryDirectory() as directory:
                source = Path(directory) / "guest-state.img"
                copy = Path(directory) / "inspection.img"
                source.write_bytes(b"committed journal, pending checkpoint")

                def replay(argv, *, check):
                    self.assertFalse(check)
                    self.assertEqual(argv, ["e2fsck", "-p", "-E", "journal_only", str(copy)])
                    self.assertEqual(copy.read_bytes(), source.read_bytes())
                    copy.write_bytes(b"replayed committed state")
                    return subprocess.CompletedProcess(argv, status, b"", b"")

                with patch.object(self.qemu, "run", side_effect=replay):
                    self.qemu.prepare_state_inspection_copy(source, copy)
                self.assertEqual(source.read_bytes(), b"committed journal, pending checkpoint")
                self.assertEqual(copy.read_bytes(), b"replayed committed state")

    def test_replay_errors_fail_closed_without_general_repair(self):
        for status in (2, 4, 8, 16, 32, 128):
            with self.subTest(status=status), tempfile.TemporaryDirectory() as directory:
                source = Path(directory) / "guest-state.img"
                copy = Path(directory) / "inspection.img"
                source.write_bytes(b"state")
                result = subprocess.CompletedProcess([], status, b"", b"journal error")
                with patch.object(self.qemu, "run", return_value=result) as command:
                    with self.assertRaisesRegex(self.qemu.ProofError, "journal replay failed"):
                        self.qemu.prepare_state_inspection_copy(source, copy)
                command.assert_called_once()
                self.assertEqual(source.read_bytes(), b"state")


class PortableV3ColdHealthQemuProofTests(unittest.TestCase):
    def test_supervisor_marker_is_emitted_only_after_real_commit_path(self):
        text = SUPERVISOR.read_text(encoding="utf-8")
        handler = text.split("handle_portable_candidate_boot() {", 1)[1].split("\n}", 1)[0]
        commit = handler.index('portable_commit_candidate "$candidate_sha"')
        applied = handler.index('record_applied "$candidate_sha" signed-release')
        marker = handler.index("ORDAX_PORTABLE_COLD_HEALTH_COMMIT=%s\\n")
        health = handler.index(
            'wait_for_surface_health "$candidate_sha" "$INITIAL_SURFACE_HEALTH_TIMEOUT"'
        )
        self.assertLess(health, commit)
        self.assertLess(commit, applied)
        self.assertLess(applied, marker)
        self.assertIn('>/dev/console', handler)

    def test_base_qemu_runner_can_wait_for_post_health_observation(self):
        text = BASE_RUNNER.read_text(encoding="utf-8")
        self.assertIn("required_post_marker: str | None = None", text)
        self.assertIn("required_post_marker in text", text)
        self.assertIn('"required_post_marker_seen"', text)
        self.assertIn("graphical_hardware: bool = False", text)
        self.assertIn('"-vga", "virtio"', text)
        self.assertIn('"qemu_graphical_hardware_requested"', text)
        self.assertIn('"-net", "none"', text)
        self.assertIn("cache=directsync", text)
        self.assertIn("DIRECT_KERNEL_BOOT_TIMEOUT_SECONDS = 210.0", text)
        self.assertIn("GRAPHICAL_BOOT_TIMEOUT_SECONDS = 300.0", text)
        self.assertIn(
            "deadline = time.monotonic() + (GRAPHICAL_BOOT_TIMEOUT_SECONDS if graphical_hardware else DIRECT_KERNEL_BOOT_TIMEOUT_SECONDS)",
            text,
        )

    def test_cold_health_runner_uses_real_supervisor_commit_and_second_boot(self):
        text = RUNNER.read_text(encoding="utf-8")
        self.assertIn("ORDAX_PORTABLE_COLD_HEALTH_COMMIT=", text)
        self.assertIn('expected_slot="candidate"', text)
        self.assertIn('expected_slot="current"', text)
        self.assertIn("required_post_marker=commit_marker", text)
        self.assertGreaterEqual(text.count("graphical_hardware=True"), 2)
        self.assertIn('"virtio_graphics_both_boots"', text)
        self.assertIn('"adapter": "virtio-vga"', text)
        self.assertIn('"synthetic_health": False', text)
        self.assertIn('"current_promoted_to_candidate"', text)
        self.assertIn('"known_good_rotated_to_previous"', text)
        self.assertIn('"candidate_file_removed"', text)
        self.assertIn('"activation_transaction_removed"', text)
        self.assertIn('"cold_health_commit_proven": True', text)
        self.assertIn('"physical_target_device_touched": False', text)
        self.assertIn('"physical_write_authorized": False', text)
        self.assertIn('"physical_usb_boot_proven": False', text)
        self.assertIn('"secure_boot_proven": False', text)


    def test_failed_qemu_state_is_readonly_bounded_and_has_no_user_content(self):
        spec = importlib.util.spec_from_file_location("qemu_cold_health_diag", RUNNER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        candidate, previous = "a" * 40, "b" * 40
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder)
            release = state / "ordax/portable-release"
            release.mkdir(parents=True)
            (release / "current").write_text(previous)
            (release / "known-good").write_text(previous)
            (release / "rejected").write_text(candidate)
            (release / "candidate").write_text("malformed\n")
            private = state / "home"
            private.mkdir()
            (private / "secret").write_text("PRIVATE_NEVER_COLLECT")
            result = module.snapshot_failure_state_from_mounted_ext4(
                state, candidate_commit=candidate, previous_commit=previous
            )
            self.assertTrue(result["activation"]["candidate_rejected"])
            self.assertTrue(result["activation"]["previous_restored"])
            self.assertFalse(result["activation"]["candidate_promoted"])
            self.assertFalse(result["activation"]["candidate_still_armed"])
            self.assertFalse(result["private_guest_files_collected"])
            self.assertFalse(result["volatile_guest_run_logs_recoverable"])
            self.assertNotIn("PRIVATE_NEVER_COLLECT", json.dumps(result))
            (release / "rejected").unlink()
            (release / "rejected").symlink_to(private / "secret")
            result = module.snapshot_failure_state_from_mounted_ext4(
                state, candidate_commit=candidate, previous_commit=previous
            )
            self.assertFalse(result["activation"]["candidate_rejected"])

    def test_disposable_graphics_observation_does_not_change_health_criteria(self):
        runner = BASE_RUNNER.read_text(encoding="utf-8")
        cold = RUNNER.read_text(encoding="utf-8")
        self.assertIn("graphical_diagnostics_dir: Path | None = None", runner)
        self.assertIn('ordax.qemu_health_diag=1', runner)
        self.assertIn("capture_disposable_graphics(", runner)
        self.assertIn("screendump {destination}", runner)
        self.assertIn("graphical_diagnostics_dir=args.out.parent / \"graphical-evidence\"", cold)
        self.assertIn("required_post_marker=commit_marker", cold)
        self.assertIn("if ready:", runner)
        self.assertIn('"required_post_marker_seen"', runner)
        self.assertIn('"synthetic_health": False', cold)

    def test_disposable_graphics_capture_must_be_observation_only(self):
        spec = importlib.util.spec_from_file_location("qemu_graphics_observe_test", BASE_RUNNER)
        qemu = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(qemu)
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "frame.ppm"
            result = qemu.capture_disposable_graphics(Path(directory) / "absent.sock", destination)
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["reason"], "monitor_socket_failure")
            self.assertFalse(destination.exists())

    def test_disposable_graphics_capture_reports_qemu_monitor_rejection(self):
        import socket
        import threading

        spec = importlib.util.spec_from_file_location("qemu_hmp_diagnostic_test", BASE_RUNNER)
        qemu = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(qemu)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "monitor.sock"
            destination = Path(directory) / "capture.ppm"
            server = socket.socket(socket.AF_UNIX)
            server.bind(str(path))
            server.listen(1)
            def reject():
                with server.accept()[0] as client:
                    client.sendall(b"QEMU monitor (qemu) ")
                    data = client.recv(4096)
                    self.assertIn(b"screendump", data)
                    client.sendall(b"Error: no graphic device available\\n(qemu) ")
            worker = threading.Thread(target=reject)
            worker.start()
            try:
                result = qemu.capture_disposable_graphics(path, destination)
            finally:
                worker.join(timeout=4)
                server.close()
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["reason"], "qemu_no_active_graphical_display")
            self.assertNotIn("QEMU monitor", str(result))
            self.assertFalse(destination.exists())

    def test_disposable_graphics_waits_for_prompt_and_complete_ppm(self):
        import socket
        import threading

        spec = importlib.util.spec_from_file_location("qemu_hmp_complete_test", BASE_RUNNER)
        qemu = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(qemu)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "monitor.sock"
            destination = Path(directory) / "capture.ppm"
            server = socket.socket(socket.AF_UNIX)
            server.bind(str(path))
            server.listen(1)

            def complete():
                with server.accept()[0] as client:
                    client.sendall(b"QEMU 9.0\r\n(qemu) ")
                    self.assertIn(b"screendump", client.recv(4096))
                    # A 16-byte preliminary image must not become a receipt.
                    with destination.open("wb") as frame:
                        frame.write(b"P6\n2 2\n255\n")
                        frame.flush()
                        frame.write(b"\x00" * 12)
                    client.sendall(b"\r\n(qemu) ")

            worker = threading.Thread(target=complete)
            worker.start()
            try:
                result = qemu.capture_disposable_graphics(path, destination)
            finally:
                worker.join(timeout=4)
                server.close()
            self.assertEqual(result["status"], "captured")
            self.assertEqual(result["size_bytes"], destination.stat().st_size)
            self.assertEqual(result["reason"], "valid_complete_ppm")

    def test_disposable_graphics_rejects_truncated_ppm_after_prompt(self):
        import socket
        import threading

        spec = importlib.util.spec_from_file_location("qemu_hmp_truncated_test", BASE_RUNNER)
        qemu = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(qemu)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "monitor.sock"
            destination = Path(directory) / "capture.ppm"
            server = socket.socket(socket.AF_UNIX)
            server.bind(str(path))
            server.listen(1)

            def incomplete():
                with server.accept()[0] as client:
                    client.sendall(b"(qemu) ")
                    client.recv(4096)
                    destination.write_bytes(b"P6\n2 2\n255\n" + b"\x00" * 4)
                    client.sendall(b"(qemu) ")

            worker = threading.Thread(target=incomplete)
            worker.start()
            try:
                result = qemu.capture_disposable_graphics(path, destination)
            finally:
                worker.join(timeout=4)
                server.close()
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["reason"], "qemu_screendump_incomplete")
            self.assertFalse(destination.exists())

    def test_hmp_accepts_fragmented_prompt(self):
        import socket
        import threading
        spec = importlib.util.spec_from_file_location("hmp_fragments", BASE_RUNNER)
        qemu = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(qemu)
        left, right = socket.socketpair()

        def writer():
            try:
                for part in (b"QEMU monitor\r\n(q", b"emu) ", b"\x1b[0m"):
                    right.sendall(part)
            finally:
                right.close()
        worker = threading.Thread(target=writer)
        worker.start()
        try:
            data = qemu._hmp_read_complete_reply(left, "banner")
            self.assertIn(b"(qemu) ", data)
        finally:
            left.close()
            worker.join(timeout=2)

    def test_hmp_reports_command_disconnect_without_accepting_partial_reply(self):
        import socket
        spec = importlib.util.spec_from_file_location("hmp_closed", BASE_RUNNER)
        qemu = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(qemu)
        left, right = socket.socketpair()
        try:
            right.sendall(b"QEMU monitor banner without complete prompt")
            right.close()
            with self.assertRaisesRegex(
                qemu.HmpReplyError, "monitor_command_closed_before_prompt"
            ):
                qemu._hmp_read_complete_reply(left, "command")
        finally:
            left.close()

    def test_final_state_is_inspected_read_only(self):
        text = RUNNER.read_text(encoding="utf-8")
        self.assertIn('"mount.exfat-fuse", "-o", "ro"', text)
        self.assertIn('"loop,ro,noload"', text)
        self.assertIn("qemu.prepare_state_inspection_copy(state_image, state_copy)", text)
        self.assertIn("current == candidate_commit", text)
        self.assertIn("known_good == previous_commit", text)
        self.assertIn("rejected != candidate_commit", text)

    def test_contract_does_not_promote_ci_to_physical_evidence(self):
        spec = json.loads(SPEC.read_text(encoding="utf-8"))
        self.assertEqual(
            spec["$schema"],
            "prototype-ordax.portable-v3-cold-health-qemu-proof-spec/1",
        )
        self.assertEqual(
            spec["proof_mode"],
            "diagnostic-real-supervisor-cold-health-commit-not-ci-promotion-authority",
        )
        self.assertFalse(spec["ci_policy"]["required_in_portable_qemu_workflow"])
        self.assertTrue(spec["ci_policy"]["synthetic_health_forbidden"])
        self.assertTrue(spec["ci_policy"]["qemu_boot_fallback_and_uefi_proofs_remain_required"])
        self.assertEqual(spec["required_final_state"]["current"], "candidate")
        self.assertEqual(spec["required_final_state"]["known_good"], "previous")
        self.assertEqual(spec["required_final_state"]["second_boot_slot"], "current")
        self.assertTrue(spec["safety"]["post_commit_marker_is_observation_only"])
        self.assertTrue(
            spec["safety"]["marker_emitted_only_after_real_portable_state_commit"]
        )
        self.assertFalse(spec["safety"]["physical_target_device_touched"])
        self.assertFalse(spec["safety"]["physical_write_authorized"])
        self.assertFalse(spec["safety"]["physical_usb_boot_proven"])
        self.assertFalse(spec["safety"]["secure_boot_proven"])
        self.assertFalse(spec["safety"]["synthetic_surface_health"])
        self.assertTrue(spec["safety"]["graphical_health_uses_product_stack"])
        self.assertTrue(
            spec["safety"]["virtual_gpu_does_not_count_as_physical_hardware_proof"]
        )
        self.assertEqual(spec["virtual_hardware"]["graphics_adapter"], "virtio-vga")
        self.assertEqual(spec["virtual_hardware"]["guest_memory_mib"], 3072)
        self.assertEqual(
            spec["virtual_hardware"]["guest_graphical_stack"],
            "cage-wayland-webkit-seatd",
        )
        self.assertFalse(spec["virtual_hardware"]["synthetic_surface_health"])
        self.assertIn(
            "CONFIG_DRM_VIRTIO_GPU=y",
            spec["virtual_hardware"]["kernel_requirements"],
        )
        self.assertFalse(
            spec["promotion_effect"]["disposable_qemu_cold_health_commit_gate_can_close_after_exact_main_proof"]
        )
        self.assertFalse(spec["promotion_effect"]["physical_cold_health_gate_closed"])
        self.assertFalse(spec["promotion_effect"]["physical_known_good_gate_closed"])
        self.assertFalse(spec["promotion_effect"]["physical_rollback_gate_closed"])

    def test_workflow_proves_fallback_and_uefi_without_promoting_cold_health(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("PORTABLE_V4_TO_V3_QEMU_ONE_SHOT_FALLBACK=PASS", text)
        self.assertNotIn("qemu_cold_health_commit.py", text)
        self.assertNotIn("PORTABLE_V4_QEMU_COLD_HEALTH_COMMIT=PASS", text)
        self.assertIn("PORTABLE_V4_QEMU_COLD_HEALTH_COMMIT_PROVEN=NO", text)
        self.assertIn(
            "COLD_HEALTH_COMMIT_PROOF=REQUIRES_PHYSICAL_STABLE_MVP_NO_SYNTHETIC_CI",
            text,
        )
        self.assertIn("Boot same portable-v2 disk through OVMF and systemd-boot", text)


if __name__ == "__main__":
    unittest.main()
