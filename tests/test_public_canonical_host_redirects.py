"""Canonical OrdaX Vercel routing and host ownership.

The public portal and OrdaX Web share one repository-level Vercel policy, while
each canonical Vercel project receives its own root artifact. Host-scoped Web
rewrites must precede the public-site fallbacks; they are disjoint routes, not
duplicate transport owners.
"""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_HOSTS = {
    "ordax-os-public-tau.vercel.app",
    "ordax-os-public-ordaxsystems.vercel.app",
    "ordax-os-public-git-main-ordaxsystems.vercel.app",
}
CANONICAL = "ordax.com.br"
WEB_CANONICAL = "web.ordax.com.br"


class CanonicalPublicHostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
        cls.contract = json.loads((
            ROOT / "docs/contracts/public-site-deployment.json"
        ).read_text(encoding="utf-8"))

    def test_native_vercel_alias_redirect_is_the_only_public_alias_owner(self):
        migration = self.contract["vercel_migration"]
        self.assertEqual(migration["target_project"], "ordax-os-public")
        self.assertEqual(migration["target_git_repository"], "ordaxsystems/ordax-os")
        self.assertEqual(migration["target_canonical_domain"], CANONICAL)
        self.assertEqual(migration["canonical_public_alias_redirect_owner"], "vercel-project-routing-rules")
        self.assertEqual(migration["canonical_public_alias_redirect_route_src"], "/(.*)")
        self.assertEqual(migration["canonical_public_alias_redirect_route_dest"], "https://ordax.com.br/$1")
        self.assertIs(migration["canonical_public_alias_redirect_route_has_exact_host"], True)
        self.assertEqual(migration["canonical_public_alias_redirect_target"], CANONICAL)
        self.assertEqual(migration["canonical_public_alias_redirect_http_status"], 307)
        self.assertEqual(set(migration["canonical_public_alias_redirects"]), EXPECTED_HOSTS)
        self.assertNotIn(CANONICAL, EXPECTED_HOSTS)
        # Only the retired product entry may redirect in repository policy;
        # canonical host aliases remain owned by Vercel project routing.
        self.assertEqual(self.config.get("redirects"), [{
            "source": source,
            "has": [{"type": "host", "value": CANONICAL}],
            "destination": f"https://{WEB_CANONICAL}/",
            "permanent": True,
        } for source in ("/web/", "/web/:path*")])

    def test_landing_web_links_use_the_product_origin_directly(self):
        from html.parser import HTMLParser

        class Links(HTMLParser):
            def __init__(self):
                super().__init__()
                self.hrefs = []

            def handle_starttag(self, tag, attrs):
                if tag == "a":
                    self.hrefs.append(dict(attrs).get("href"))

        parser = Links()
        parser.feed((ROOT / "sites/public/index.html").read_text(encoding="utf-8"))
        self.assertNotIn("/web/", parser.hrefs)
        self.assertEqual(parser.hrefs.count(f"https://{WEB_CANONICAL}/"), 3)

    def test_host_scoped_web_proxy_precedes_public_account_proxy_without_overlap(self):
        rewrites = self.config["rewrites"]
        self.assertEqual(len(rewrites), 7)

        expected_web = [
            ("/auth/:path*", "/api/web-account-proxy?ordax_path=/auth/:path*"),
            ("/sync/:path*", "/api/web-account-proxy?ordax_path=/sync/:path*"),
            ("/account/:path*", "/api/web-account-proxy?ordax_path=/account/:path*"),
        ]
        for rule, expected in zip(rewrites[:3], expected_web):
            self.assertEqual((rule["source"], rule["destination"]), expected)
            self.assertEqual(rule.get("has"), [{"type": "host", "value": {"pre": "web."}}])

        self.assertEqual(
            [(r["source"], r["destination"]) for r in rewrites[3:]],
            [
                ("/oauth/consent", "/api/oauth-consent"),
                ("/auth/:path*", "/api/account-proxy?ordax_path=/auth/:path*"),
                ("/sync/:path*", "/api/account-proxy?ordax_path=/sync/:path*"),
                ("/account/:path*", "/api/account-proxy?ordax_path=/account/:path*"),
            ],
        )
        for rule in rewrites[3:]:
            self.assertNotIn("has", rule)

        web_proxy = (ROOT / "api/web-account-proxy.mjs").read_text(encoding="utf-8")
        public_proxy = (ROOT / "api/account-proxy.mjs").read_text(encoding="utf-8")
        self.assertIn(f'ORDAX_WEB_PUBLIC_ORIGIN = "https://{WEB_CANONICAL}"', web_proxy)
        self.assertIn('proxyPublicAccountRequest(request, {', web_proxy)
        self.assertEqual(
            public_proxy,
            'export * from "../lib/account-proxy-core.mjs";\n'
            'export { default } from "../lib/account-proxy-core.mjs";\n',
        )

    def test_git_deployment_remains_production_only(self):
        self.assertEqual(self.config["git"]["deploymentEnabled"], {"**": False, "main": True})
        migration = self.contract["vercel_migration"]
        self.assertFalse(migration["automatic_git_deployments_frozen"])
        self.assertFalse(migration["automatic_preview_git_deployments_enabled"])
        self.assertTrue(migration["automatic_production_git_deployments_enabled"])
        self.assertEqual(migration["production_git_branch"], "main")
        self.assertEqual(migration["git_deployment_branch_policy"], "production-only")
        self.assertEqual(migration["git_deployment_pattern_syntax"], "minimatch")
        self.assertEqual(migration["git_deployment_disabled_branch_pattern"], "**")
        self.assertEqual(migration["pull_request_validation_owner"], "github-actions-public-site-candidate")
        self.assertEqual(self.contract["vercel_adapter"]["canonical_public_origin"], "https://ordax.com.br")

    def test_shared_vercel_build_dispatches_one_root_artifact_per_known_project(self):
        self.assertEqual(self.config["outputDirectory"], "out/vercel")
        self.assertEqual(self.config["buildCommand"], "python3 tools/vercel/build.py")
        self.assertEqual(
            self.config["ignoreCommand"],
            "sh tools/vercel/should_skip_build.sh",
        )
        build = (ROOT / "tools/vercel/build.py").read_text(encoding="utf-8")
        self.assertIn('PUBLIC_PROJECT_ID = "prj_mA9ew6hOfjdqlBr1cC757iMLPQJC"', build)
        self.assertIn('WEB_PROJECT_ID = "prj_ftACluUqk6i9DoD9GPIwmgURwckP"', build)
        self.assertIn('OUTPUT = ROOT / "out" / "vercel"', build)
        self.assertIn('role = {', build)
        self.assertIn('PUBLIC_PROJECT_ID: "public-site"', build)
        self.assertIn('WEB_PROJECT_ID: "ordax-web"', build)
        self.assertIn('VERCEL_DEPLOYMENT_ERROR=unrecognized canonical project', build)
        self.assertIn('build_public(source_commit)', build)
        self.assertIn('build_web(source_commit)', build)


if __name__ == "__main__":
    unittest.main()
