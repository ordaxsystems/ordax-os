"""OrdaX network status must exist before its first invocation."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NETWORK = ROOT / "bootstrap/dev-base/ordax-network"


class DevNetworkStatusOrderTests(unittest.TestCase):
    def test_function_defined_before_early_status_on_hardware_boot(self):
        source = NETWORK.read_text(encoding="utf-8")
        first_definition = source.index("\nwrite_network_status() {")
        first_early_call = source.index("\nwrite_network_status no-ip startup || true")
        self.assertLess(first_definition, first_early_call)
        self.assertIn("[ \"$hardware_only\" -eq 1 ] && exit 0", source)
        self.assertLess(source.index("[ \"$hardware_only\" -eq 1 ] && exit 0"), first_early_call)

    def test_shell_parses(self):
        subprocess.run(["/bin/sh", "-n", str(NETWORK)], check=True)


if __name__ == "__main__":
    unittest.main()
