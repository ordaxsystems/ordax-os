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
SURFACE_LAUNCHER = ROOT / "system" / "surface" / "bin" / "ordax-surface"
CONTRACT = ROOT / "system" / "contracts" / "network-management.mjs"
ADAPTER = ROOT / "system" / "adapters" / "native" / "network-management.mjs"
COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"
RUNTIME = ROOT / "system" / "adapters" / "native" / "runtime.mjs"
SETTINGS_CONTROLS = ROOT / "system" / "surface" / "ui" / "settings-overview-controls.mjs"
QUICK_CONTROLS = ROOT / "system" / "surface" / "ui" / "network-quick-panel.mjs"
NETWORK_RUNTIME = ROOT / "system" / "services" / "network" / "management-runtime.mjs"
CAPABILITIES = ROOT / "docs" / "contracts" / "product-capabilities.json"

spec = importlib.util.spec_from_file_location("ordax_native_network_management_test", SERVER)
native_host = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(native_host)


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
                ("online", "0", False, "dhcp\n"),
                ("online", "1", False, ""),
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
        self.assertIn('restore_wired_network_if_needed >/dev/null 2>&1 || true', broker)
        self.assertIn('WIFI_TOOLS_READY=0', broker)
        self.assertIn('wifi-tools-unavailable', broker)
        self.assertIn('timeout -k 1 8 "$UDHCPC_BIN"', broker)

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

    def test_first_run_wifi_waits_for_wpa_handshake_and_bounded_scan(self):
        text = BROKER.read_text(encoding="utf-8")
        self.assertIn('WPA_CLI_BIN=$(command -v wpa_cli || true)', text)
        self.assertIn('[ -n "$WPA_CLI_BIN" ]', text)
        self.assertIn('WPA_CTRL_DIR=/run/ordax-wpa-supplicant', text)
        self.assertIn('-O"$WPA_CTRL_DIR" -i "$wifi" -c "$conf"', text)
        self.assertIn('grep -q \'^wpa_state=COMPLETED$\'', text)
        self.assertIn('/bin/busybox timeout -k 1 15 "$IW_BIN" dev "$wifi" scan', text)
        self.assertLess(
            text.index('if ! wait_for_wifi_link "$wifi"; then'),
            text.index('    try_dhcp "$wifi"', text.index('connect_conf()')),
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
