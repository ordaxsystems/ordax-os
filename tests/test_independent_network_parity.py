"""Independent base Surface/loopback tool parity: no network mutations."""
import importlib.util
from pathlib import Path
import stat
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "bootstrap/independent-base"


def builder():
    spec = importlib.util.spec_from_file_location("iproute2_parity_builder", BASE / "build.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class IndependentIPParity(unittest.TestCase):
    def test_real_product_contract_matches_buildroot_profile(self):
        profile = (BASE / "configs/ordax_minimal_defconfig").read_text(encoding="utf-8")
        self.assertEqual(profile.splitlines().count("BR2_PACKAGE_IPROUTE2=y"), 1)
        surface = (ROOT / "system/surface/bin/ordax-surface").read_text(encoding="utf-8")
        self.assertIn('/sbin/ip address replace 127.0.0.1/8 dev lo', surface)
        self.assertIn('verify_surface_loopback_ip(target)', (BASE / "build.py").read_text(encoding="utf-8"))

    def test_missing_and_busybox_ip_fail_closed(self):
        b = builder()
        with tempfile.TemporaryDirectory() as dirname:
            target = Path(dirname)
            (target / "sbin").mkdir()
            with self.assertRaises(b.BaseError):
                b.verify_surface_loopback_ip(target)
            ip = target / "sbin/ip"
            ip.write_text("#!/bin/sh\nprintf 'BusyBox ip\\n'\n", encoding="utf-8")
            ip.chmod(stat.S_IRWXU)
            with self.assertRaisesRegex(b.BaseError, "iproute2"):
                b.verify_surface_loopback_ip(target)

    def test_surface_ip_syntax_probe_is_read_only(self):
        # Unit fixture only checks validation. Buildroot CI executes ACTUAL
        # target iproute2 -V/address help; no ip link/addr changes on host.
        b = builder()
        with tempfile.TemporaryDirectory() as dirname:
            target = Path(dirname)
            (target / "sbin").mkdir()
            ip = target / "sbin/ip"
            ip.write_text(
                "#!/bin/sh\n"
                "if [ \"$1\" = -V ]; then echo 'ip utility, iproute2-6.15.0'; exit 0; fi\n"
                "if [ \"$1\" = address ] && [ \"$2\" = help ]; then "
                "echo 'ip address add|change|replace'; exit 255; fi\n"
                "exit 99\n", encoding="utf-8",
            )
            ip.chmod(stat.S_IRWXU)
            b.verify_surface_loopback_ip(target)
            ip.write_text(ip.read_text().replace("|replace", ""), encoding="utf-8")
            with self.assertRaisesRegex(b.BaseError, "address replace"):
                b.verify_surface_loopback_ip(target)


if __name__ == "__main__":
    unittest.main()
