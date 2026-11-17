import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
BROKER = ROOT / "system" / "surface" / "runtime" / "network_broker.sh"
BOOT_NETWORK = ROOT / "bootstrap" / "dev-base" / "ordax-network"
WIRED_BOOTSTRAP = ROOT / "bootstrap" / "network" / "bring-up"
SURFACE_LAUNCHER = ROOT / "system" / "surface" / "bin" / "ordax-surface"
CONTRACT = ROOT / "system" / "contracts" / "network-management.mjs"
ADAPTER = ROOT / "system" / "adapters" / "native" / "network-management.mjs"
COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"
RUNTIME = ROOT / "system" / "adapters" / "native" / "runtime.mjs"
SETTINGS_CONTROLS = ROOT / "system" / "surface" / "ui" / "settings-overview-controls.mjs"
QUICK_CONTROLS = ROOT / "system" / "surface" / "ui" / "network-quick-panel.mjs"
NETWORK_RUNTIME = ROOT / "system" / "services" / "network" / "management-runtime.mjs"
CAPABILITIES = ROOT / "docs" / "contracts" / "product-capabilities.json"

# The native host uses POSIX file locks. Keep the test module loadable on
# Windows developer machines; Linux CI still runs the full integration suite.
NATIVE_HOST_AVAILABLE = importlib.util.find_spec("fcntl") is not None
if NATIVE_HOST_AVAILABLE:
    spec = importlib.util.spec_from_file_location("ordax_native_network_management_test", SERVER)
    native_host = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(native_host)
else:
    native_host = None


@unittest.skipUnless(NATIVE_HOST_AVAILABLE, "native network host tests require POSIX fcntl")
class NativeNetworkManagementTests(unittest.TestCase):
    def test_wpa_psk_is_derived_locally_without_returning_password(self):
        expected = hashlib.pbkdf2_hmac(
            "sha1",
            b"password",
            b"IEEE",
            4096,
            dklen=32,
        ).hex()
        self.assertEqual(native_host.derive_wpa_psk("IEEE", "password"), expected)
        self.assertEqual(
            expected,
            "f42c6fc52df0ebef9ebb4b90b38a5f902e83fe1b135a70e23aed762e9710a12e",
        )

    def test_wifi_input_limits_match_real_ssid_and_passphrase_bounds(self):
        self.assertTrue(native_host.valid_wifi_ssid("Rede de casa"))
        self.assertTrue(native_host.valid_wifi_ssid("á" * 16))
        self.assertFalse(native_host.valid_wifi_ssid("á" * 17))
        self.assertFalse(native_host.valid_wifi_ssid("x" * 33))
        self.assertFalse(native_host.valid_wifi_ssid("rede\nquebrada"))
        self.assertTrue(native_host.valid_wifi_password("12345678"))
        self.assertTrue(native_host.valid_wifi_password("x" * 63))
        self.assertFalse(native_host.valid_wifi_password("x" * 7))
        self.assertFalse(native_host.valid_wifi_password("x" * 64))
        self.assertFalse(native_host.valid_wifi_password("senha\nindevida"))

    def test_scan_parser_keeps_only_supported_psk_networks_and_strongest_bss(self):
        scan = (
            "BSS aa:aa:aa:aa:aa:01(on wlan0)\n"
            "\tsignal: -68.00 dBm\n"
            "\tSSID: Casa\n"
            "\tRSN:\n"
            "\t\tAuthentication suites: PSK\n"
            "BSS aa:aa:aa:aa:aa:02(on wlan0)\n"
            "\tsignal: -41.00 dBm\n"
            "\tSSID: Casa\n"
            "\tRSN:\n"
            "\t\tAuthentication suites: PSK\n"
            "BSS bb:bb:bb:bb:bb:01(on wlan0)\n"
            "\tsignal: -55.00 dBm\n"
            "\tSSID: Aberta\n"
            "BSS cc:cc:cc:cc:cc:01(on wlan0)\n"
            "\tsignal: -60.00 dBm\n"
            "\tSSID: Empresa\n"
            "\tRSN:\n"
            "\t\tAuthentication suites: 802.1X\n"
        )
        networks = native_host.parse_iw_scan(
            scan,
            current_ssid="Casa",
            saved_ssid="Casa",
        )
        self.assertEqual(
            networks,
            [
                {
                    "ssid": "Casa",
                    "signalDbm": -41,
                    "security": "wpa-psk",
                    "connected": True,
                    "saved": True,
                }
            ],
        )

    def test_snapshot_reads_only_ssid_state_and_never_secret_material(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = native_host.network_broker_paths(str(root))
            Path(paths["link"]).write_text(
                "Connected to aa:bb:cc:dd:ee:ff (on wlan0)\n"
                "\tSSID: Casa\n"
                "\tsignal: -44 dBm\n",
                encoding="utf-8",
            )
            Path(paths["saved"]).write_text(
                "ssid=" + "Casa".encode("utf-8").hex() + "\n",
                encoding="utf-8",
            )
            Path(paths["scan"]).write_text(
                "BSS aa:bb:cc:dd:ee:ff(on wlan0)\n"
                "\tsignal: -44.00 dBm\n"
                "\tSSID: Casa\n"
                "\tRSN:\n"
                "\t\tAuthentication suites: PSK\n",
                encoding="utf-8",
            )
            snapshot = native_host.build_network_management_snapshot(paths, "wlan0")
            self.assertEqual(snapshot["currentSsid"], "Casa")
            self.assertEqual(snapshot["savedSsid"], "Casa")
            flattened = json.dumps(snapshot).lower()
            for forbidden in ("password", "passphrase", "psk=", "secret"):
                self.assertNotIn(forbidden, flattened)

    @unittest.skipUnless(hasattr(os, "mkfifo"), "FIFO requires POSIX")
    def test_broker_liveness_requires_private_fifo_with_real_reader(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = native_host.network_broker_paths(temporary)
            os.mkfifo(paths["control"], 0o600)
            self.assertFalse(native_host.network_broker_available(paths))
            reader = os.open(paths["control"], os.O_RDONLY | os.O_NONBLOCK)
            try:
                self.assertTrue(native_host.network_broker_available(paths))
                self.assertEqual(os.read(reader, 32), b"")
            finally:
                os.close(reader)
            self.assertFalse(native_host.network_broker_available(paths))
            linked = root / "network-linked"
            linked.symlink_to(paths["control"])
            self.assertFalse(native_host.network_broker_available(
                {**paths, "control": str(linked)}
            ))

    def test_first_run_wifi_handoff_has_one_wpa_owner_and_broker_recovery(self):
        broker = BROKER.read_text(encoding="utf-8")
        boot = BOOT_NETWORK.read_text(encoding="utf-8")
        surface = SURFACE_LAUNCHER.read_text(encoding="utf-8")
        for assignment in (
            "WPA_CTRL_DIR=/run/ordax-wpa-supplicant",
            "WPA_PID_FILE=/run/ordax-wpa-supplicant.pid",
        ):
            self.assertIn(assignment, boot)
            self.assertIn(assignment, broker)
        self.assertIn("WPA_CONF=$STATE_DIR/wpa.conf", boot)
        self.assertIn("WPA_CONF=$STATE_DIR/wpa.conf", broker)
        self.assertNotIn("killall wpa_supplicant", broker)
        self.assertNotIn("killall wpa_supplicant", boot)
        self.assertIn("wifi_connect_result=owner-unavailable", boot)
        self.assertIn('if ! stop_wifi_client; then', boot)
        self.assertIn('wpa_cli -p "$WPA_CTRL_DIR" -i "$wifi" terminate', boot)
        self.assertIn("controlador WPA existente nao responde", boot)
        self.assertIn('"$WPA_CLI_BIN" -p "$WPA_CTRL_DIR" -i "$wifi" terminate', broker)
        self.assertIn('if ! stop_wifi "$wifi"; then', broker)
        self.assertIn("supervise_network_broker() (", surface)
        self.assertIn('wait "$broker_pid" || broker_exit=$?', surface)
        self.assertIn('kill -TERM "$broker_pid"', surface)
        self.assertIn("trap 'exit 0' HUP INT TERM", broker)
        self.assertNotIn('rm -f "$WPA_CONF"\n', broker.split("        disconnect)", 1)[1].split("        forget)", 1)[0])

    def test_saved_wifi_reconnects_after_boot_and_recovers_dhcp_without_replacing_wpa(self):
        # Execute the checked-in connection policy, not an independent mock
        # implementation. No real networking, credentials or host state touched.
        broker = BROKER.read_text(encoding="utf-8")
        source = broker.split("restore_saved_network_if_needed() {", 1)[1].split("\n}\n", 1)[0]
        self.assertIn('read -r -t "$RECONNECT_INTERVAL" signal <&9', broker)
        self.assertIn('restore_saved_network_if_needed >/dev/null 2>&1 || true', broker)
        self.assertIn("CANDIDATE=$STATE_DIR/wpa.conf.candidate.$$", broker)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            saved = root / "wpa.conf"
            saved.write_text("network={\nssid=43617361\npsk=0\n}\n")
            paused = root / "autoconnect-paused"
            actions = root / "events"
            wpa = root / "wpa-cli"
            wpa.write_text(
                "#!/bin/sh\n"
                'if [ "$NETWORK_TEST_WPA" = online ]; then\n'
                '  case "$*" in *status*) echo wpa_state=COMPLETED ;; *ping*) echo PONG ;; esac\n'
                'else exit 1; fi\n'
            )
            wpa.chmod(0o700)
            script = (
                'set -eu\n'
                'find_wifi_interface() { printf "%s\\n" wlan0; }\n'
                'have_ipv4() { [ "$NETWORK_TEST_IP" = 1 ]; }\n'
                'try_dhcp() { printf "dhcp\\n" >>"$NETWORK_TEST_EVENTS"; }\n'
                'restore_saved_network() { printf "restore\\n" >>"$NETWORK_TEST_EVENTS"; }\n'
                'sync_runtime_resolver() { printf "dns\\n" >>"$NETWORK_TEST_EVENTS"; }\n'
                'restore_saved_network_if_needed() {' + source + '\n}\n'
                'restore_saved_network_if_needed\n'
            )
            base = dict(
                os.environ,
                WPA_CONF=str(saved), AUTO_CONNECT_PAUSED=str(paused),
                WPA_CTRL_DIR=str(root / "no-wpa-socket"), WPA_CLI_BIN=str(wpa),
                WIFI_TOOLS_READY="1",
                NETWORK_TEST_EVENTS=str(actions), NETWORK_TEST_IP="0",
                NETWORK_TEST_WPA="offline",
            )
            for wpa_state, has_ip, paused_by_user, expected in (
                ("offline", "0", False, "restore\n"),
                ("online", "0", False, "dhcp\ndns\n"),
                ("online", "1", False, "dns\n"),
                ("offline", "0", True, ""),
            ):
                actions.unlink(missing_ok=True)
                if paused_by_user:
                    paused.touch()
                else:
                    paused.unlink(missing_ok=True)
                env = dict(base, NETWORK_TEST_WPA=wpa_state, NETWORK_TEST_IP=has_ip)
                result = subprocess.run(
                    ["/bin/sh", "-c", script], env=env, text=True,
                    capture_output=True, timeout=6, check=False,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(actions.read_text() if actions.exists() else "", expected)

    def test_same_broker_restores_wired_dhcp_without_wifi_tools(self):
        broker = BROKER.read_text(encoding="utf-8")
        self.assertIn("restore_wired_network_if_needed() {", broker)
        self.assertIn('have_any_ipv4 && return 0', broker)
        self.assertIn('for netpath in /sys/class/net/*; do', broker)
        self.assertIn('[ -d "$netpath/wireless" ] && continue', broker)
        self.assertIn('[ "$net_type" = 1 ] || continue', broker)
        self.assertIn('[ "$carrier" = 1 ] || continue', broker)
        self.assertIn('if try_dhcp "$iface"; then', broker)
        wired_reconnect = broker.split('restore_wired_network_if_needed() {', 1)[1].split('\n}\n', 1)[0]
        self.assertIn('sync_runtime_resolver', wired_reconnect)
        self.assertIn('restore_wired_network_if_needed >/dev/null 2>&1 || true', broker)
        self.assertIn('WIFI_TOOLS_READY=0', broker)
        self.assertIn('wifi-tools-unavailable', broker)
        self.assertIn('timeout -k 1 8 "$UDHCPC_BIN"', broker)
        self.assertIn("DHCP_SCRIPT=/ordax/bootstrap/network/udhcpc.script", broker)
        self.assertIn('-i "$wifi" -s "$DHCP_SCRIPT"', broker)
        self.assertIn('[ -x "$DHCP_SCRIPT" ] || return 1', broker)

    def test_early_bootstrap_never_dhcps_unassociated_wifi(self):
        # This boot helper previously tried DHCP on *all* NICs, including the
        # Wi-Fi radio before its canonical WPA owner had authenticated.
        # Keep this wired/USB-only bootstrap consistent with the live broker.
        boot = WIRED_BOOTSTRAP.read_text(encoding="utf-8")
        subprocess.run(["sh", "-n", str(WIRED_BOOTSTRAP)], check=True)
        broker = BROKER.read_text(encoding="utf-8")
        wired = broker.split("restore_wired_network_if_needed() {", 1)[1].split("\n}\n", 1)[0]
        self.assertIn('[ -d "$path/wireless" ] && continue', boot)
        self.assertIn('[ "$net_type" = 1 ] || continue', boot)
        self.assertIn('[ "$carrier" = 1 ] || continue', boot)
        self.assertIn('[ -d "$netpath/wireless" ] && continue', wired)
        self.assertIn('[ "$net_type" = 1 ] || continue', wired)
        self.assertLess(
            boot.index('[ -d "$path/wireless" ] && continue'),
            boot.index('"$NETBOX" udhcpc '),
        )
        self.assertLess(
            boot.index('[ "$net_type" = 1 ] || continue'),
            boot.index('"$NETBOX" ifconfig "$iface" up'),
        )
        self.assertLess(
            boot.index('"$NETBOX" ifconfig "$iface" up'),
            boot.index('if [ -r "$path/carrier" ]; then'),
        )
        self.assertLess(
            boot.index('[ "$carrier" = 1 ] || continue'),
            boot.index('"$NETBOX" udhcpc '),
        )

    def test_wired_carrier_is_read_only_after_interface_is_raised(self):
        # A DOWN NIC can expose an unreadable or 0 carrier. Skipping it
        # before 'ip link set up' strands wired NAT/USB tether indefinitely.
        broker = BROKER.read_text(encoding="utf-8")
        cli = BOOT_NETWORK.read_text(encoding="utf-8")
        broker_wired = broker.split("restore_wired_network_if_needed() {", 1)[1].split("\n}\n", 1)[0]
        cli_wired = cli.split("# Only Ethernet-like", 1)[1].split('wifi=""', 1)[0]
        for name, block, up in (
            ("native-broker", broker_wired, '"$IP_BIN" link set "$iface" up'),
            ("dev-base-cli", cli_wired, 'ip link set "$iface" up'),
        ):
            with self.subTest(owner=name):
                self.assertIn('[ "$net_type" = 1 ] || continue', block)
                self.assertIn('[ -d "$netpath/wireless" ] && continue', block)
                self.assertIn('[ "$carrier" = 1 ] || continue', block)
                self.assertLess(block.index('[ "$net_type" = 1 ] || continue'), block.index(up))
                self.assertLess(block.index(up), block.index('if [ -r "$netpath/carrier" ]; then'))
                self.assertLess(block.index('[ "$carrier" = 1 ] || continue'), block.index('if try_dhcp "$iface"; then'))

    def test_manual_disconnect_remains_paused_and_saved_network_is_never_deleted(self):
        broker = BROKER.read_text(encoding="utf-8")
        disconnect = broker.split("        disconnect)", 1)[1].split("        forget)", 1)[0]
        reconnect = broker.split("        reconnect)", 1)[1].split("        *)", 1)[0]
        self.assertIn('AUTO_CONNECT_PAUSED=$STATE_DIR/autoconnect-paused', broker)
        self.assertIn("pause_tmp=$AUTO_CONNECT_PAUSED.tmp.$$", disconnect)
        self.assertNotIn("pause_tmp=$AUTO_CONNECT_PAUSED.tmp.$\n", disconnect)
        self.assertIn('"$AUTO_CONNECT_PAUSED"', disconnect)
        # The persistent pause receipt must be committed before killing
        # WPA; an interrupted shutdown can no longer reconnect accidentally.
        self.assertLess(
            disconnect.index('mv -f "$pause_tmp" "$AUTO_CONNECT_PAUSED"'),
            disconnect.index('if ! stop_wifi "$wifi"; then'),
        )
        self.assertLess(
            disconnect.index('/bin/busybox sync'),
            disconnect.index('if ! stop_wifi "$wifi"; then'),
        )
        self.assertNotIn('rm -f "$WPA_CONF"', disconnect)
        self.assertIn('rm -f "$AUTO_CONNECT_PAUSED"', reconnect)
        self.assertIn('rm -f "$WPA_CONF" "$AUTO_CONNECT_PAUSED"', broker)

    def test_reconnect_with_no_saved_network_returns_without_killing_broker(self):
        # Run the checked-in reconnect branch with safe fake network operations.
        # Missing WPA state used to reference an unset shell variable with set -u,
        # terminating the sole IPC broker instead of reporting a bounded cause.
        broker = BROKER.read_text(encoding="utf-8")
        reconnect = broker.split("        reconnect)\n", 1)[1].split("            ;;\n", 1)[0]
        self.assertLess(
            reconnect.index('if [ ! -s "$WPA_CONF" ] || [ -L "$WPA_CONF" ]; then'),
            reconnect.index('rm -f "$AUTO_CONNECT_PAUSED"'),
        )
        self.assertIn('connect_failure_reason=reconnect-failed', reconnect)
        # Only replace global filesystem sync inside this isolated fixture;
        # the real policy still retains the original /bin/busybox sync.
        reconnect_fixture = reconnect.replace("/bin/busybox sync", "true")
        script = "\n".join((
            "set -eu",
            "request_id=fixture",
            "wifi=wlan0",
            'respond() { printf "%s\\n" "$4" >>"$NETWORK_TEST_RECEIPTS"; }',
            'capture_link() { :; }',
            'capture_saved_ssid() { :; }',
            'restore_saved_network_if_needed() { printf "restore\\n" >>"$NETWORK_TEST_EVENTS"; return 1; }',
            "reconnect_once() {",
            "case reconnect in",
            "reconnect)",
            reconnect_fixture,
            ";;",
            "esac",
            "}",
            "reconnect_once",
            "",
        ))
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            saved = root / "wpa.conf"
            paused = root / "autoconnect-paused"
            receipts = root / "receipts"
            events = root / "events"
            env = dict(
                os.environ,
                WPA_CONF=str(saved), AUTO_CONNECT_PAUSED=str(paused),
                NETWORK_TEST_RECEIPTS=str(receipts),
                NETWORK_TEST_EVENTS=str(events),
            )
            paused.touch()
            missing = subprocess.run(
                ["/bin/sh", "-c", script], env=env, text=True,
                capture_output=True, timeout=6, check=False,
            )
            self.assertEqual(missing.returncode, 0, missing.stderr)
            self.assertEqual(receipts.read_text(), "saved-network-unavailable\n")
            self.assertTrue(paused.exists(), "no saved state must preserve user pause")
            self.assertFalse(events.exists(), "no WPA owner action without a saved network")

            # A saved credential with failed reconnection still emits a reason
            # and does not exit due to an unset connect_failure_reason.
            saved.write_text("network={\\nssid=43617361\\npsk=0123456789\\n}\\n")
            receipts.unlink()
            retry = subprocess.run(
                ["/bin/sh", "-c", script], env=env, text=True,
                capture_output=True, timeout=6, check=False,
            )
            self.assertEqual(retry.returncode, 0, retry.stderr)
            self.assertEqual(receipts.read_text(), "reconnect-failed\n")
            self.assertEqual(events.read_text(), "restore\n")

    def test_shared_surface_clock_retry_waits_for_ip_before_ntp(self):
        surface = SURFACE_LAUNCHER.read_text(encoding="utf-8")
        section = surface.split("supervise_time_sync_agent() (", 1)[1].split(
            "\n)\n\nstart_time_sync_agent()", 1
        )[0]
        self.assertLess(
            section.index('/bin/busybox ip -4 addr show scope global'),
            section.index('/bin/busybox ntpd -n'),
        )
        self.assertIn('wait "$ntp_pid"', section)
        self.assertIn('trap \'stop_clock_supervisor\' HUP INT TERM', section)
        self.assertIn('kill -TERM "$ntp_pid"', section)
        self.assertIn('supervise_time_sync_agent &', surface)
        self.assertEqual(surface.count("start_time_sync_agent() {"), 1)

    def test_broker_is_shell_valid_private_and_has_no_secret_logging(self):
        subprocess.run(["sh", "-n", str(BROKER)], check=True)
        text = BROKER.read_text(encoding="utf-8")
        self.assertIn('chmod 600 "$CONTROL"', text)
        self.assertIn('chmod 600 "$CANDIDATE"', text)
        self.assertIn('psk=%s', text)
        self.assertIn('rm -f "$CANDIDATE"', text)
        self.assertIn('restore_saved_network "$wifi"', text)
        self.assertNotIn("set -x", text)
        self.assertNotIn('echo "$psk_hex"', text)
        self.assertNotIn('echo "$ssid_hex"', text)
        self.assertNotIn("logger", text)

    def test_dhcp_timeout_reports_lost_wpa_link_as_authentication_failure(self):
        # Exercise the checked-in connect_conf shell body with fake WPA/DHCP
        # commands. No host interface or credentials are changed.
        broker = BROKER.read_text(encoding="utf-8")
        body = broker.split("connect_conf() {", 1)[1].split("\n}\n", 1)[0]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ("udhcpc.script", "netbox", "candidate.conf"):
                path = root / name
                path.write_text("fixture\n", encoding="utf-8")
                path.chmod(0o700)
            wpa_cli = root / "fake-wpa-cli"
            wpa_cli.write_text(
                "#!/bin/sh\n"
                'if [ "$NETWORK_TEST_WPA_COMPLETED" = 1 ]; then\n'
                '  printf "%s\\n" "wpa_state=COMPLETED"\n'
                'else\n'
                '  printf "%s\\n" "wpa_state=DISCONNECTED"\n'
                'fi\n',
                encoding="utf-8",
            )
            wpa_cli.chmod(0o700)
            script = (
                "set -eu\n"
                "stop_wifi() { :; }\n"
                "wait_for_wifi_link() { return 0; }\n"
                "try_dhcp() { return 1; }\n"
                "sync_runtime_resolver() { :; }\n"
                "connect_conf() {" + body + "\n}\n"
                'connect_conf wlan0 "$NETWORK_TEST_CANDIDATE" || '
                'printf "%s\\n" "$connect_failure_reason"\n'
            )
            for completed, expected in (
                ("1", "dhcp-failed\n"),
                ("0", "authentication-failed\n"),
            ):
                env = {
                    **os.environ,
                    "DHCP_SCRIPT": str(root / "udhcpc.script"),
                    "DHCP_NETBOX": str(root / "netbox"),
                    "WPA_CTRL_DIR": str(root / "wpa"),
                    "WPA_PID_FILE": str(root / "wpa.pid"),
                    "WPA_BIN": "/bin/true",
                    "WPA_CLI_BIN": str(wpa_cli),
                    "NETWORK_TEST_CANDIDATE": str(root / "candidate.conf"),
                    "NETWORK_TEST_WPA_COMPLETED": completed,
                }
                result = subprocess.run(
                    ["/bin/sh", "-c", script],
                    env=env, text=True, capture_output=True,
                    timeout=6, check=False,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, expected)

    def test_unattended_wpa_recovery_yields_to_pending_first_use_request(self):
        # Execute the checked-in WPA wait and auto-restoration functions with
        # fake commands. Requests from the Native host must outrank automatic
        # reconnection, without interrupting the user's own connect attempt.
        broker = BROKER.read_text(encoding="utf-8")
        wait_body = broker.split("wait_for_wifi_link() {", 1)[1].split("\n}\n", 1)[0]
        restore_body = broker.split("auto_restore_saved_network_if_needed() {", 1)[1].split("\n}\n", 1)[0]
        self.assertIn("auto_restore_saved_network_if_needed", broker.split('exec 9<>"$CONTROL"', 1)[1])
        connect_action = broker.split("        connect)\n", 1)[1].split("        disconnect)", 1)[0]
        self.assertIn("auto_restore_saved_network_if_needed", connect_action)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            request = root / "network-request"
            wpa = root / "wpa-cli"
            wpa.write_text("#!/bin/sh\nprintf '%s\\n' 'wpa_state=COMPLETED'\n", encoding="utf-8")
            wpa.chmod(0o700)
            env = {
                **os.environ,
                "NETWORK_TEST_REQUEST": str(request),
                "NETWORK_TEST_WPA_CLI": str(wpa),
            }
            wait_script = (
                "set -eu\n"
                'WPA_CLI_BIN=$NETWORK_TEST_WPA_CLI\n'
                'WPA_CTRL_DIR=/run/test-wpa\n'
                'REQUEST=$NETWORK_TEST_REQUEST\n'
                'WIFI_HANDSHAKE_ATTEMPTS=18\n'
                'wait_for_wifi_link() {' + wait_body + "\n}\n"
                "wait_for_wifi_link wlan0\n"
            )
            for active, pending, expected_rc in (
                ("1", True, 1),
                ("0", True, 0),
                ("1", False, 0),
            ):
                request.write_text("pending\n" if pending else "", encoding="utf-8")
                result = subprocess.run(
                    ["/bin/sh", "-c", wait_script],
                    env={**env, "AUTO_RECOVERY_ACTIVE": active},
                    capture_output=True, text=True, timeout=5, check=False,
                )
                self.assertEqual(expected_rc, result.returncode, result.stderr)

            restored = root / "restored"
            wrapper_script = (
                "set -eu\n"
                'REQUEST=$NETWORK_TEST_REQUEST\n'
                'AUTO_RECOVERY_ACTIVE=0\n'
                'restore_saved_network_if_needed() { printf "restored\\n" >>"$NETWORK_TEST_RESTORED"; }\n'
                'auto_restore_saved_network_if_needed() {' + restore_body + "\n}\n"
                'auto_restore_saved_network_if_needed\n'
                'test "$AUTO_RECOVERY_ACTIVE" -eq 0\n'
            )
            for pending in (True, False):
                request.write_text("pending\n" if pending else "", encoding="utf-8")
                restored.unlink(missing_ok=True)
                result = subprocess.run(
                    ["/bin/sh", "-c", wrapper_script],
                    env={**env, "NETWORK_TEST_RESTORED": str(restored)},
                    capture_output=True, text=True, timeout=5, check=False,
                )
                self.assertEqual(0, result.returncode, result.stderr)
                self.assertEqual(restored.exists(), not pending)

    def test_broker_failure_reasons_are_bounded_and_have_enough_wpa_time(self):
        broker = BROKER.read_text(encoding="utf-8")
        host = SERVER.read_text(encoding="utf-8")
        for reason in ("authentication-failed", "dhcp-failed", "supplicant-start-failed",
                       "network-owner-unavailable"):
            self.assertIn(reason, broker)
            self.assertIn(reason, host)
        self.assertIn("WIFI_HANDSHAKE_ATTEMPTS=18", broker)
        self.assertIn('failure_reason=$connect_failure_reason', broker)
        self.assertIn('respond "$request_id" error "$wifi" "$failure_reason"', broker)
        self.assertIn('self._write_json(status, {"reason": detail})', host)
        self.assertIn('self._write_json(503, {"reason": "network-broker-unavailable"})', host)
        self.assertIn('self._write_json(503, {"reason": "network-broker-timeout"})', host)
        self.assertIn('self._write_json(503, {"reason": "network-broker-io-failed"})', host)
        self.assertIn('timeout_seconds=42.0 if action in {"connect", "reconnect"}', host)
        self.assertIn('"dhcp-runtime-unavailable", "scan-failed"', host)
        self.assertIn('DHCP_NETBOX=/ordax/bootstrap/network/bin/netbox', broker)
        connect = broker.split("connect_conf() {", 1)[1].split("\n}", 1)[0]
        self.assertLess(
            connect.index('if [ ! -x "$DHCP_SCRIPT" ] || [ ! -x "$DHCP_NETBOX" ]; then'),
            connect.index('if ! stop_wifi "$wifi"; then'),
            "A missing native DHCP dependency must not terminate an existing WPA connection",
        )
        self.assertIn("connect_failure_reason=dhcp-runtime-unavailable", connect)

    def test_native_connect_rejects_bad_http_inputs_before_wpa_with_bounded_reason(self):
        host = SERVER.read_text(encoding="utf-8")
        post = host.rsplit("if self.path == NETWORK_MANAGEMENT_PATH:", 1)[1].split(
            "if parsed_path == KEYBOARD_LAYOUT_APPLY_PATH:", 1
        )[0]
        self.assertIn('self._write_json(400, {"reason": "network-request-invalid"})', post)
        self.assertIn('self._write_json(400, {"reason": "invalid-credentials"})', post)
        self.assertIn('self._write_json(503, {"reason": "network-native-response-invalid"})', post)
        self.assertIn('expected = {"action", "ssid", "password"} if action == "connect" else {"action"}', post)
        self.assertIn('if set(payload) != expected:', post)
        self.assertLess(
            post.index('if set(payload) != expected:'),
            post.index('with self.server.network_lock:'),
        )
        self.assertLess(
            post.index('not valid_wifi_password(payload.get("password"))'),
            post.index('with self.server.network_lock:'),
        )
        self.assertNotIn('{"reason": payload', post)
        self.assertNotIn('{"password":', post)

    def test_first_run_wifi_waits_for_wpa_handshake_and_bounded_scan(self):
        text = BROKER.read_text(encoding="utf-8")
        self.assertIn('WPA_CLI_BIN=$(command -v wpa_cli || true)', text)
        self.assertIn('[ -n "$WPA_CLI_BIN" ]', text)
        self.assertIn('WPA_CTRL_DIR=/run/ordax-wpa-supplicant', text)
        self.assertIn('-O"$WPA_CTRL_DIR" -i "$wifi" -c "$conf"', text)
        self.assertIn('grep -q \'^wpa_state=COMPLETED$\'', text)
        self.assertIn('/bin/busybox timeout -k 1 15 "$IW_BIN" dev "$wifi" scan', text)
        host = SERVER.read_text(encoding="utf-8")
        # Native must outlast the broker's own bounded 15s scan + cleanup.
        self.assertIn('20.0 if action == "scan" else 12.0', host)
        self.assertLess(
            text.index('if ! wait_for_wifi_link "$wifi"; then'),
            text.index('    if ! try_dhcp "$wifi"; then', text.index('connect_conf()')),
        )
        self.assertNotIn("grep -q '^Connected to '", text)

    def test_native_api_is_loopback_tokenized_serialized_and_no_shell_endpoint(self):
        server = SERVER.read_text(encoding="utf-8")
        get_section = server.split("def do_GET", 1)[1].split("def do_POST", 1)[0]
        post_section = server.split("def do_POST", 1)[1]
        self.assertIn('NETWORK_MANAGEMENT_PATH = "/__ordax/native/network-management"', server)
        self.assertIn('NETWORK_TOKEN_HEADER = "X-OrdaX-Network-Token"', server)
        self.assertIn("self.network_token = secrets.token_urlsafe(32)", server)
        self.assertIn("self.network_lock = threading.Lock()", server)
        self.assertIn("SESSION_PATH", get_section)
        self.assertIn("NETWORK_MANAGEMENT_PATH", get_section)
        self.assertIn("networkToken", get_section)
        self.assertIn("queue_network_broker_request", get_section)
        self.assertIn("if self.path == NETWORK_MANAGEMENT_PATH", post_section)
        self.assertIn("with self.server.network_lock:", post_section)
        # The Native Host may legitimately use subprocess in unrelated,
        # separately authorized features. The Wi-Fi IPC must never gain
        # shell/terminal execution authority; verify the actual boundary.
        network_queue = server.split("def queue_network_broker_request(", 1)[1].split(
            "\ndef native_install_broker_paths(", 1
        )[0]
        for forbidden in ("subprocess", "os.system", "/bin/sh -c", "Popen("):
            self.assertNotIn(forbidden, network_queue)
        self.assertIn('os.open(', network_queue)
        self.assertIn('O_NOFOLLOW', network_queue)
        self.assertIn('os.fstat(descriptor)', network_queue)

    def test_capability_is_native_only_and_composition_probes_fail_soft(self):
        capabilities = json.loads(CAPABILITIES.read_text(encoding="utf-8"))
        entries = {entry["id"]: entry for entry in capabilities["capabilities"]}
        self.assertEqual(
            entries["network.management"]["security_boundary"],
            "loopback-token-host-network-broker",
        )
        modes = {mode["id"]: mode for mode in capabilities["modes"]}
        self.assertIn("network.management", modes["usb"]["baseline_capabilities"])
        self.assertIn("network.management", modes["native-disk"]["baseline_capabilities"])
        for mode in ("web", "mobile", "desktop"):
            self.assertNotIn("network.management", modes[mode]["baseline_capabilities"])

        composition = COMPOSITION.read_text(encoding="utf-8")
        runtime = RUNTIME.read_text(encoding="utf-8")
        self.assertIn("createNativeNetworkManagement", composition)
        self.assertIn("optionalNativeProbe", composition)
        self.assertIn("() => createNativeNetworkManagement(window)", composition)
        self.assertIn("networkManagementAvailable", composition)
        self.assertIn('"network.management"', runtime)

    def test_settings_ui_consumes_neutral_port_and_keeps_password_ephemeral(self):
        controls = SETTINGS_CONTROLS.read_text(encoding="utf-8")
        composition = COMPOSITION.read_text(encoding="utf-8")
        self.assertIn("contracts/network-management.mjs", controls)
        self.assertIn("assertNetworkManagementPort", controls)
        self.assertIn('"network.quick.action.scan"', controls)
        self.assertIn('"network.quick.action.connect"', controls)
        self.assertIn('"network.quick.action.disconnect"', controls)
        self.assertIn('"settings.network.action.forget"', controls)
        self.assertIn('"network.quick.action.reconnect"', controls)
        self.assertIn('input.type = "password"', controls)
        self.assertIn('input.autocomplete = "off"', controls)
        self.assertIn('input.value = ""', controls)
        self.assertIn('let password = input.value', controls)
        self.assertNotIn("localStorage", controls)
        self.assertNotIn("sessionStorage", controls)
        self.assertNotIn("/__ordax/native/network-management", controls)
        self.assertNotIn("networkPassword", controls)
        self.assertIn("captureInteractionState", controls)
        self.assertIn("restoreInteractionState", controls)
        self.assertIn('slot.closest(".ordax-window-body")', controls)
        self.assertIn("passwordInput.value", controls)
        self.assertIn("passwordInput.setSelectionRange", controls)
        self.assertIn("focusTarget.focus({ preventScroll: true })", controls)
        self.assertNotIn("passwordSnapshot", controls)
        self.assertIn("networkManagement,", composition)

    def test_settings_live_refresh_preserves_only_transient_interaction_state(self):
        controls = SETTINGS_CONTROLS.read_text(encoding="utf-8")
        capture = controls.split("const captureInteractionState = (slot) => {", 1)[1].split(
            "\n  };", 1
        )[0]
        restore = controls.split("const restoreInteractionState = (slot, snapshot) => {", 1)[1].split(
            "\n  };", 1
        )[0]

        self.assertIn("documentObject.activeElement", capture)
        self.assertIn("scrollTop", capture)
        self.assertIn("scrollLeft", capture)
        self.assertIn("passwordInput.value", capture)
        self.assertIn("selectionStart", capture)
        self.assertIn("selectionEnd", capture)
        self.assertIn("snapshot.password?.ssid", restore)
        self.assertIn("passwordInput.value = snapshot.password.value", restore)
        self.assertIn("focusTarget.focus({ preventScroll: true })", restore)

        combined = capture + restore
        for forbidden in ("localStorage", "sessionStorage", "fetch(", "preferences.set"):
            self.assertNotIn(forbidden, combined)
        self.assertNotIn("networkManagementMessageId =", capture)
        self.assertNotIn("selectedNetworkSsid =", capture)

    def test_quick_wifi_panel_reuses_neutral_owner_and_keeps_password_ephemeral(self):
        controls = QUICK_CONTROLS.read_text(encoding="utf-8")
        runtime = NETWORK_RUNTIME.read_text(encoding="utf-8")
        settings = SETTINGS_CONTROLS.read_text(encoding="utf-8")
        composition = COMPOSITION.read_text(encoding="utf-8")
        self.assertIn("contracts/network-management.mjs", controls)
        self.assertIn("contracts/network-status.mjs", controls)
        self.assertIn("services/network/management-runtime.mjs", controls)
        self.assertIn("services/network/management-runtime.mjs", settings)
        self.assertIn("networkManagementActionMessageId", settings)
        self.assertIn("networkManagementFailureMessageId", settings)
        self.assertIn("assertNetworkManagementPort", controls)
        self.assertIn("assertNetworkStatusPort", controls)
        self.assertIn("assertSurfaceRenderLifecycle", controls)
        self.assertIn("networkManagementActionMessageId", controls)
        self.assertIn("networkManagementFailureMessageId", controls)
        for action in ("scan", "connect", "disconnect", "forget", "reconnect"):
            self.assertIn(f'case "{action}"', runtime)
        self.assertNotIn('data-quick-network-action="forget"', controls)
        self.assertIn('input.type = "password"', controls)
        self.assertIn('input.autocomplete = "off"', controls)
        self.assertIn('input.value = ""', controls)
        self.assertNotIn("localStorage", controls)
        self.assertNotIn("sessionStorage", controls)
        self.assertNotIn("/__ordax/native/", controls)
        self.assertIn("mountNetworkQuickPanel(root, networkStatus, networkManagement, surface)", composition)
        self.assertIn('reportClientDiagnostic("network-quick-panel", error)', composition)

    def test_native_composition_recovers_if_optional_wifi_settings_mount_fails(self):
        composition = COMPOSITION.read_text(encoding="utf-8")
        self.assertIn("createNativeClientDiagnostics", composition)
        self.assertIn('reportClientDiagnostic("settings-network-management", error)', composition)
        self.assertIn("let settingsOverviewControls;", composition)
        self.assertIn("networkStatus,\n      networkManagement,", composition)
        self.assertIn("networkStatus,\n      null,", composition)
        self.assertLess(
            composition.index('reportClientDiagnostic("settings-network-management", error)'),
            composition.index("void updateWatcher.markHealthy()"),
        )

    def test_contract_and_adapter_do_not_expose_generic_command_execution(self):
        contract = CONTRACT.read_text(encoding="utf-8")
        adapter = ADAPTER.read_text(encoding="utf-8")
        self.assertIn('ordax.network-management/1', contract)
        for action in ("status", "scan", "connect", "disconnect", "forget", "reconnect"):
            self.assertIn(action, contract)
        self.assertIn('X-OrdaX-Network-Token', adapter)
        self.assertIn('/__ordax/native/network-management', adapter)
        for forbidden in ("shell", "command", "exec(", "terminal"):
            self.assertNotIn(forbidden, (contract + adapter).lower())


if __name__ == "__main__":
    unittest.main()
