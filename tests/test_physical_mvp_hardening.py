#!/usr/bin/env python3
"""Regress physical Stable/MVP findings from the first real USB boot."""

from pathlib import Path
import unittest
import re

ROOT = Path(__file__).resolve().parents[1]
KERNEL_FRAGMENT = ROOT / "bootstrap" / "kernel" / "config" / "ordax.fragment"
STABLE_INIT = ROOT / "bootstrap" / "stable-base" / "ordax-stable-init"
SURFACE_STATE = ROOT / "system" / "surface" / "ui" / "surface-state.mjs"
FIRST_RUN_CSS = ROOT / "system" / "surface" / "ui" / "first-run.css"
NORMAL_BOOT = ROOT / "boot" / "portable-v2" / "loader" / "entries" / "ordax-portable.conf"
RECOVERY_BOOT = ROOT / "boot" / "portable-v2" / "loader" / "entries" / "ordax-portable-recovery.conf"


class PhysicalMvpHardeningTests(unittest.TestCase):
    def test_production_kernel_does_not_render_upstream_linux_logo(self):
        text = KERNEL_FRAGMENT.read_text(encoding="utf-8")
        self.assertIn("# CONFIG_LOGO is not set", text)
        self.assertNotIn("CONFIG_LOGO=y", text)

    def test_stable_init_coldplugs_only_supported_wifi_modules_before_surface(self):
        text = STABLE_INIT.read_text(encoding="utf-8")
        self.assertIn("coldplug_supported_wifi_modules()", text)
        for module in ("iwlwifi", "rtl8xxxu", "mt76x2u", "ath9k_htc"):
            self.assertIn(module, text)
        self.assertNotIn("/sys/bus/pci/devices/*/modalias", text)
        self.assertNotIn("/sys/bus/usb/devices/*/modalias", text)
        self.assertIn("/sys/class/net/*", text)
        self.assertIn("ORDAX_WIFI_COLDPLUG=COMPLETE", text)
        self.assertIn("ORDAX_WIFI_INTERFACE=", text)
        self.assertLess(text.index("coldplug_supported_wifi_modules ||"), text.index("exec /system/entrypoint"))

    def test_portable_boot_keeps_serial_and_physical_console_with_distinct_normal_and_recovery_policy(self):
        normal = NORMAL_BOOT.read_text(encoding="utf-8")
        recovery = RECOVERY_BOOT.read_text(encoding="utf-8")
        self.assertIn("console=tty0 console=ttyS0,115200n8", normal)
        self.assertLess(normal.index("console=tty0"), normal.index("console=ttyS0,115200n8"))
        self.assertIn("rdinit=/sbin/ordax-portable-init", normal)
        self.assertIn("quiet", normal)
        self.assertIn("loglevel=3", normal)
        self.assertIn("logo.nologo", normal)
        self.assertNotIn("ignore_loglevel", normal)
        self.assertIn("console=ttyS0,115200n8 console=tty0", recovery)
        self.assertIn("rdinit=/sbin/ordax-portable-init", recovery)
        self.assertIn("loglevel=7", recovery)
        self.assertIn("ignore_loglevel", recovery)
        self.assertIn("logo.nologo", recovery)
        self.assertIn("ordax.mode=recovery", recovery)

    def test_new_product_windows_open_maximized_without_removing_window_controls(self):
        text = SURFACE_STATE.read_text(encoding="utf-8")
        launch = text[text.index('case "app.launch"'):text.index('case "app.target"')]
        self.assertIn("maximized: true", launch)
        self.assertIn('case "window.maximize"', text)

    def test_first_run_footer_remains_in_its_own_visible_layout_row(self):
        text = FIRST_RUN_CSS.read_text(encoding="utf-8")

        def declarations(selector):
            pattern = re.escape(selector) + r"\s*\{([^{}]*)\}"
            match = re.search(pattern, text)
            self.assertIsNotNone(match, f"Missing canonical First Run selector {selector}")
            return match.group(1)

        # Meridian's canonical layout must retain the independently visible
        # footer row: the body scrolls, the footer does not scroll out.
        card = declarations(".ordax-first-run-card")
        body = declarations(".ordax-first-run-body")
        footer = declarations(".ordax-first-run-footer")
        shell = declarations(".ordax-first-run-shell")
        self.assertRegex(card, r"display\s*:\s*grid")
        self.assertRegex(card, r"grid-template-rows\s*:\s*minmax\(0,\s*1fr\)\s+auto\s*;")
        self.assertRegex(card, r"min-height\s*:\s*0")
        self.assertRegex(body, r"overflow\s*:\s*auto")
        self.assertRegex(footer, r"flex\s*:\s*0\s+0\s+auto")
        self.assertRegex(shell, r"height\s*:\s*min\(\d+px,\s*calc\(100dvh\s*-\s*\d+px\)\)")

        # USB/native First Run is desktop-only: its Meridian rail and content
        # panel remain the same layout instead of switching to a phone flow.
        # Height pressure may compact the desktop layout while the rail itself
        # keeps its steps reachable through its own scroll region.
        self.assertRegex(shell, r"min-width\s*:\s*900px")
        self.assertRegex(shell, r"grid-template-columns\s*:\s*var\(--md-rail-width\)\s+minmax\(0,\s*1fr\)")
        progress = declarations(".ordax-first-run-progress")
        self.assertRegex(progress, r"overflow\s*:\s*auto")
        self.assertRegex(text, r"@media\s*\(max-height:\s*800px\)")
        self.assertNotRegex(text, r"@media\s*\(max-width\s*:")



if __name__ == "__main__":
    unittest.main()
