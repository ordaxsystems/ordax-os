#!/usr/bin/env python3
"""Regress physical Stable/MVP findings from the first real USB boot."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
KERNEL_FRAGMENT = ROOT / "bootstrap" / "kernel" / "config" / "ordax.fragment"
STABLE_INIT = ROOT / "bootstrap" / "stable-base" / "ordax-stable-init"
SURFACE_STATE = ROOT / "system" / "surface" / "ui" / "surface-state.mjs"
FIRST_RUN_CSS = ROOT / "system" / "surface" / "ui" / "first-run.css"


class PhysicalMvpHardeningTests(unittest.TestCase):
    def test_production_kernel_does_not_render_upstream_linux_logo(self):
        text = KERNEL_FRAGMENT.read_text(encoding="utf-8")
        self.assertIn("# CONFIG_LOGO is not set", text)
        self.assertNotIn("CONFIG_LOGO=y", text)

    def test_stable_init_coldplugs_physical_pci_and_usb_hardware_before_surface(self):
        text = STABLE_INIT.read_text(encoding="utf-8")
        self.assertIn("coldplug_kernel_modules()", text)
        self.assertIn("/sys/bus/pci/devices/*/modalias", text)
        self.assertIn("/sys/bus/usb/devices/*/modalias", text)
        self.assertIn('/sbin/modprobe "$modalias"', text)
        self.assertIn("/sys/class/net/*", text)
        self.assertIn("ORDAX_KERNEL_COLDPLUG=COMPLETE", text)
        self.assertIn("ORDAX_WIFI_INTERFACE=", text)
        self.assertLess(text.index("coldplug_kernel_modules ||"), text.index("exec /system/entrypoint"))

    def test_new_product_windows_open_maximized_without_removing_window_controls(self):
        text = SURFACE_STATE.read_text(encoding="utf-8")
        launch = text[text.index('case "app.launch"'):text.index('case "app.target"')]
        self.assertIn("maximized: true", launch)
        self.assertIn('case "window.maximize"', text)

    def test_first_run_footer_remains_in_its_own_visible_layout_row(self):
        text = FIRST_RUN_CSS.read_text(encoding="utf-8")
        self.assertIn("grid-template-rows: minmax(0, 1fr) auto", text)
        self.assertIn("min-height: 0", text)
        self.assertIn("height: min(760px, calc(100dvh - 36px))", text)
        self.assertIn(".ordax-first-run-footer", text)
        self.assertIn("flex: 0 0 auto", text)
        self.assertIn("grid-template-columns: repeat(7, 1fr)", text)


if __name__ == "__main__":
    unittest.main()
