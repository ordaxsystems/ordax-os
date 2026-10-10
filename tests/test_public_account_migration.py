"""Migration boundaries: one Account, canonical routing and no parallel policy."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools/public-site"
sys.path.insert(0, str(TOOLS))
from public_redirects import nginx_redirects, public_redirects


class PublicAccountMigrationTests(unittest.TestCase):
    def test_deprecated_routes_have_one_internal_destination_without_chains(self):
        redirects = public_redirects()
        for path in ("/conta-2", "/conta-2/", "/conta-2/index.html"):
            self.assertEqual(redirects[path], "/conta/")
        self.assertNotIn("/conta/", redirects)
        generated = nginx_redirects()
        self.assertEqual(generated.count("return 308"), len(redirects))
        self.assertIn("$is_args$args", generated)
        self.assertIn("include /srv/ordax-public-site/public-redirects.nginx.conf;",
                      (ROOT / "deploy/public-site/nginx.conf").read_text(encoding="utf-8"))

    def test_redirect_configuration_rejects_remote_urls_injection_duplicates_and_loops(self):
        base = {"source": "/old/", "destination": "/conta/", "permanent": True}
        invalid = [
            [{**base, "destination": "https://example.test/"}],
            [{**base, "destination": "//example.test/"}],
            [{**base, "destination": "/conta/; return 200"}],
            [{**base, "source": "/../conta/"}],
            [{**base, "destination": "/old/"}],
            [base, base],
            [base, {"source": "/conta/", "destination": "/old/", "permanent": True}],
        ]
        with tempfile.TemporaryDirectory() as temporary:
            config = Path(temporary) / "vercel.json"
            for rules in invalid:
                with self.subTest(rules=rules):
                    config.write_text(json.dumps({"redirects": rules}), encoding="utf-8")
                    with self.assertRaises(ValueError):
                        public_redirects(config)

    def test_layout_has_one_controller_and_consumes_canonical_visual_policy(self):
        assets = ROOT / "sites/public/assets"
        html = (ROOT / "sites/public/conta/index.html").read_text(encoding="utf-8")
        css = (assets / "account-dashboard.css").read_text(encoding="utf-8")
        client = (assets / "site.js").read_text(encoding="utf-8")
        self.assertFalse((ROOT / "sites/public/conta-2").exists())
        for obsolete in ("account-2.css", "account-2.js", "account-2-landscape.jpg"):
            self.assertFalse((assets / obsolete).exists(), obsolete)
        self.assertEqual(html.count('src="/assets/account-portal.js"'), 1)
        self.assertEqual(html.count('id="account-content"'), 1)
        self.assertIn('class="account-portal"', html)
        self.assertIn('viewport-fit=cover', html)
        self.assertNotIn("Prévia 2", html)
        self.assertNotIn("renderAccount()", client)
        self.assertIn("var(--ordax-bg)", css)
        self.assertNotRegex(css, r"oklch\(|#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(")

    def test_gateway_successful_login_target_is_the_canonical_layout(self):
        # The presentation migration requires no parallel auth policy or adapter.
        python = (ROOT / "services/public-identity/gateway.py").read_text(encoding="utf-8")
        edge = (ROOT / "infra/supabase/functions/ordax-account-gateway/index.ts").read_text(encoding="utf-8")
        self.assertIn('"/conta/",', python)
        self.assertIn('redirectResponse("/conta/", cookies)', edge)
        self.assertTrue((ROOT / "sites/public/conta/index.html").is_file())


if __name__ == "__main__":
    unittest.main()
