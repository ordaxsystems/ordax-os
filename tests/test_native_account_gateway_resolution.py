from pathlib import Path
import json
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
SURFACE_ENTRYPOINT = ROOT / "system" / "surface" / "entrypoint"
SURFACE_RUNTIME = ROOT / "system" / "surface" / "bin" / "ordax-surface"
BOOTSTRAP_ENTRYPOINT = ROOT / "bootstrap" / "entrypoint"
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

    def test_signed_gateway_is_resolved_on_the_actual_native_runtime_path(self):
        # The canonical Surface entrypoint may export the URL, but the Native
        # launcher is also an executable and must resolve it before starting
        # the Native HTTP child. Otherwise /auth/session reports unconfigured.
        text = SURFACE_RUNTIME.read_text(encoding="utf-8")
        self.assertEqual(text.count("\\nresolve_account_gateway_base_url\\n"), 1)
        resolved = text.index('resolve_source_identity || fallback_with_reason')
        invoked = text.index("\\nresolve_account_gateway_base_url\\n", resolved)
        spawned = text.index('--account-gateway-origin "$ACCOUNT_GATEWAY_ORIGIN"', invoked)
        self.assertLess(resolved, invoked)
        self.assertLess(invoked, spawned)
        self.assertIn('ACCOUNT_GATEWAY_CONFIG=$SYSTEM_ROOT/services/account/gateway-base-url', text)
        self.assertIn('ACCOUNT_GATEWAY_ORIGIN=$configured', text)
        self.assertIn('[ ! -L "$ACCOUNT_GATEWAY_CONFIG" ]', text)
        subprocess.run(["sh", "-n", str(SURFACE_RUNTIME)], check=True)

    def test_gateway_resolution_is_executable_and_offline_safe(self):
        import os
        import tempfile

        source = SURFACE_RUNTIME.read_text(encoding="utf-8")
        functions = []
        for name in ("valid_account_gateway_base_url", "resolve_account_gateway_base_url"):
            start = source.index(f"{name}() {{")
            end = source.index("\\n}", start) + 2
            functions.append(source[start:end])
        # Swap only the BusyBox cat applet in this extracted, ephemeral test
        # harness so it runs in the Ubuntu CI image as well as Alpine.
        isolated_functions = "\\n".join(functions).replace("/bin/busybox cat", "cat")
        script = isolated_functions + '\\nresolve_account_gateway_base_url\\nprintf "%s" "$ACCOUNT_GATEWAY_ORIGIN"'
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / "gateway-base-url"
            log = Path(tmp) / "host.log"
            environment = dict(os.environ, ACCOUNT_GATEWAY_ORIGIN="",
                               ACCOUNT_GATEWAY_CONFIG=str(config), HOST_LOG=str(log))
            approved = GATEWAY_CONFIG.read_text(encoding="utf-8").strip()
            config.write_text(approved + "\\n", encoding="utf-8")
            run = subprocess.run(["sh", "-c", script], env=environment,
                                 text=True, capture_output=True, check=True)
            self.assertEqual(run.stdout, approved)
            config.write_text("http://untrusted.example/auth\\n", encoding="utf-8")
            run = subprocess.run(["sh", "-c", script], env=environment,
                                 text=True, capture_output=True, check=True)
            self.assertEqual(run.stdout, "")
            self.assertIn("invalid", log.read_text(encoding="utf-8"))
            config.unlink()
            run = subprocess.run(["sh", "-c", script], env=environment,
                                 text=True, capture_output=True, check=True)
            self.assertEqual(run.stdout, "")

    def test_gateway_configuration_is_https_and_shell_syntax_stays_valid(self):
        configured = GATEWAY_CONFIG.read_text(encoding="utf-8").strip()
        self.assertTrue(configured.startswith("https://"))
        subprocess.run(["sh", "-n", str(SURFACE_ENTRYPOINT)], check=True)

    def test_native_gateway_tracks_verified_platform_destination_without_public_auth_cutover(self):
        # The source-owner for the project ref is the account migration
        # contract; never hardcode a retired hostname or enable public auth.
        hardening = json.loads(
            (ROOT / "docs/contracts/public-auth-hardening.json").read_text(encoding="utf-8")
        )
        destination = hardening["postgresql_destination"]
        project_ref = destination["project_ref"]
        self.assertEqual(destination["project_name"], "ordax-platform")
        self.assertFalse(destination["functional_provider_cutover_complete"])
        self.assertFalse(destination["public_registration_enabled"])
        configured = GATEWAY_CONFIG.read_text(encoding="utf-8").strip()
        self.assertEqual(
            configured,
            f"https://{project_ref}.supabase.co/functions/v1/ordax-account-gateway",
        )
        self.assertNotIn(hardening["target"]["project_ref"], configured)

    def test_stable_boot_cannot_override_signed_identity_gateway_from_bootstrap_config(self):
        bootstrap = BOOTSTRAP_ENTRYPOINT.read_text(encoding="utf-8")
        surface = SURFACE_ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn('unset ORDAX_ACCOUNT_GATEWAY_ORIGIN', bootstrap)
        self.assertNotIn('account-gateway-origin', bootstrap)
        self.assertNotIn('account_gateway_base_url() {', bootstrap)
        self.assertIn(
            'ACCOUNT_GATEWAY_CONFIG=${ORDAX_SYSTEM_ROOT:-}/services/account/gateway-base-url',
            surface,
        )
        self.assertIn(
            'ORDAX_ACCOUNT_GATEWAY_ORIGIN=$(/bin/busybox cat "$ACCOUNT_GATEWAY_CONFIG"',
            surface,
        )
        subprocess.run(["sh", "-n", str(BOOTSTRAP_ENTRYPOINT)], check=True)

    def test_entrypoint_does_not_fetch_identity_configuration_from_network(self):
        text = SURFACE_ENTRYPOINT.read_text(encoding="utf-8")
        for forbidden in ("curl ", "wget ", "http://"):
            self.assertNotIn(forbidden, text)


if __name__ == "__main__":
    unittest.main()
