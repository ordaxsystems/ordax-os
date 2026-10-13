"""Independent Base Surface /sbin/ip parity without host network mutation."""
import importlib.util
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "bootstrap/independent-base"


def builder():
    spec = importlib.util.spec_from_file_location("iproute2_parity_builder", BASE / "build.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def qemu_proof_module():
    b = builder()
    with patch.dict(sys.modules, {"build": b}):
        spec = importlib.util.spec_from_file_location("iproute2_qemu_proof", BASE / "qemu_proof.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module


class IndependentIPParity(unittest.TestCase):
    def test_real_product_contract_matches_buildroot_profile(self):
        profile = (BASE / "configs/ordax_minimal_defconfig").read_text(encoding="utf-8")
        self.assertEqual(profile.splitlines().count("BR2_PACKAGE_IPROUTE2=y"), 1)
        fragment = (BASE / "configs/portable-handoff.busybox.fragment").read_text(encoding="utf-8")
        self.assertEqual(fragment.splitlines().count("# CONFIG_IP is not set"), 1)
        surface = (ROOT / "system/surface/bin/ordax-surface").read_text(encoding="utf-8")
        command = "/sbin/ip address replace 127.0.0.1/8 dev lo"
        self.assertIn(command, surface)
        probe = (BASE / "overlay/sbin/ordax-independent-probe-init").read_text(encoding="utf-8")
        self.assertEqual(probe.count(command), 1)
        self.assertNotIn(command, (BASE / "build.py").read_text(encoding="utf-8"))

    def test_missing_and_busybox_ip_fail_closed(self):
        b = builder()
        with tempfile.TemporaryDirectory() as dirname:
            target = Path(dirname)
            (target / "sbin").mkdir()
            with self.assertRaises(b.BaseError):
                b.verify_surface_ip_identity(target)
            ip = target / "sbin/ip"
            ip.write_text("#!/bin/sh\nprintf 'BusyBox ip\\n'\n", encoding="utf-8")
            ip.chmod(stat.S_IRWXU)
            with self.assertRaisesRegex(b.BaseError, "iproute2"):
                b.verify_surface_ip_identity(target)

    def test_incompatible_or_ambiguous_guest_execution_fails_closed(self):
        q = qemu_proof_module()
        good = (
            "ORDAX_INDEPENDENT_SURFACE_IP_REPLACE_EXIT=0\r\n"
            "ORDAX_INDEPENDENT_SURFACE_LOOPBACK=127.0.0.1/8\r\n"
            "ORDAX_INDEPENDENT_SURFACE_IP_REPLACE=PASS\r\n"
        )
        self.assertEqual(q.parse_surface_ip_proof(good)["exit_code"], 0)
        for bad in (
            good.replace("EXIT=0", "EXIT=2"),
            good.replace("127.0.0.1/8", "127.0.0.2/8"),
            good + "ORDAX_INDEPENDENT_SURFACE_IP_REPLACE_EXIT=0\n",
            good.replace("ORDAX_INDEPENDENT_SURFACE_IP_REPLACE=PASS\r\n", ""),
        ):
            with self.assertRaises(q.BaseError):
                q.parse_surface_ip_proof(bad)

    def test_identity_receipt_requires_static_iproute2(self):
        b = builder()
        with tempfile.TemporaryDirectory() as dirname:
            target = Path(dirname)
            (target / "sbin").mkdir()
            ip = target / "sbin/ip"
            ip.write_text("fixture", encoding="ascii")
            ip.chmod(stat.S_IRWXU)
            version = type("R", (), {"returncode": 0, "stdout": "ip utility, iproute2-6.15.0\n", "stderr": ""})()
            with patch.object(b.subprocess, "run", return_value=version), patch.object(
                b, "run", side_effect=[
                    "ELF 64-bit LSB executable, x86-64, statically linked",
                    "There is no dynamic section in this file.",
                ]
            ):
                receipt = b.verify_surface_ip_identity(target)
        self.assertEqual(receipt["entrypoint"], "/sbin/ip")
        self.assertEqual(receipt["dynamic_dependencies"], [])
        self.assertEqual(receipt["linkage"], "static")
        self.assertRegex(receipt["sha256"], r"^[0-9a-f]{64}$")


if __name__ == "__main__":
    unittest.main()
