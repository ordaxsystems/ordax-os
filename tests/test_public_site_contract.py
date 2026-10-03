import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "sites" / "public"
PUBLIC_CONTRACT = ROOT / "docs" / "contracts" / "public-site.json"
BUILD_CONTRACT = ROOT / "docs" / "contracts" / "build-autonomy.json"


class PublicSiteContractTests(unittest.TestCase):
    def test_required_public_routes_exist(self):
        for relative in (
            "index.html",
            "download/index.html",
            "login/index.html",
            "cadastro/index.html",
            "recuperar/index.html",
            "recuperar/nova-senha/index.html",
            "conta/index.html",
            "licencas/index.html",
            "privacidade/index.html",
            "termos/index.html",
        ):
            self.assertTrue((SITE / relative).is_file(), relative)

    def test_public_site_is_distinct_from_product_web_mode(self):
        contract = json.loads(PUBLIC_CONTRACT.read_text(encoding="utf-8"))
        self.assertEqual(
            contract["status"],
            "foundation-same-origin-adapter-gated-auth-account-cloud-source-ready-not-deployed",
        )
        self.assertEqual(contract["artifact_class"], "public-site")
        self.assertTrue(contract["separate_from_product_web_mode"])
        self.assertEqual(contract["source_root"], "sites/public")
        self.assertEqual(contract["build_recipe"], "tools/public-site/build.py")
        distribution = contract["product_distribution"]
        self.assertEqual(distribution["public_profile"], "stable-mvp")
        self.assertFalse(distribution["owner_development_profile_public"])
        self.assertFalse(distribution["public_runtime_depends_on_git"])
        self.assertTrue(distribution["public_updates_use_official_channels"])
        self.assertFalse(distribution["landing_may_explain_git_operations"])
        self.assertFalse(distribution["landing_may_expose_branch_pr_commit_as_normal_ux"])
        self.assertTrue(distribution["creator_is_primary_public_media_path"])
        self.assertTrue(distribution["landing_is_public_product_surface"])
        self.assertFalse(distribution["authenticated_workspace_may_replace_landing"])
        self.assertEqual(contract["routes"]["landing"], "/")
        self.assertEqual(contract["routes"]["account"], "/conta/")
        self.assertEqual(contract["routes"]["recovery"], "/recuperar/")
        self.assertEqual(contract["routes"]["recovery_new_password"], "/recuperar/nova-senha/")
        self.assertTrue(contract["identity"]["gated_recovery_forms_prepared"])
        self.assertFalse(contract["identity"]["recovery_forms_enabled"])
        self.assertTrue(contract["identity"]["recovery_server_side_token_hash"])
        account = contract["account_area"]
        self.assertTrue(account["requires_authenticated_session"])
        self.assertTrue(account["fail_closed_until_identity_ready"])
        self.assertFalse(account["may_simulate_user_data"])
        self.assertFalse(account["public_root_may_render_authenticated_workspace"])
        self.assertTrue(account["ordax_web_is_separate_product_mode"])
        scope = contract["mvp_scope"]
        self.assertEqual(scope["execution_mode"], "usb-only")
        self.assertFalse(scope["account_required_for_public_download"])
        self.assertFalse(scope["account_required_for_first_use"])
        self.assertFalse(scope["account_required_for_local_os_use"])
        self.assertTrue(scope["account_cloud_required_for_public_mvp_release"])
        self.assertEqual(scope["account_cloud_gate_contract"], "docs/contracts/mvp-account-cloud.json")
        self.assertEqual(scope["private_user_storage_gate_contract"], "docs/contracts/user-cloud-storage.json")
        self.assertFalse(scope["native_installation_available"])
        self.assertFalse(scope["internal_disk_write_available"])
        self.assertFalse(scope["dual_boot_available"])
        self.assertTrue(contract["deployment"]["adapter_selected"])
        self.assertEqual(contract["deployment"]["adapter_source"], "deploy/public-site/nginx.conf")
        self.assertFalse(contract["deployment"]["adapter_deployed"])
        self.assertTrue(contract["deployment"]["same_origin_identity_required"])
        self.assertTrue(contract["deployment"]["same_origin_sync_required"])
        self.assertTrue(contract["deployment"]["same_origin_account_required"])
        self.assertTrue(contract["identity"]["server_side_public_activation_gate_required"])
        self.assertFalse(contract["identity"]["server_side_public_activation_currently_enabled"])
        self.assertEqual(contract["deployment"]["account_request_marker_header"], "X-OrdaX-Public-Site")
        self.assertTrue(contract["deployment"]["gateway_public_activation_gate_required"])
        online = contract["online_mvp"]
        self.assertEqual(online["status"], "required-fail-closed-until-real-proofs-pass")
        self.assertEqual(online["registration_login_recovery"], "required")
        self.assertEqual(online["bounded_account_sync"], "required")
        self.assertEqual(online["cloud_memory_account_space"], "required")
        self.assertEqual(online["private_user_selected_storage"], "required")
        self.assertEqual(online["full_web_client"], "post-mvp")
        self.assertEqual(online["full_mobile_client"], "post-mvp")
        commerce = contract["commerce"]
        self.assertFalse(commerce["billing_implemented"])
        self.assertFalse(commerce["pricing_published"])
        self.assertTrue(commerce["commercial_tiers_defined"])
        self.assertFalse(commerce["account_cloud_mvp_depends_on_pricing"])
        self.assertEqual(commerce["commercial_tier_ids"], ["free", "personal", "professional", "team"])
        self.assertEqual(commerce["default_plan_id"], "free")
        self.assertFalse(commerce["paid_plans_purchasable"])
        self.assertEqual(commerce["plan_contract"], "docs/contracts/entitlements.json")
        self.assertFalse(commerce["commercial_device_limit_defined"])

    def test_identity_fails_closed_and_downloads_use_generated_catalog(self):
        config = json.loads((SITE / "config" / "public-site.json").read_text(encoding="utf-8"))
        self.assertIsNone(config["identity"]["login_url"])
        self.assertIsNone(config["identity"]["register_url"])
        self.assertIsNone(config["identity"]["recovery_url"])
        self.assertIsNone(config["identity"]["recovery_complete_url"])
        self.assertEqual(config["downloads"]["catalog_url"], "/releases/catalog.json")
        self.assertFalse(config["legal"]["account_activation_ready"])
        self.assertEqual(config["legal"]["privacy_url"], "/privacidade/")
        self.assertEqual(config["legal"]["terms_url"], "/termos/")

        login = (SITE / "login" / "index.html").read_text(encoding="utf-8")
        register = (SITE / "cadastro" / "index.html").read_text(encoding="utf-8")
        recovery = (SITE / "recuperar" / "index.html").read_text(encoding="utf-8")
        recovery_complete = (SITE / "recuperar" / "nova-senha" / "index.html").read_text(encoding="utf-8")
        account = (SITE / "conta" / "index.html").read_text(encoding="utf-8")
        download = (SITE / "download" / "index.html").read_text(encoding="utf-8")
        self.assertIn("Serviço de identidade ainda não configurado", login)
        self.assertIn('href="/recuperar/"', login)
        self.assertIn("Esqueci minha senha", login)
        self.assertIn("Cadastro ainda não configurado", register)
        self.assertIn("Recuperação ainda não configurada", recovery)
        self.assertIn("Conclusão da recuperação ainda não ativada", recovery_complete)
        self.assertIn("Área da conta ainda indisponível", account)
        self.assertIn("não simula dados", account)
        self.assertIn("data-download-status", download)
        self.assertIn("Entrar é opcional", download)
        self.assertIn("A preparação apaga o conteúdo do USB escolhido", download)
        self.assertIn("não oferece instalação", download)

        publications = json.loads((ROOT / "platform" / "releases" / "publications.json").read_text(encoding="utf-8"))
        self.assertEqual(publications["$schema"], "prototype-ordax.public-release-publications/1")
        self.assertEqual(publications["releases"], [])

    def test_site_baseline_has_no_remote_runtime_dependencies(self):
        for path in SITE.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in {".html", ".css", ".js"}:
                continue
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("http://", text, path)
            self.assertNotIn("https://", text, path)
            self.assertNotIn('src="//', text, path)
            self.assertNotIn('href="//', text, path)

    def test_gated_identity_forms_use_native_post_without_javascript_credential_access(self):
        login = (SITE / "login" / "index.html").read_text(encoding="utf-8")
        register = (SITE / "cadastro" / "index.html").read_text(encoding="utf-8")
        recovery = (SITE / "recuperar" / "index.html").read_text(encoding="utf-8")
        recovery_complete = (SITE / "recuperar" / "nova-senha" / "index.html").read_text(encoding="utf-8")
        script = (SITE / "assets" / "site.js").read_text(encoding="utf-8")

        self.assertIn('data-identity-form="login"', login)
        self.assertIn('autocomplete="current-password"', login)
        self.assertIn('data-identity-form="register"', register)
        self.assertIn('autocomplete="new-password"', register)
        self.assertIn('minlength="12"', register)
        self.assertIn("Use pelo menos 12 caracteres.", register)
        self.assertIn("data-registration-legal", register)
        self.assertIn("data-registration-privacy", register)
        self.assertIn("data-registration-terms", register)
        self.assertIn('name="legal_acceptance"', register)
        self.assertIn('value="accepted"', register)
        self.assertIn('data-identity-form="recover"', recovery)
        self.assertIn('data-identity-form="recover-complete"', recovery_complete)
        self.assertIn('name="password_confirmation"', recovery_complete)
        self.assertIn('minlength="12"', recovery_complete)
        for page in (login, register, recovery, recovery_complete):
            self.assertIn('method="post"', page)
            self.assertIn(" hidden>", page)
            self.assertIn(" disabled>", page)
        self.assertIn('target === expectedTarget', script)
        self.assertIn('account_activation_ready === true', script)
        self.assertIn('loadJson("/auth/registration-policy")', script)
        self.assertIn('value.registrationEnabled === true', script)
        self.assertIn("validRegistrationPolicy", script)
        self.assertNotIn("FormData", script)
        self.assertNotIn("password", script.lower())

    def test_runtime_integration_uses_same_origin_paths(self):
        script = (SITE / "assets" / "site.js").read_text(encoding="utf-8")
        self.assertIn('value.startsWith("/")', script)
        self.assertIn('!value.startsWith("//")', script)
        self.assertIn('credentials: "same-origin"', script)
        self.assertIn("prototype-ordax.public-release-catalog/1", script)
        self.assertIn("SHA-256", script)

    def test_public_identity_and_release_catalog_contracts_exist(self):
        identity = json.loads((ROOT / "docs" / "contracts" / "public-identity.json").read_text(encoding="utf-8"))
        releases = json.loads((ROOT / "docs" / "contracts" / "public-release-catalog.json").read_text(encoding="utf-8"))
        compliance = json.loads((ROOT / "docs" / "contracts" / "release-compliance.json").read_text(encoding="utf-8"))
        self.assertTrue(identity["credentials"]["static_site_renders_gated_credential_form"])
        self.assertFalse(identity["credentials"]["static_site_javascript_reads_credentials"])
        self.assertEqual(identity["credentials"]["credential_form_submission"], "native-browser-post-to-same-origin-gateway")
        self.assertTrue(identity["account_model"]["one_identity_across_product_modes"])
        self.assertTrue(releases["rules"]["public_authorization_required_per_release"])
        self.assertTrue(releases["rules"]["artifact_sha256_required"])
        self.assertTrue(releases["rules"]["compliance_artifacts_required"])
        self.assertTrue(compliance["release_publication_gate"])
        self.assertTrue(compliance["required_artifacts"]["sbom"]["required"])

    def test_public_site_is_independent_build_artifact(self):
        contract = json.loads(BUILD_CONTRACT.read_text(encoding="utf-8"))
        classes = contract["artifact_graph"]["independent_artifact_classes"]
        self.assertIn("public-site", classes)
        self.assertNotIn("public-site", contract["target_relationships"])
        self.assertFalse(contract["artifact_graph"]["public_site_change_rebuilds_system"])

    def test_landing_links_public_routes_without_fake_claims(self):
        landing = (SITE / "index.html").read_text(encoding="utf-8")
        for href in ("/download/", "/login/", "/cadastro/", "/licencas/"):
            self.assertIn(f'href="{href}"', landing)
        self.assertIn("EM DESENVOLVIMENTO", landing)
        self.assertIn("Downloads públicos aparecem somente quando uma release autorizada estiver disponível.", landing)
        self.assertIn("Stable/MVP", landing)
        self.assertIn("OrdaX Creator", landing)
        self.assertIn("diretamente pelo pendrive", landing)
        self.assertIn("pós-MVP", landing)
        self.assertNotIn("Usar ou instalar", landing)
        self.assertNotIn("instalar o OrdaX no disco interno", landing)
        self.assertIn("Arquivos", landing)
        self.assertIn("Notas", landing)
        self.assertIn("Internet", landing)
        self.assertIn("Atualizações", landing)
        self.assertNotIn("git pull", landing.lower())
        self.assertNotIn("pull request", landing.lower())
        self.assertNotIn('data-page="conta"', landing)
        self.assertNotIn("Área da conta", landing)

    def test_interactive_playground_remains_local_disposable_marketing_demo(self):
        landing = (SITE / "index.html").read_text(encoding="utf-8")
        script = (SITE / "assets" / "playground.js").read_text(encoding="utf-8")

        self.assertIn('id="experimente"', landing)
        self.assertIn("Demonstração com dados de exemplo. Sem instalar.", landing)
        self.assertIn("Sincronização simulada nesta prévia.", landing)
        self.assertIn("data-reset", landing)

        self.assertIn("Public marketing simulation only", script)
        self.assertIn("No product imports, persistence, network or identity", script)
        for forbidden in (
            "fetch(",
            "XMLHttpRequest",
            "WebSocket",
            "localStorage",
            "sessionStorage",
            "indexedDB",
            "document.cookie",
        ):
            self.assertNotIn(forbidden, script)


if __name__ == "__main__":
    unittest.main()
