"""Prove boot and post-DHCP resolver refresh share one safe Native helper."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SYNC = ROOT / "system/surface/runtime/resolver-sync.sh"
BROKER = ROOT / "system/surface/runtime/network_broker.sh"
SURFACE = ROOT / "system/surface/bin/ordax-surface"


class NativeResolverSyncTests(unittest.TestCase):
    def test_shell_syntax(self):
        for path in (SYNC, BROKER, SURFACE):
            subprocess.run(["sh", "-n", str(path)], check=True)

    @unittest.skipUnless(Path("/bin/busybox").exists(), "Requires Owner BusyBox runtime")
    def test_late_network_changes_replace_boot_dns_snapshot(self):
        with tempfile.TemporaryDirectory() as td:
            directory = Path(td)
            source = directory / "host-resolver"
            root = directory / "native"
            (root / "etc").mkdir(parents=True)
            log = directory / "native.log"
            old = "nameserver 10.0.2.3\n"
            new = "nameserver 1.1.1.1\n"
            for wanted in (old, new):
                source.write_text(wanted, encoding="utf-8")
                env = {**os.environ, "ORDAX_RESOLVER_SOURCE_PATH": str(source)}
                result = subprocess.run(["sh", str(SYNC), str(root), str(log)],
                                        env=env, capture_output=True, timeout=5)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual((root / "etc/resolv.conf").read_text(encoding="utf-8"), wanted)

    @unittest.skipUnless(Path("/bin/busybox").exists(), "Requires Owner BusyBox runtime")
    def test_invalid_dns_fails_closed_without_erasing_known_good(self):
        with tempfile.TemporaryDirectory() as td:
            directory = Path(td)
            source = directory / "host-resolver"
            root = directory / "native"
            (root / "etc").mkdir(parents=True)
            (root / "etc/resolv.conf").write_text("nameserver 10.0.2.3\n", encoding="utf-8")
            source.write_text("invalid DNS source\n", encoding="utf-8")
            env = {**os.environ, "ORDAX_RESOLVER_SOURCE_PATH": str(source)}
            result = subprocess.run(["sh", str(SYNC), str(root), str(directory / "native.log")],
                                    env=env, capture_output=True, timeout=5)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual((root / "etc/resolv.conf").read_text(encoding="utf-8"),
                             "nameserver 10.0.2.3\n")

if __name__ == "__main__":
    unittest.main()
