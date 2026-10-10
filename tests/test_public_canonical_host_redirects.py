"""Canonical public host routing: one Vercel project, one login origin.

The Vercel production/project aliases must not become independent account
origins. Each forwards to the same verified custom domain without proxying
credentials or inventing alternate auth sessions. Preview deployments remain
subject to their independent platform protection.
"""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "vercel.json"
EXPECTED_HOSTS = {
    "ordax-os-public-tau.vercel.app",
    "ordax-os-public-ordaxsystems.vercel.app",
    "ordax-os-public-git-main-ordaxsystems.vercel.app",
}
CANONICAL = "https://ordax.com.br"


class CanonicalPublicHostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = json.loads(CONFIG.read_text(encoding="utf-8"))

    def test_all_known_public_vercel_aliases_redirect_to_canonical_origin(self):
        redirects = self.config["redirects"]
        self.assertEqual(len(redirects), len(EXPECTED_HOSTS))
        seen = set()
        for rule in redirects:
            self.assertEqual(rule["source"], "/:path*")
            self.assertEqual(rule["destination"], CANONICAL + "/:path*")
            self.assertIs(rule["permanent"], True)
            self.assertEqual(len(rule["has"]), 1)
            matcher = rule["has"][0]
            self.assertEqual(matcher["type"], "host")
            seen.add(matcher["value"])
        self.assertEqual(seen, EXPECTED_HOSTS)

    def test_auth_rewrites_follow_redirects_and_target_single_owner(self):
        self.assertEqual(
            [(r["source"], r["destination"]) for r in self.config["rewrites"]],
            [
                ("/auth/:path*", "/api/account-proxy?ordax_path=/auth/:path*"),
                ("/sync/:path*", "/api/account-proxy?ordax_path=/sync/:path*"),
                ("/account/:path*", "/api/account-proxy?ordax_path=/account/:path*"),
            ],
        )
        self.assertNotIn("ordax.com.br", EXPECTED_HOSTS)
        for rule in self.config["redirects"]:
            self.assertNotIn("cookie", json.dumps(rule).lower())
            self.assertNotIn("authorization", json.dumps(rule).lower())

    def test_deployment_does_not_enable_legacy_host_auth(self):
        self.assertEqual(self.config["outputDirectory"], "out/public-site")
        self.assertEqual(
            self.config["ignoreCommand"],
            "sh tools/public-site/should_skip_vercel_build.sh",
        )


if __name__ == "__main__":
    unittest.main()
