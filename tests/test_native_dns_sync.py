"""Prove post-DHCP DNS sync without network, secrets or physical disks."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SYNC = ROOT / "system/surface/runtime/resolver_sync.sh"


class NativeDnsSyncTests(unittest.TestCase):
    def run_sync(self, runtime, log, source, success):
        command = subprocess.run(
            ["sh", str(SYNC), str(runtime), str(log), str(source)],
            text=True, capture_output=True,
        )
        self.assertEqual(command.returncode == 0, success, command.stderr)
        return command

    def test_dhcp_dns_is_applied_after_surface_already_started(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            runtime = root / "runtime"
            etc = runtime / "etc"
            etc.mkdir(parents=True)
            guest = etc / "resolv.conf"
            guest.write_text("nameserver 127.0.0.53\n", encoding="utf-8")
            host = root / "host-resolv.conf"
            log = root / "sync.log"
            host.write_text("nameserver 10.0.2.3\n", encoding="utf-8")
            self.run_sync(runtime, log, host, True)
            self.assertEqual(guest.read_text(encoding="utf-8"), "nameserver 10.0.2.3\n")
            host.write_text("nameserver 192.168.1.1\n", encoding="utf-8")
            self.run_sync(runtime, log, host, True)
            self.assertEqual(guest.read_text(encoding="utf-8"), "nameserver 192.168.1.1\n")
            self.assertEqual(guest.stat().st_mode & 0o777, 0o644)

    def test_stub_only_bad_or_missing_dns_never_overwrites_last_known_good(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            runtime = root / "runtime"
            etc = runtime / "etc"
            etc.mkdir(parents=True)
            guest = etc / "resolv.conf"
            guest.write_text("nameserver 10.0.2.3\n", encoding="utf-8")
            host = root / "host-resolv.conf"
            log = root / "sync.log"
            for content in ("nameserver 127.0.0.53\n", "nameserver ::1\n",
                            "search example.invalid\n", "", "x" * 16385):
                with self.subTest(source=content[:32]):
                    host.write_text(content, encoding="utf-8")
                    self.run_sync(runtime, log, host, False)
                    self.assertEqual(guest.read_text(encoding="utf-8"), "nameserver 10.0.2.3\n")
            host.unlink()
            self.run_sync(runtime, log, host, False)
            self.assertEqual(guest.read_text(encoding="utf-8"), "nameserver 10.0.2.3\n")
            self.assertFalse(list(etc.glob(".resolv.conf.ordax.*")))

    def test_ipv6_dns_remains_supported(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            etc = root / "runtime/etc"
            etc.mkdir(parents=True)
            host = root / "host"
            host.write_text("nameserver 2606:4700:4700::1111\n", encoding="utf-8")
            self.run_sync(root / "runtime", root / "log", host, True)
            self.assertEqual((etc / "resolv.conf").read_text(encoding="utf-8"),
                             "nameserver 2606:4700:4700::1111\n")


if __name__ == "__main__":
    unittest.main()
