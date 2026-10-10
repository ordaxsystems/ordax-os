"""Canonical OrdaX public host: exactly one Git/Vercel project and auth origin.

Vercel project-alias records perform host redirects *before* filesystem
delivery. Source-defined redirects were insufficient for static /conta/.
The official deployment contract records the required alias configuration,
while native Vercel alias records remain the runtime authority.
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


class CanonicalPublicHostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
        cls.contract = json.loads((
            ROOT / "docs/contracts/public-site-deployment.json"
        ).read_text(encoding="utf-8"))

    def test_native_vercel_alias_redirect_is_the_only_owner(self):
        migration = self.contract["vercel_migration"]
        self.assertEqual(migration["target_project"], "ordax-os-public")
        self.assertEqual(migration["target_git_repository"], "ordaxsystems/ordax-os")
        self.assertEqual(migration["target_canonical_domain"], CANONICAL)
        self.assertEqual(migration["canonical_public_alias_redirect_owner"], "vercel-project-alias")
        self.assertEqual(migration["canonical_public_alias_redirect_target"], CANONICAL)
        self.assertEqual(migration["canonical_public_alias_redirect_http_status"], 307)
        self.assertEqual(set(migration["canonical_public_alias_redirects"]), EXPECTED_HOSTS)
        self.assertNotIn(CANONICAL, EXPECTED_HOSTS)
        # Do not duplicate platform alias routing in application redirects,
        # which can miss static routes under the deployment filesystem.
        self.assertNotIn("redirects", self.config)

    def test_single_origin_auth_proxy_and_auto_git_deployment(self):
        self.assertEqual(
            [(r["source"], r["destination"]) for r in self.config["rewrites"]],
            [
                ("/auth/:path*", "/api/account-proxy?ordax_path=/auth/:path*"),
                ("/sync/:path*", "/api/account-proxy?ordax_path=/sync/:path*"),
                ("/account/:path*", "/api/account-proxy?ordax_path=/account/:path*"),
            ],
        )
        self.assertTrue(self.config["git"]["deploymentEnabled"])
        self.assertFalse(self.contract["vercel_migration"]["automatic_git_deployments_frozen"])
        self.assertEqual(self.contract["vercel_adapter"]["canonical_public_origin"], "https://ordax.com.br")

    def test_source_build_gates_only_public_site_inputs(self):
        self.assertEqual(self.config["outputDirectory"], "out/public-site")
        self.assertEqual(
            self.config["ignoreCommand"],
            "sh tools/public-site/should_skip_vercel_build.sh",
        )


if __name__ == "__main__":
    unittest.main()
