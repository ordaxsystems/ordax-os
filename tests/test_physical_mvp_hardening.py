from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NETWORK_BROKER = ROOT / "system" / "surface" / "runtime" / "network_broker.sh"
KERNEL_FRAGMENT = ROOT / "bootstrap" / "kernel" / "config" / "ordax.fragment"
FIRST_RUN_CSS = ROOT / "system" / "surface" / "ui" / "first-run.css"


class PhysicalMvpHardeningTests(unittest.TestCase):
    def test_stable_network_owner_loads_supported_wifi_modules_on_demand(self):
        subprocess.run(["sh", "-n", str(NETWORK_BROKER)], check=True)
        text = NETWORK_BROKER.read_text(encoding="utf-8")

        self.assertIn("MODPROBE_BIN=$(command -v modprobe || true)", text)
        self.assertIn("load_supported_wifi_modules()", text)
        self.assertIn("ensure_wifi_interface()", text)
        self.assertIn("wifi=$(ensure_wifi_interface || true)", text)
        for module in ("iwlwifi", "rtl8xxxu", "mt76x2u", "ath9k_htc"):
            self.assertIn(module, text)

        # Hardware discovery is best-effort, but secret handling stays fail-closed.
        self.assertIn('chmod 600 "$CANDIDATE"', text)
        self.assertNotIn("set -x", text)
        self.assertNotIn('echo "$psk_hex"', text)

    def test_product_kernel_does_not_expose_upstream_linux_logo(self):
        text = KERNEL_FRAGMENT.read_text(encoding="utf-8")
        self.assertIn("# CONFIG_LOGO is not set", text)
        self.assertNotIn("CONFIG_LOGO=y", text)

    def test_first_run_keeps_footer_inside_physical_viewport(self):
        text = FIRST_RUN_CSS.read_text(encoding="utf-8")
        self.assertIn("height: min(720px, calc(100dvh - 72px));", text)
        self.assertIn("max-height: calc(100dvh - 72px);", text)
        self.assertIn("min-height: 0;", text)
        self.assertIn("overflow: hidden;", text)
        self.assertIn("grid-template-columns: repeat(7, 1fr);", text)
        self.assertNotIn("grid-template-columns: repeat(6, 1fr);", text)


if __name__ == "__main__":
    unittest.main()
