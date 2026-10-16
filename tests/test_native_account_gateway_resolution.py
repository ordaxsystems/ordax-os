from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
SURFACE_ENTRYPOINT = ROOT / "system" / "surface" / "entrypoint"
SURFACE_RUNTIME = ROOT / "system" / "surface" / "bin" / "ordax-surface"
GATEWAY_CONFIG = ROOT / "system" / "services" / "account" / "gateway-base-url"


class NativeAccountGatewayResolutionTests(unittest.TestCase):
    def test_surface_entrypoint_exports_repository_gateway_when_override_is_absent(self):
        text = SURFACE_ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn('ACCOUNT_GATEWAY_CONFIG=${ORDAX_SYSTEM_ROOT:-}/services/account/gateway-base-url', text)
        self.assertIn('[ -z "${ORDAX_ACCOUNT_GATEWAY_ORIGIN:-}" ]', text)
        self.assertIn('[ -f "$ACCOUNT_GATEWAY_CONFIG" ]', text)
        self.assertIn('[ ! -L "$ACCOUNT_GATEWAY_CONFIG" ]', text)
        self.assertIn('ORDAX_ACCOUNT_GATEWAY_ORIGIN=$(/bin/busybox cat "$ACCOUNT_GATEWAY_CONFIG"', text)
        self.assertIn('export ORDAX_ACCOUNT_GATEWAY_ORIGIN', text)

    def test_native_surface_remains_owner_of_gateway_validation(self):
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn('valid_account_gateway_base_url() {', text)
        self.assertIn('resolve_account_gateway_base_url() {', text)
        self.assertIn('ACCOUNT_GATEWAY_ORIGIN=${ORDAX_ACCOUNT_GATEWAY_ORIGIN:-}', text)
        self.assertIn('--account-gateway-origin "$ACCOUNT_GATEWAY_ORIGIN"', text)

    def test_gateway_configuration_is_https_and_shell_syntax_stays_valid(self):
        configured = GATEWAY_CONFIG.read_text(encoding="utf-8").strip()
        self.assertTrue(configured.startswith("https://"))
        subprocess.run(["sh", "-n", str(SURFACE_ENTRYPOINT)], check=True)

    def test_entrypoint_does_not_fetch_identity_configuration_from_network(self):
        text = SURFACE_ENTRYPOINT.read_text(encoding="utf-8")
        for forbidden in ("curl ", "wget ", "http://"):
            self.assertNotIn(forbidden, text)


if __name__ == "__main__":
    unittest.main()
