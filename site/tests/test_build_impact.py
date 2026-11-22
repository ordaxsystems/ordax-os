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
            "system/surface/runtime/native_host_server.py",
            "system/services/update/native_update.py",
            "third_party/licenses/Other-OFL.txt",
            "tools/surface-web/build.py",
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
            "vercel.json",
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
            "system/surface/ui/meridian.css",
            "system/surface/workspace/components/central/meridian-home.tsx",
            "system/apps/catalog.mjs",
            "system/contracts/space-selection.mjs",
            "system/services/apps/first-run-selection.mjs",
            "system/services/i18n/surface.mjs",
            "system/services/preferences/regional.mjs",
            "system/services/profile-packs/catalog.mjs",
            "system/services/spaces/authorized-view.mjs",
            "system/services/surface/shortcut-catalog.mjs",
            "system/services/system-ui/account/app.mjs",
            "tools/brand/build.py",
            "tools/surface-source/materialize.py",
            "docs/contracts/surface-source.json",
            "third_party/licenses/Inter-OFL-1.1.txt",
        )
        for path in paths:
            with self.subTest(path=path):
                self.assertFalse(build_impact.may_skip_vercel((path,)))
                self.assertTrue(build_impact.affects_site_deployment(path))

    def test_canonical_visual_changes_cannot_be_skipped(self):
        self.assertFalse(build_impact.may_skip_vercel((
            "creator/core/portable_update.go",
            "system/surface/ui/tokens.css",
        )))
        self.assertTrue(build_impact.may_skip_vercel((
            "creator/core/portable_update.go",
            "system/surface/runtime/native_host_server.py",
        )))

    def test_archived_staging_project_is_rejected_by_vercel_builder(self):
        import os
        import subprocess
        env = dict(os.environ)
        env.update(VERCEL_PROJECT_ID="prj_rEZck0dLNrLlSX9UhjifUzGiFpts",
                   VERCEL_GIT_COMMIT_SHA="a" * 40)
        runner = Path(__file__).resolve().parents[2] / "tools/vercel/build.py"
        result = subprocess.run([sys.executable, str(runner)], env=env,
                                capture_output=True, text=True, timeout=12)
        self.assertEqual(result.returncode, 1)
        self.assertIn("unrecognized canonical project", result.stderr)

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
            "system/surface/ui/**",
            "system/surface/workspace/**",
            "system/apps/**",
            "system/contracts/**",
            "system/services/apps/**",
            "system/services/i18n/**",
            "system/services/preferences/**",
            "system/services/profile-packs/**",
            "system/services/spaces/**",
            "system/services/surface/**",
            "system/services/system-ui/**",
            "tools/brand/**",
            "tools/surface-source/**",
            "docs/contracts/surface-source.json",
            "third_party/licenses/Inter-OFL-1.1.txt",
        )
        for path in expected:
            with self.subTest(path=path):
                self.assertEqual(workflow.count('"' + path + '"'), 2)
        self.assertNotIn('"api/**"', workflow)
        self.assertNotIn('"infra/supabase/functions/**"', workflow)

if __name__ == "__main__":
    unittest.main()
