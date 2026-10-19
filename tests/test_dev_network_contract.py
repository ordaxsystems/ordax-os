#!/usr/bin/env python3
"""Regressions for the owner-development physical network/maintenance path."""

from __future__ import annotations

from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NETWORK = ROOT / "bootstrap/dev-base/ordax-network"
DEV_INIT = ROOT / "bootstrap/dev-base/ordax-dev-init"


class DevelopmentNetworkContractTest(unittest.TestCase):
    def test_shell_scripts_are_syntactically_valid(self) -> None:
        for script in (NETWORK, DEV_INIT):
            subprocess.run(["/bin/sh", "-n", str(script)], check=True)

    def test_first_run_saves_wifi_credentials_atomically_in_persistent_state(self) -> None:
        text = NETWORK.read_text(encoding="utf-8")
        self.assertIn("STATE_DIR=/state/network", text)
        self.assertIn("CANDIDATE_CONF=$STATE_DIR/wpa.conf.candidate.$$", text)
        self.assertIn("WPA_CONF=$STATE_DIR/wpa.conf", text)
        self.assertIn('chmod 700 "$STATE_DIR"', text)
        self.assertIn('umask 077', text)
        self.assertIn('mv -f "$CANDIDATE_CONF" "$WPA_CONF"', text)
        self.assertIn('/bin/busybox sync', text)
        self.assertNotIn('CANDIDATE_CONF=/run/ordax-wpa-candidate.conf', text)
        self.assertLess(
            text.index('mv -f "$CANDIDATE_CONF" "$WPA_CONF"'),
            text.index('        finish_network "$wifi"', text.index('mv -f "$CANDIDATE_CONF" "$WPA_CONF"')),
        )

    def test_network_status_writer_is_defined_before_startup_use(self) -> None:
        text = NETWORK.read_text(encoding="utf-8")
        writer = text.index("\nwrite_network_status() {")
        status = text.index("\nwrite_network_status no-ip startup || true")
        hardware_exit = text.index('[ "$hardware_only" -eq 1 ] && exit 0')
        self.assertLess(writer, status)
        self.assertLess(hardware_exit, status)
        self.assertEqual(text.count("\nwrite_network_status() {"), 1)

    def test_wired_dhcp_skips_kernel_tunnel_interfaces(self) -> None:
        text = NETWORK.read_text(encoding="utf-8")
        self.assertIn('net_type=$(cat "$netpath/type" 2>/dev/null || true)', text)
        self.assertIn('[ "$net_type" = 1 ] || continue', text)
        self.assertIn('echo "ordax-network: tentando DHCP em $iface"', text)
        self.assertLess(
            text.index('[ "$net_type" = 1 ] || continue'),
            text.index('echo "ordax-network: tentando DHCP em $iface"'),
        )

    def test_wifi_waits_for_completed_wpa_handshake_before_dhcp(self) -> None:
        text = NETWORK.read_text(encoding="utf-8")
        self.assertIn('wpa_state_completed()', text)
        self.assertIn('wait_for_wifi_authentication()', text)
        self.assertIn('wpa_cli -p "$WPA_CTRL_DIR" -i "$wifi" status', text)
        self.assertIn("grep -q '^wpa_state=COMPLETED$'", text)
        self.assertIn('if ! wait_for_wifi_authentication; then', text)
        wait = text.index('if ! wait_for_wifi_authentication; then')
        dhcp = text.index('if try_dhcp "$wifi"; then', text.index('connect_wifi_conf()'))
        self.assertLess(wait, dhcp)
        self.assertNotIn("grep -q '^Connected to '", text)
        self.assertNotIn('sleep 2\n    try_dhcp "$wifi"', text)

    def test_wifi_supplicant_lifecycle_is_single_owner_and_fail_closed(self) -> None:
        text = NETWORK.read_text(encoding="utf-8")
        self.assertIn('WPA_CTRL_DIR=/run/ordax-wpa-supplicant', text)
        self.assertIn('WPA_PID_FILE=/run/ordax-wpa-supplicant.pid', text)
        self.assertIn('stop_wifi_client()', text)
        self.assertIn('-P"$WPA_PID_FILE" -O"$WPA_CTRL_DIR"', text)
        self.assertIn('wpa_cli -p "$WPA_CTRL_DIR" -i "$wifi" terminate', text)
        self.assertIn("wifi_connect_result=owner-unavailable", text)
        self.assertNotIn("killall wpa_supplicant", text)
        self.assertNotIn('kill -9 "$pid"', text)
        self.assertIn('iw dev "$wifi" disconnect', text)
        connect = text.index('connect_wifi_conf()')
        stop_before_start = text.index('stop_wifi_client', connect)
        start = text.index('wpa_supplicant -B', connect)
        self.assertLess(stop_before_start, start)
        auth_failure = text.index('wifi_connect_result=authentication', start)
        stop_after_auth_failure = text.index('stop_wifi_client', auth_failure)
        self.assertLess(auth_failure, stop_after_auth_failure)

    def test_wifi_base_requires_control_client_and_psk_tools(self) -> None:
        text = NETWORK.read_text(encoding="utf-8")
        self.assertIn('require_wifi_tools()', text)
        self.assertIn('for tool in iw wpa_supplicant wpa_cli wpa_passphrase; do', text)
        self.assertIn('Base incompleta; ferramenta Wi-Fi ausente', text)
        self.assertIn('require_wifi_tools || exit 1', text)

    def test_wifi_defaults_to_strongest_secure_network_but_allows_override(self) -> None:
        text = NETWORK.read_text(encoding="utf-8")
        self.assertIn('scan_secure_networks()', text)
        self.assertIn('signals[j] > signals[max]', text)
        self.assertIn('/^[[:space:]]*(RSN:|WPA:)/', text)
        self.assertIn('[melhor sinal]', text)
        self.assertIn('Melhor rede sera usada em 2s.', text)
        self.assertIn('read -r -n 1 -t 2 choice', text)
        self.assertIn('selected_ssid=$(sed -n "${choice}p" "$SSID_FILE")', text)
        self.assertNotIn("printf 'SSID", text)
        self.assertNotIn('read -r ssid', text)

    def test_wifi_can_force_network_change_without_destroying_saved_config_first(self) -> None:
        text = NETWORK.read_text(encoding="utf-8")
        self.assertIn('--choose) force_choose=1', text)
        self.assertIn('uso: ordax-network [--choose|--init-hardware]', text)
        self.assertIn('if [ "$force_choose" -eq 0 ] && [ -s "$WPA_CONF" ]; then', text)
        self.assertIn('if connect_saved_wifi; then', text)
        self.assertIn('CANDIDATE_CONF=$STATE_DIR/wpa.conf.candidate.$$', text)
        candidate_write = text.index('> "$CANDIDATE_CONF"')
        candidate_connect = text.index('connect_wifi_conf "$CANDIDATE_CONF"')
        promote = text.index('mv -f "$CANDIDATE_CONF" "$WPA_CONF"')
        self.assertLess(candidate_write, candidate_connect)
        self.assertLess(candidate_connect, promote)
        self.assertIn('a rede salva anteriormente foi preservada', text)
        self.assertIn('WIFI_SETUP_ATTEMPTS=${ORDAX_WIFI_SETUP_ATTEMPTS:-3}', text)
        self.assertIn('autenticacao WPA nao foi concluida; confira a senha ou escolha outra rede', text)
        self.assertIn('setup_attempt=$((setup_attempt + 1))', text)

    def test_first_boot_wifi_retries_only_authentication_failures(self) -> None:
        text = NETWORK.read_text(encoding="utf-8")
        self.assertIn('WIFI_SETUP_ATTEMPTS=${ORDAX_WIFI_SETUP_ATTEMPTS:-3}', text)
        self.assertIn('while [ "$setup_attempt" -le "$WIFI_SETUP_ATTEMPTS" ]; do', text)
        self.assertIn('a senha WPA/WPA2 deve ter entre 8 e 63 caracteres; tente novamente', text)
        self.assertIn('authentication)', text)
        self.assertIn('autenticacao WPA nao foi concluida; confira a senha ou escolha outra rede', text)
        self.assertIn('force_choose=1', text)
        self.assertIn('dhcp)', text)
        self.assertIn('Wi-Fi autenticado, mas DHCP nao respondeu; a senha nao sera solicitada novamente', text)
        self.assertLess(
            text.index('if connect_wifi_conf "$CANDIDATE_CONF"; then'),
            text.index('setup_attempt=$((setup_attempt + 1))', text.index('if connect_wifi_conf "$CANDIDATE_CONF"; then')),
        )

    def test_dhcp_failure_is_not_mislabeled_as_bad_password(self) -> None:
        text = NETWORK.read_text(encoding="utf-8")
        self.assertIn('wifi_connect_result=dhcp', text)
        self.assertIn('Wi-Fi salvo autenticou, mas DHCP nao respondeu; credencial preservada', text)
        self.assertIn('Wi-Fi autenticado, mas DHCP nao respondeu; a senha nao sera solicitada novamente', text)
        self.assertLess(
            text.index('if try_dhcp "$wifi"; then'),
            text.index('wifi_connect_result=dhcp'),
        )

    def test_password_has_brief_character_feedback_then_mask(self) -> None:
        text = NETWORK.read_text(encoding="utf-8")
        self.assertIn('read_password_with_feedback()', text)
        self.assertIn('stty -echo -icanon min 1 time 0', text)
        self.assertIn('IFS= read -r -n 1 ch', text)
        reveal = text.index("printf '%s' \"$ch\"")
        mask = text.index("printf '\\b*'", reveal)
        self.assertLess(reveal, mask)
        self.assertIn("printf 'Senha WPA/WPA2: '", text)
        self.assertNotIn('read -r password\nstty echo', text)

    def test_network_synchronizes_clock_before_returning_success(self) -> None:
        text = NETWORK.read_text(encoding="utf-8")
        self.assertIn('sync_clock()', text)
        self.assertIn('/bin/busybox timeout -k 1 "$CLOCK_SYNC_TIMEOUT"', text)
        self.assertIn('/bin/busybox ntpd -q -n', text)
        self.assertIn('-p time.cloudflare.com', text)
        self.assertIn('-p time.google.com', text)
        self.assertIn('-p pool.ntp.org', text)
        finish = text.index('finish_network()')
        sync = text.index('sync_clock', finish)
        self.assertLess(finish, sync)
        self.assertIn('finish_network "$wifi"', text)
        self.assertIn('finish_network "$iface"', text)

    def test_network_readiness_is_ip_clock_dns_https_then_git(self) -> None:
        text = NETWORK.read_text(encoding="utf-8")
        self.assertIn('NETWORK_STATUS_FILE=${ORDAX_NETWORK_STATUS_FILE:-/run/ordax-network-status}', text)
        self.assertIn('/bin/busybox nslookup github.com', text)
        self.assertIn('/bin/busybox wget -q -T "$HTTPS_PROBE_TIMEOUT" -O /dev/null https://github.com/', text)
        self.assertIn('git -c http.lowSpeedLimit=1', text)
        finish = text[text.index('finish_network()'):text.index('try_dhcp()')]
        self.assertLess(finish.index('sync_clock'), finish.index('probe_dns'))
        self.assertLess(finish.index('probe_dns'), finish.index('probe_https'))
        self.assertLess(finish.index('probe_https'), finish.index('probe_git_remote'))
        for state in ("no-ip", "ip-ready", "dns-failed", "https-failed", "github-git-failed", "ready"):
            self.assertIn(state, text)
        self.assertIn('HTTPS disponivel, mas GitHub/Git nao respondeu', text)

    def test_maintenance_shell_reestablishes_controlling_tty(self) -> None:
        text = DEV_INIT.read_text(encoding="utf-8")
        self.assertIn('if /bin/busybox setsid --help >/dev/null 2>&1; then', text)
        self.assertIn('if [ -r /dev/tty ] && /bin/busybox test -t 0 2>/dev/null; then', text)
        self.assertIn('exec /bin/busybox setsid -c /bin/sh', text)
        self.assertIn('exec /bin/busybox setsid /bin/sh', text)
        self.assertIn("printf 'Rede:         ordax-network", text)


if __name__ == "__main__":
    unittest.main()
