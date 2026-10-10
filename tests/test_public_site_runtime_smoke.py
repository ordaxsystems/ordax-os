import importlib.util
import json
import shutil
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_SITE_TOOLS = ROOT / "tools" / "public-site"
sys.path.insert(0, str(PUBLIC_SITE_TOOLS))
BUILD_PATH = PUBLIC_SITE_TOOLS / "build.py"
PREVIEW_PATH = PUBLIC_SITE_TOOLS / "preview_server.py"
DEPLOYMENT_CONTRACT = ROOT / "docs" / "contracts" / "public-site-deployment.json"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


build = load_module("ordax_public_site_build_smoke", BUILD_PATH)
preview = load_module("ordax_public_site_preview_smoke", PREVIEW_PATH)


class PublicSiteRuntimeSmokeTests(unittest.TestCase):
    def test_route_inventory_matches_built_pages_and_rejects_a_removed_page(self):
        manifest_path = self.out / build.MANIFEST_NAME
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertIn("/conta/", manifest["routes"])
        self.assertIn("/web/", manifest["routes"])
        self.assertNotIn("/conta-2/", manifest["routes"])
        with tempfile.TemporaryDirectory() as temporary:
            candidate = Path(temporary) / "site"
            shutil.copytree(self.out, candidate)
            manifest["routes"].append("/conta-2/")
            (candidate / build.MANIFEST_NAME).write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(build.PublicSiteError, "route inventory"):
                build.verify_bundle(candidate)

    def test_account_assets_and_plan_catalog_are_derived_from_existing_owners(self):
        self.assertEqual((self.out / build.PUBLIC_SYMBOL_PATH).read_bytes(), build.CANONICAL_SYMBOL.read_bytes())
        with self.fetch('/' + build.PUBLIC_SYMBOL_PATH) as response:
            self.assertEqual(response.headers['Content-Type'], 'image/png')
            self.assertEqual(response.read(), build.CANONICAL_SYMBOL.read_bytes())
        self.assertEqual((self.out / "assets/ordax-landscape.png").read_bytes(), build.CANONICAL_WALLPAPER.read_bytes())
        self.assertEqual((self.out / "assets/fonts" / build.CANONICAL_FONT.name).read_bytes(), build.CANONICAL_FONT.read_bytes())
        self.assertEqual((self.out / "assets/fonts" / build.CANONICAL_FONT_LICENSE.name).read_bytes(), build.CANONICAL_FONT_LICENSE.read_bytes())
        self.assertEqual((self.out / "assets/ordax-font.css").read_text(encoding="utf-8"), build.render_site_font_css())
        account = (self.out / "conta/index.html").read_text(encoding="utf-8")
        plans = json.loads((ROOT / "docs/contracts/entitlements.json").read_text(encoding="utf-8"))["plan_catalog"]["plans"]
        for plan in plans:
            self.assertIn("<li>" + plan["display_name"] + "</li>", account)
        self.assertNotIn("<!-- ORDAX_ACCOUNT_PLAN_CATALOG -->", account)
        for asset in ("account-dashboard.css", "account-portal.js", "ordax-design-tokens.css", "ordax-font.css"):
            fingerprint = build.sha256_bytes((self.out / "assets" / asset).read_bytes())[:16]
            self.assertIn("/assets/" + asset + "?v=" + fingerprint, account)
        shared_version = build.sha256_bytes((self.out / "assets/site.js").read_bytes())[:16]
        for page in self.out.rglob("*.html"):
            markup = page.read_text(encoding="utf-8")
            if '<script src="/assets/site.js' in markup:
                self.assertIn('/assets/site.js?v=' + shared_version, markup, page)


    def test_web_config_cannot_activate_an_unapproved_product(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "site"
            shutil.copytree(ROOT / "sites/public", source)
            config_path = source / "config/public-site.json"
            config = json.loads(config_path.read_text(encoding="utf-8"))
            config["product"]["web"] = {"enabled": True, "entry_url": "/ordax/"}
            config_path.write_text(json.dumps(config), encoding="utf-8")
            with self.assertRaisesRegex(build.PublicSiteError, "authorized by its owner"):
                build.validate_source(source)

    def test_web_config_rejects_external_or_reserved_navigation_targets(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "site"
            shutil.copytree(ROOT / "sites/public", source)
            config_path = source / "config/public-site.json"
            config = json.loads(config_path.read_text(encoding="utf-8"))
            for path in ("//example.invalid/", "https://example.invalid/", "/web/", "/auth/logout/", "/ordax/%2f/", "/ordax//next/", "/ordax/../conta/"):
                config["product"]["web"] = {"enabled": False, "entry_url": path}
                config_path.write_text(json.dumps(config), encoding="utf-8")
                with self.subTest(path=path), self.assertRaisesRegex(build.PublicSiteError, "same-origin product path"):
                    build.validate_source(source)

    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.out = Path(cls.temp.name) / "public-site"
        build.build_bundle(cls.out, "1" * 40)
        cls.server = preview.make_server(cls.out, "127.0.0.1", 0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        cls.thread.start()
        host, port = cls.server.server_address[:2]
        cls.base = f"http://{host}:{port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
        cls.temp.cleanup()

    def fetch(self, path):
        return urlopen(self.base + path, timeout=3)

    def test_deployment_contract_requires_security_headers(self):
        contract = json.loads(DEPLOYMENT_CONTRACT.read_text(encoding="utf-8"))
        self.assertTrue(contract["production_requirements"]["https"])
        self.assertTrue(contract["production_requirements"]["host_adapter_must_apply_security_headers"])
        self.assertEqual(contract["routing"]["identity_prefix"], "/auth/")

    def test_landing_and_download_pages_are_served(self):
        for path in ("/", "/download/", "/login/", "/cadastro/", "/licencas/", "/privacidade/", "/termos/"):
            with self.subTest(path=path):
                with self.fetch(path) as response:
                    self.assertEqual(response.status, 200)
                    self.assertIn("text/html", response.headers["Content-Type"])
                    self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
                    self.assertEqual(response.headers["X-Frame-Options"], "DENY")
                    self.assertIn("default-src 'self'", response.headers["Content-Security-Policy"])

    def test_former_preview_routes_redirect_to_the_only_account_and_keep_query(self):
        for source in ("/conta-2", "/conta-2/", "/conta-2/index.html"):
            with self.subTest(source=source), self.fetch(source + "?source=bookmark") as response:
                self.assertEqual(response.status, 200)
                self.assertTrue(response.geturl().endswith("/conta/?source=bookmark"))
                markup = response.read().decode("utf-8")
                self.assertIn('data-page="conta"', markup)
                self.assertNotIn("Prévia 2", markup)

    def test_generated_release_catalog_is_served_and_empty(self):
        with self.fetch("/releases/catalog.json") as response:
            payload = json.load(response)
            self.assertEqual(payload["$schema"], "prototype-ordax.public-release-catalog/1")
            self.assertEqual(payload["status"], "empty")
            self.assertEqual(payload["releases"], [])
            self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_auth_session_is_anonymous_through_same_origin_runtime(self):
        with self.fetch("/auth/session") as response:
            payload = json.load(response)
            self.assertEqual(response.status, 200)
            self.assertFalse(payload["authenticated"])
            self.assertEqual(payload["provider"], "unconfigured")
            self.assertEqual(response.headers["Cache-Control"], "no-store, max-age=0")

    def test_login_page_is_reachable_but_credentials_fail_closed_without_provider(self):
        with self.fetch("/auth/login") as response:
            self.assertEqual(response.status, 200)
            self.assertTrue(response.geturl().endswith("/login/"))

        body = urlencode({
            "email": "pessoa@example.com",
            "password": "not-a-real-test-password",
        }).encode("utf-8")
        request = Request(
            self.base + "/auth/login",
            data=body,
            method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        with self.assertRaises(HTTPError) as caught:
            urlopen(request, timeout=3)
        self.assertEqual(caught.exception.code, 503)
        payload = json.loads(caught.exception.read().decode("utf-8"))
        self.assertEqual(payload["error"], "identity-provider-unavailable")

    def test_sync_route_is_same_origin_and_fails_closed_without_provider(self):
        with self.assertRaises(HTTPError) as caught:
            self.fetch("/sync/snapshot?limit=1")
        self.assertEqual(caught.exception.code, 503)
        payload = json.loads(caught.exception.read().decode("utf-8"))
        self.assertEqual(payload["error"], "public-account-access-disabled")
        self.assertEqual(caught.exception.headers["Cache-Control"], "no-store, max-age=0")

    def test_unknown_path_and_traversal_do_not_escape_site_root(self):
        for path in ("/missing", "/%2e%2e/README.md"):
            with self.subTest(path=path):
                with self.assertRaises(HTTPError) as caught:
                    self.fetch(path)
                self.assertEqual(caught.exception.code, 404)

    def test_preview_server_rejects_non_loopback_bind(self):
        with self.assertRaises(ValueError):
            preview.make_server(self.out, "0.0.0.0", 0)


if __name__ == "__main__":
    unittest.main()
