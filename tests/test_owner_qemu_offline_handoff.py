"""Owner QEMU boot uses verified disposable media; no simulated pass markers."""
from __future__ import annotations
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "owner_qemu", ROOT / "tools/creator/proof/owner_qemu_offline_boot.py"
)
assert SPEC and SPEC.loader
PROOF = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROOF)


class OwnerQemuHandoffTests(unittest.TestCase):
    def fixture(self, directory: Path):
        raw = directory / "usb.raw"
        raw.write_bytes(b"disposable-usb-data")
        kernel = directory / "vmlinuz"
        kernel.write_bytes(b"kernel")
        initramfs = directory / "initramfs.cpio.gz"
        initramfs.write_bytes(b"initramfs")
        report = directory / "proof.json"
        report.write_text(json.dumps({
            "$schema": "prototype-ordax.creator-disposable-media-proof/1",
            "status": "pass", "physical_write_authorized": False,
            "image_bytes": raw.stat().st_size, "partition_table": "gpt",
            "image_sha256": hashlib.sha256(raw.read_bytes()).hexdigest(),
            "checks": {"gpt_valid": True, "physical_write_remains_blocked": True},
        }), encoding="utf-8")
        return raw, report, kernel, initramfs

    def test_real_raw_hash_bound_and_rejects_tampering_and_device_alias(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            raw, receipt, kernel, initramfs = self.fixture(root)
            self.assertEqual(
                PROOF.validate(raw, receipt, kernel, initramfs, "a" * 40),
                hashlib.sha256(raw.read_bytes()).hexdigest(),
            )
            raw.write_bytes(b"unexpected")
            with self.assertRaises(PROOF.ProofError):
                PROOF.validate(raw, receipt, kernel, initramfs, "a" * 40)
            raw.unlink()
            raw.symlink_to(kernel)
            with self.assertRaises(PROOF.ProofError):
                PROOF.validate(raw, receipt, kernel, initramfs, "a" * 40)

    def test_no_network_and_actual_owner_initramfs_not_fake_sentinel(self):
        disk = Path("/tmp/owner.raw")
        command = PROOF.qemu_command(
            disk, Path("/tmp/vmlinuz"), Path("/tmp/initrd.gz"), Path("/tmp/serial")
        )
        self.assertIn("-net", command)
        self.assertEqual(command[command.index("-net") + 1], "none")
        self.assertIn("usb-storage,bus=owner-xhci.0,drive=ownerusb,removable=on,bootindex=1", command)
        self.assertIn("rdinit=/init", command[command.index("-append") + 1])
        self.assertIn("ordax.distribution_profile=owner-development", command[command.index("-append") + 1])
        self.assertNotIn("user,hostfwd", " ".join(command))
        self.assertFalse(PROOF.observed("OrdaX Development Base", "a" * 40)["offline_surface_handoff"])
        self.assertFalse(PROOF.observed("OrdaX Development Base", "a" * 40)["native_surface_heartbeat"])
        self.assertTrue(PROOF.observed(PROOF.MARKER_HEALTH, "a" * 40)["native_surface_heartbeat"])
        self.assertFalse(PROOF.observed(PROOF.MARKER_HEALTH, "a" * 40)["privileged_webkit_page_loaded"])
        self.assertFalse(PROOF.observed(PROOF.MARKER_HEALTH, "a" * 40)["virtual_drm_transport_selected"])
        self.assertTrue(PROOF.observed(PROOF.MARKER_VIRTIO_WEBKIT, "a" * 40)["virtual_drm_transport_selected"])
        callbacks = "\n".join(PROOF.WEBKIT_EVENT_PREFIX + event for event in PROOF.WEBKIT_LOAD_ORDER)
        self.assertTrue(PROOF.observed(callbacks, "a" * 40)["privileged_webkit_page_loaded"])
        self.assertFalse(PROOF.observed("\n".join(reversed(callbacks.splitlines())), "a" * 40)["privileged_webkit_page_loaded"])
        self.assertFalse(PROOF.observed(callbacks.replace(PROOF.WEBKIT_EVENT_PREFIX, "untrusted-prefix:"), "a" * 40)["privileged_webkit_page_loaded"])
        self.assertFalse(PROOF.observed(PROOF.WEBKIT_FATAL_MARKERS[0], "a" * 40)["webkit_process_not_failed"])
        self.assertFalse(PROOF.observed(PROOF.WEBKIT_FATAL_MARKERS[1], "a" * 40)["webkit_process_not_failed"])
        self.assertFalse(PROOF.observed("cold-boot Surface did not become healthy", "a" * 40)["no_surface_restart_or_failure"])
        self.assertFalse(PROOF.observed("Surface exited with status 1", "a" * 40)["no_surface_restart_or_failure"])
        self.assertEqual(PROOF.STABLE_SECONDS, 15)
        self.assertFalse(PROOF.observed("Checkout local verificado: " + "b" * 40, "a" * 40)["exact_local_checkout"])
        self.assertFalse(PROOF.observed("ordax-dev-bootstrap: entering local recovery shell", "a" * 40)["recovery_not_entered"])

    def test_actual_qmp_framebuffer_checks_color_distribution(self):
        with tempfile.TemporaryDirectory() as tmp:
            image = Path(tmp) / "qemu.ppm"
            black = b"P6\n320 200\n255\n" + b"\0" * (320 * 200 * 3)
            image.write_bytes(black)
            with self.assertRaisesRegex(PROOF.ProofError, "blank or console-like"):
                PROOF.analyze_ppm(image)
            image.write_bytes(b"P6\n320 200\n255\n" + bytes(
                channel
                for pixel in range(320 * 200)
                for channel in (
                    (pixel % 256), ((pixel // 3) % 256), ((pixel // 11) % 256)
                )
            ))
            report = PROOF.analyze_ppm(image)
            self.assertEqual(report["width"], 320)
            self.assertEqual(report["height"], 200)
            self.assertGreater(report["quantized_colors"], 24)
            self.assertGreater(report["lit_fraction"], 0.09)
            image.write_bytes(b"P6\n320 200\n255\n" + b"\1" * 17)
            with self.assertRaisesRegex(PROOF.ProofError, "dimensions/depth/bytes"):
                PROOF.analyze_ppm(image)

    def test_qmp_is_local_socket_and_framebuffer_is_required(self):
        command = PROOF.qemu_command(
            Path("/tmp/disk.raw"), Path("/tmp/vmlinuz"),
            Path("/tmp/initrd.gz"), Path("/tmp/serial"), Path("/tmp/qmp.sock")
        )
        self.assertEqual(command[command.index("-qmp") + 1],
                         "unix:/tmp/qmp.sock,server=on,wait=off")
        self.assertIn("-display", command)
        self.assertEqual(command[command.index("-display") + 1], "none")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "existing.ppm"
            path.write_bytes(b"x")
            with self.assertRaisesRegex(PROOF.ProofError, "already exists"):
                PROOF.capture_qmp_framebuffer(Path(tmp) / "unused.sock", path)

    def test_owner_webkit_events_are_real_privileged_load_callbacks_only(self):
        browser = (ROOT / "system/surface/runtime/ordax_browser_host.py").read_text(encoding="utf-8")
        command = PROOF.qemu_command(
            Path("/tmp/usb.raw"), Path("/tmp/vmlinuz"),
            Path("/tmp/initrd.gz"), Path("/tmp/serial"),
        )
        self.assertIn("ordax.owner_qemu_graphics_probe=1", command[command.index("-append") + 1])
        self.assertIn('if distribution_profile != "owner-development":', browser)
        self.assertIn('"/dev/ttyS0"', browser)
        self.assertIn('self.surface_view.connect("load-changed", self.on_surface_load_changed)', browser)
        self.assertIn('self.surface_view.connect("load-failed", self.on_surface_load_failed)', browser)
        self.assertIn('self.surface_view.connect("web-process-terminated", self.on_surface_web_process_terminated)', browser)
        self.assertIn('emit_owner_graphics_probe(self.owner_graphics_probe_enabled, event)', browser)
        self.assertIn("self.surface_web_process_failed = True", browser)
        self.assertIn("if host.surface_web_process_failed:", browser)

    def test_same_disposable_disk_is_reused_for_two_real_boots(self):
        disk = Path("/tmp/only-disposable-usb.raw")
        with patch.object(PROOF, "prove_guest_boot", side_effect=[
            {"checks": {"real": True}, "qemu_framebuffer": {"quantized_colors": 50}},
            {"checks": {"real": True}, "qemu_framebuffer": {"quantized_colors": 50}},
        ]) as boot:
            outputs = (
                (Path("/tmp/first.ppm"), Path("/tmp/first.serial")),
                (Path("/tmp/second.ppm"), Path("/tmp/second.serial")),
            )
            result = PROOF.prove_boot_pair(
                disk, Path("/tmp/kernel"), Path("/tmp/initramfs"),
                "a" * 40, Path("/tmp"), outputs, 180,
            )
        self.assertEqual(len(result), 2)
        self.assertEqual(boot.call_count, 2)
        self.assertEqual([call.args[0] for call in boot.call_args_list], [disk, disk])
        self.assertNotEqual(boot.call_args_list[0].args[4], boot.call_args_list[1].args[4])
        self.assertNotEqual(boot.call_args_list[0].args[6], boot.call_args_list[1].args[6])

    def test_second_guest_failure_is_not_reported_as_pass(self):
        with patch.object(PROOF, "prove_guest_boot", side_effect=[
            {"checks": {"real": True}, "qemu_framebuffer": {"quantized_colors": 50}},
            PROOF.ProofError("second offline boot failed"),
        ]):
            with self.assertRaisesRegex(PROOF.ProofError, "second offline boot failed"):
                PROOF.prove_boot_pair(
                    Path("/tmp/only-disposable-usb.raw"),
                    Path("/tmp/kernel"), Path("/tmp/initramfs"),
                    "a" * 40, Path("/tmp"),
                    ((Path("/tmp/first.ppm"), Path("/tmp/first.serial")),
                     (Path("/tmp/second.ppm"), Path("/tmp/second.serial"))),
                    180,
                )

    def test_first_guest_poweroff_must_precede_offline_fsck_and_second_boot(self):
        order = []

        def boot_stub(*args, **kwargs):
            order.append("boot-acpi" if kwargs.get("acpi_shutdown") else "boot-normal")
            return {
                "checks": {"real": True},
                "qemu_framebuffer": {"quantized_colors": 50},
                "acpi_shutdown_proven": bool(kwargs.get("acpi_shutdown")),
            }

        def fsck_stub(disk):
            order.append("e2fsck-after-poweroff")
            self.assertEqual(disk, Path("/tmp/only-disposable-usb.raw"))
            return True

        with patch.object(PROOF, "prove_guest_boot", side_effect=boot_stub), \
                patch.object(PROOF, "prove_ext4_clean_after_guest_poweroff", side_effect=fsck_stub):
            pair = PROOF.prove_boot_pair(
                Path("/tmp/only-disposable-usb.raw"),
                Path("/tmp/kernel"), Path("/tmp/initramfs"),
                "a" * 40, Path("/tmp"),
                ((Path("/tmp/first.ppm"), Path("/tmp/first.serial")),
                 (Path("/tmp/second.ppm"), Path("/tmp/second.serial"))),
                180, prove_acpi_shutdown=True,
            )
        self.assertEqual(order, [
            "boot-acpi", "e2fsck-after-poweroff", "boot-normal",
        ])
        self.assertTrue(pair[0]["ext4_clean_after_shutdown"])

    def test_forged_poweroff_proof_cannot_run_second_guest(self):
        with patch.object(PROOF, "prove_guest_boot", return_value={
                "checks": {"real": True},
                "qemu_framebuffer": {"quantized_colors": 50},
                "acpi_shutdown_proven": False,
        }) as boot:
            with self.assertRaisesRegex(PROOF.ProofError, "ACPI shutdown proof"):
                PROOF.prove_boot_pair(
                    Path("/tmp/only-disposable-usb.raw"),
                    Path("/tmp/kernel"), Path("/tmp/initramfs"),
                    "a" * 40, Path("/tmp"),
                    ((Path("/tmp/first.ppm"), Path("/tmp/first.serial")),
                     (Path("/tmp/second.ppm"), Path("/tmp/second.serial"))),
                    180, prove_acpi_shutdown=True,
                )
        self.assertEqual(boot.call_count, 1)

    def test_disposable_raw_must_have_valid_gpt_before_loop_fsck(self):
        with tempfile.TemporaryDirectory() as td:
            disk = Path(td) / "temporary.raw"
            disk.write_bytes(b"not a GPT" * 100)
            with self.assertRaisesRegex(PROOF.ProofError, "GPT header"):
                PROOF.prove_ext4_clean_after_guest_poweroff(disk)

    def test_creator_runs_real_qemu_only_after_disposable_raw_proof(self):
        workflow = (ROOT / ".github/workflows/creator-owner-dev-git.yml").read_text(encoding="utf-8")
        materialize = workflow.index("- name: Materialize and verify RAW development seed")
        qemu = workflow.index("- name: Prove actual Owner USB offline handoff in QEMU")
        bundle = workflow.index("- name: Build split Windows Creator bundle")
        self.assertLess(materialize, qemu)
        self.assertLess(qemu, bundle)
        self.assertIn("owner_qemu_offline_boot.py", workflow)
        self.assertIn('--serial-out "$RUNNER_TEMP/owner-qemu-serial.log"', workflow)
        self.assertIn('--second-serial-out "$RUNNER_TEMP/owner-qemu-second-serial.log"', workflow)
        self.assertIn("proof['second_offline_boot_proven'] is True", workflow)
        self.assertIn("--prove-acpi-shutdown", workflow)
        self.assertIn("proof['guest_acpi_shutdown_proven'] is True", workflow)
        self.assertIn("proof['ext4_clean_after_guest_shutdown'] is True", workflow)
        self.assertIn("proof['second_boot']['same_disposable_disk_reused'] is True", workflow)
        self.assertIn("${{ runner.temp }}/owner-qemu-serial.log", workflow)
        self.assertIn("if: always()", workflow)
        self.assertIn("ORDAX_OWNER_SOURCE_COMMIT", workflow)
        self.assertIn('--framebuffer-out "$RUNNER_TEMP/owner-qemu-framebuffer.ppm"', workflow)
        self.assertIn("proof['graphical_framebuffer_varied_proven'] is True", workflow)
        self.assertIn("actions/upload-artifact@", workflow)


if __name__ == "__main__":
    unittest.main()
