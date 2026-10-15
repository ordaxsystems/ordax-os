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

    def test_wired_dhcp_skips_kernel_tunnel_interfaces(self) -> None:
        text = NETWORK.read_text(encoding="utf-8")
        self.assertIn('net_type=$(cat "$netpath/type" 2>/dev/null || true)', text)
        self.assertIn('[ "$net_type" = 1 ] || continue', text)
        self.assertIn('echo "ordax-network: tentando DHCP em $iface"', text)
        self.assertLess(
            text.index('[ "$net_type" = 1 ] || continue'),
            text.index('echo "ordax-network: tentando DHCP em $iface"'),
        )

    def test_wifi_waits_for_real_association_before_dhcp(self) -> None:
        text = NETWORK.read_text(encoding="utf-8")
        self.assertIn('wait_for_wifi_link()', text)
        self.assertIn('connect_wifi_conf()', text)
        self.assertIn('iw dev "$wifi" link', text)
        self.assertIn("grep -q '^Connected to '", text)
        self.assertIn('if ! wait_for_wifi_link; then', text)
        self.assertLess(
            text.index('if ! wait_for_wifi_link; then'),
            text.index('try_dhcp "$wifi"', text.index('connect_wifi_conf()')),
        )
        self.assertNotIn('sleep 2\n    try_dhcp "$wifi"', text)

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
        self.assertIn('uso: ordax-network [--choose]', text)
        self.assertIn('if [ "$force_choose" -eq 0 ] && connect_saved_wifi; then', text)
        self.assertIn('CANDIDATE_CONF=/run/ordax-wpa-candidate.conf', text)
        candidate_write = text.index('> "$CANDIDATE_CONF"')
        candidate_connect = text.index('connect_wifi_conf "$CANDIDATE_CONF"')
        promote = text.index('mv "$CANDIDATE_CONF" "$WPA_CONF"')
        self.assertLess(candidate_write, candidate_connect)
        self.assertLess(candidate_connect, promote)
        self.assertIn('a rede salva anteriormente foi preservada', text)
        self.assertIn('WIFI_SETUP_ATTEMPTS=${ORDAX_WIFI_SETUP_ATTEMPTS:-3}', text)
        self.assertIn('autenticacao falhou; confira a senha ou escolha outra rede', text)
        self.assertIn('setup_attempt=$((setup_attempt + 1))', text)

    def test_first_boot_wifi_retries_invalid_credentials_without_falling_to_shell(self) -> None:
        text = NETWORK.read_text(encoding="utf-8")
        self.assertIn('WIFI_SETUP_ATTEMPTS=${ORDAX_WIFI_SETUP_ATTEMPTS:-3}', text)
        self.assertIn('while [ "$setup_attempt" -le "$WIFI_SETUP_ATTEMPTS" ]; do', text)
        self.assertIn('a senha WPA/WPA2 deve ter entre 8 e 63 caracteres; tente novamente', text)
        self.assertIn('autenticacao falhou; confira a senha ou escolha outra rede', text)
        self.assertIn('force_choose=1', text)
        self.assertLess(
            text.index('if connect_wifi_conf "$CANDIDATE_CONF"; then'),
            text.index('setup_attempt=$((setup_attempt + 1))', text.index('if connect_wifi_conf "$CANDIDATE_CONF"; then')),
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
        self.assertIn('-p time.cloudflare.com', text)
        self.assertIn('-p time.google.com', text)
        self.assertIn('-p pool.ntp.org', text)
        finish = text.index('finish_network()')
        sync = text.index('sync_clock', finish)
        self.assertLess(finish, sync)
        self.assertIn('finish_network "$wifi"', text)
        self.assertIn('finish_network "$iface"', text)

    def test_maintenance_shell_reestablishes_controlling_tty(self) -> None:
        text = DEV_INIT.read_text(encoding="utf-8")
        self.assertIn('if /bin/busybox setsid --help >/dev/null 2>&1; then', text)
        self.assertIn('exec /bin/busybox setsid -c /bin/sh', text)
        self.assertIn("printf 'Rede:         ordax-network", text)


if __name__ == "__main__":
    unittest.main()
