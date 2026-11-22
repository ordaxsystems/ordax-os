"""Regression checks for monorepo-aware Vercel build impact decisions."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build_impact


class SiteVercelImpactTests(unittest.TestCase):
    def test_unrelated_os_work_does_not_rebuild_site(self):
        paths = (
            "desktop/runtime.test.cjs",
            "api/unrelated-service.mjs",
            "system/supervisor/main.py",
            "docs/ARCHITECTURE.md",
            "docs/forge/FORGE-GPT-FIRST-ADMINISTRADOR-ROADMAP.md",
            "site/docs/HANDOFF.md",
            "site/README.md",
            "site/tests/test_site_contract.py",
            "infra/supabase/functions/other-service/index.ts",
            ".github/workflows/windows-desktop-dev.yml",
        )
        for path in paths:
            with self.subTest(path=path):
                self.assertTrue(build_impact.may_skip_vercel((path,)))
        self.assertTrue(build_impact.may_skip_vercel(paths))

    def test_site_and_its_shared_gateway_require_build(self):
        paths = (
            "site/public/index.html",
            "site/scripts/build.py",
            "site/scripts/build_impact.py",
            "site/contracts/dev-artifact-lock.json",
            "site/api/account-proxy.mjs",
            "site/vercel.json",
            "api/account-proxy.mjs",
            "api/oauth-consent.mjs",
            "lib/account-proxy-core.mjs",
            "infra/supabase/functions/_shared/account_cookie_policy.mjs",
            "infra/supabase/functions/ordax-public-account-gateway/public_request_context.mjs",
            "tools/vercel/build.py",
            "docs/contracts/public-site-source.json",
            "docs/contracts/public-site-auth.json",
            "package.json",
            "package-lock.json",
        )
        for path in paths:
            with self.subTest(path=path):
                self.assertFalse(build_impact.may_skip_vercel((path,)))
                self.assertTrue(build_impact.affects_site_deployment(path))

    def test_mixed_change_and_missing_baseline_fail_closed(self):
        self.assertFalse(build_impact.may_skip_vercel(None))
        self.assertFalse(build_impact.may_skip_vercel((
            "desktop/install-smoke.ps1",
            "api/oauth-consent.mjs",
        )))
        self.assertIsNone(build_impact.changed_paths(None))
        self.assertIsNone(build_impact.changed_paths("not-a-commit"))
        self.assertTrue(build_impact.may_skip_vercel(()))


    def test_ci_path_filters_match_deploy_source_owners(self):
        workflow = (Path(__file__).resolve().parents[2] / ".github/workflows/public-site-candidate.yml").read_text(encoding="utf-8")
        expected = (
            "api/account-proxy.mjs",
            "api/oauth-consent.mjs",
            "lib/account-proxy-core.mjs",
            "infra/supabase/functions/_shared/**",
            "infra/supabase/functions/ordax-public-account-gateway/**",
            "package.json",
            "package-lock.json",
        )
        for path in expected:
            with self.subTest(path=path):
                self.assertEqual(workflow.count('"' + path + '"'), 2)
        self.assertNotIn('"api/**"', workflow)
        self.assertNotIn('"infra/supabase/functions/**"', workflow)

if __name__ == "__main__":
    unittest.main()
