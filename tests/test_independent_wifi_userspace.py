from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "bootstrap/independent-base"
PROFILE = BASE / "configs/ordax_minimal_defconfig"
POST_BUILD = BASE / "post-build.sh"
PROBE = BASE / "overlay/sbin/ordax-independent-probe-init"
BROKER = ROOT / "system/surface/runtime/network_broker.sh"


class IndependentWifiUserspaceParityTests(unittest.TestCase):
    def test_profile_selects_only_current_wifi_broker_consumers(self):
        profile = PROFILE.read_text(encoding="utf-8")
        for symbol in (
            "BR2_PACKAGE_IW=y",
            "BR2_PACKAGE_WPA_SUPPLICANT=y",
            "BR2_PACKAGE_WPA_SUPPLICANT_NL80211=y",
            "BR2_PACKAGE_CA_CERTIFICATES=y",
        ):
            self.assertEqual(profile.splitlines().count(symbol), 1, symbol)
        for omitted in (
            "# BR2_PACKAGE_WPA_SUPPLICANT_WEXT is not set",
            "# BR2_PACKAGE_WPA_SUPPLICANT_CLI is not set",
            "# BR2_PACKAGE_WPA_SUPPLICANT_PASSPHRASE is not set",
            "# BR2_PACKAGE_WPA_SUPPLICANT_CTRL_IFACE is not set",
            "# BR2_PACKAGE_WPA_SUPPLICANT_DBUS is not set",
            "# BR2_PACKAGE_WPA_SUPPLICANT_WPA3 is not set",
            "# BR2_PACKAGE_WPA_SUPPLICANT_WPS is not set",
            "# BR2_PACKAGE_WPA_SUPPLICANT_EAP is not set",
        ):
            self.assertEqual(profile.splitlines().count(omitted), 1, omitted)
        self.assertNotIn("BR2_PACKAGE_LINUX_FIRMWARE", profile)
        self.assertNotIn("BR2_LINUX_KERNEL=y", profile)

    def test_profile_matches_canonical_surface_network_broker_tools(self):
        broker = BROKER.read_text(encoding="utf-8")
        for tool in ("ip", "iw", "wpa_supplicant", "udhcpc"):
            self.assertIn(f'command -v {tool}', broker)
        self.assertIn('STATE_DIR=${ORDAX_NETWORK_STATE_DIR:-/state/network}', broker)
        self.assertIn('WPA_CONF=$STATE_DIR/wpa.conf', broker)
        self.assertIn('"$WPA_BIN" -B -i "$wifi" -c "$conf"', broker)
        self.assertIn('"$IW_BIN" dev "$wifi" scan', broker)
        self.assertNotIn('wpa_cli', broker)

    def test_post_build_fails_closed_on_missing_or_unused_wifi_payload(self):
        post_build = POST_BUILD.read_text(encoding="utf-8")
        for required in (
            '$TARGET_DIR/usr/sbin/iw',
            '$TARGET_DIR/usr/sbin/wpa_supplicant',
            '$TARGET_DIR/etc/ssl/certs/ca-certificates.crt',
            '-----BEGIN CERTIFICATE-----',
        ):
            self.assertIn(required, post_build)
        for forbidden in (
            '$TARGET_DIR/usr/sbin/wpa_cli',
            '$TARGET_DIR/usr/sbin/wpa_passphrase',
        ):
            self.assertIn(forbidden, post_build)
        self.assertNotIn("rm -", post_build)

    def test_qemu_executes_userspace_without_claiming_wifi_hardware(self):
        probe = PROBE.read_text(encoding="utf-8")
        self.assertIn('/usr/sbin/iw --version', probe)
        self.assertIn('/usr/sbin/wpa_supplicant -v', probe)
        self.assertIn('ORDAX_INDEPENDENT_WIFI_USERSPACE=READY', probe)
        self.assertIn('ORDAX_INDEPENDENT_CA_BUNDLE=READY', probe)
        self.assertIn('QEMU has no supported Wi-Fi adapter attached here', probe)
        self.assertLess(
            probe.index('ORDAX_INDEPENDENT_WIFI_USERSPACE=READY'),
            probe.index('ORDAX_INDEPENDENT_BOOT=PASS'),
        )
        qemu = (BASE / "qemu_proof.py").read_text(encoding="utf-8")
        self.assertIn('network_qemu_user_nat_dhcp', qemu)
        self.assertIn('physical_boot_proven', qemu)
        self.assertNotIn('wifi_hardware_proven": True', qemu)


if __name__ == "__main__":
    unittest.main()
