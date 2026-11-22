"""Fast, hermetic tests for Vercel deployment admission (no network or secret)."""
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'tools/vercel/selective_site_delivery.py'
spec = importlib.util.spec_from_file_location('site_delivery', SCRIPT)
site_delivery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(site_delivery)
GOOD_SHA = 'a' * 40
OLD_SHA = 'b' * 40


def live(sha=OLD_SHA):
    return {'artifact_class':'public-site', 'source_commit':sha,
            'brand': {'source_repository':'ordaxsystems/ordax-os', 'source_commit':sha},
            'surface_preview': {'source_repository':'ordaxsystems/ordax-os', 'source_commit':sha}}


class SelectiveSiteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        path = Path(self.temp.name)/'build_impact.py'
        path.write_text('def affects_site_deployment(path):\n  return path.startswith("site/") or path.startswith("system/surface/ui/")\n')
        patcher = patch.object(site_delivery, 'SITE_IMPACT', path)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_live_same_sha_and_provenance_does_not_deploy(self):
        with patch.object(site_delivery, 'json_request', side_effect=AssertionError('no HTTP needed')):
            self.assertFalse(site_delivery.needs_deployment(live(GOOD_SHA), GOOD_SHA, 'GH_TOKEN'))

    def test_missing_or_old_source_requires_build(self):
        self.assertTrue(site_delivery.needs_deployment({}, GOOD_SHA, 'GH_TOKEN'))
        broken = live(GOOD_SHA)
        broken['brand']['source_repository'] = 'ordaxsystems/ordax-surface'
        self.assertTrue(site_delivery.needs_deployment(broken, GOOD_SHA, 'GH_TOKEN'))

    def test_native_only_changes_skip_external_deployment(self):
        payload={'status':'ahead','files':[{'filename':'creator/core/install.go','status':'modified'},
                                          {'filename':'docs/README.md','status':'modified'}]}
        with patch.object(site_delivery,'json_request',return_value=payload):
            self.assertFalse(site_delivery.needs_deployment(live(),GOOD_SHA,'GH_TOKEN'))

    def test_visual_change_triggers_deployment(self):
        payload={'status':'ahead','files':[{'filename':'system/surface/ui/tokens.css','status':'modified'}]}
        with patch.object(site_delivery,'json_request',return_value=payload):
            self.assertTrue(site_delivery.needs_deployment(live(),GOOD_SHA,'GH_TOKEN'))

    def test_rename_previous_path_is_impactful(self):
        payload={'status':'ahead','files':[{'filename':'docs/old.txt','previous_filename':'site/public/index.html','status':'renamed'}]}
        with patch.object(site_delivery,'json_request',return_value=payload):
            self.assertTrue(site_delivery.needs_deployment(live(),GOOD_SHA,'GH_TOKEN'))

    def test_ambiguous_comparison_fails_closed(self):
        for payload in ({'status':'diverged','files':[]},{'status':'ahead','files':[{'filename':'a','status':'modified'}]*300}, {'status':'ahead'}):
            with self.subTest(payload=payload), patch.object(site_delivery,'json_request',return_value=payload):
                self.assertTrue(site_delivery.needs_deployment(live(),GOOD_SHA,'GH_TOKEN'))

    def test_create_deployment_has_pinned_sha_and_only_one_post(self):
        calls=[]
        def stub(url, **kwargs):
            calls.append((url,kwargs))
            return {'id':'dpl_test123'}
        with patch.object(site_delivery,'json_request',side_effect=stub):
            self.assertEqual(site_delivery.publish(GOOD_SHA,'VERCEL_TOKEN'),'dpl_test123')
        self.assertEqual(len(calls),1)
        self.assertEqual(calls[0][1]['post']['gitSource']['sha'],GOOD_SHA)
        self.assertEqual(calls[0][1]['post']['project'],site_delivery.PROJECT_ID)
        self.assertEqual(calls[0][1]['post']['target'],'production')

    def test_not_enabled_prevents_external_operations(self):
        with patch.dict(os.environ,{'ORDAX_SITE_SELECTIVE_DEPLOY_ENABLED':'false'}, clear=True):
            with patch.object(site_delivery,'json_request',side_effect=AssertionError('never call API')):
                with self.assertRaisesRegex(site_delivery.DeliveryError,'not explicitly enabled'):
                    site_delivery.main()

    def test_enabled_requires_auth_without_http_calls(self):
        with patch.dict(os.environ,{'ORDAX_SITE_SELECTIVE_DEPLOY_ENABLED':'true',
                                    'ORDAX_SITE_CANDIDATE_SHA':GOOD_SHA},clear=True):
            with patch.object(site_delivery,'json_request',side_effect=AssertionError('never call API')):
                with self.assertRaisesRegex(site_delivery.DeliveryError,'credentials'):
                    site_delivery.main()

    def test_newer_site_source_defers_until_own_ci(self):
        with patch.dict(os.environ,{'ORDAX_SITE_SELECTIVE_DEPLOY_ENABLED':'true',
                                    'ORDAX_SITE_CANDIDATE_SHA':GOOD_SHA,
                                    'GITHUB_TOKEN':'gh','VERCEL_TOKEN':'vercel'},clear=True):
            with patch.object(site_delivery,'json_request',return_value={'commit':{'sha':OLD_SHA}}):
                with patch.object(site_delivery,'compare_paths',return_value=['site/public/index.html']):
                    with patch.object(site_delivery,'publish',side_effect=AssertionError('no publish')):
                        self.assertEqual(site_delivery.main(),0)

    def test_newer_native_only_commit_keeps_verified_site_candidate(self):
        calls=[]
        def mock_json(url, **kwargs):
            if url.endswith('/branches/main'):
                return {'commit':{'sha':OLD_SHA}}
            if 'public-site-manifest' in url:
                return live('c'*40)
            return {'status':'ahead', 'files':[]}
        with patch.dict(os.environ,{'ORDAX_SITE_SELECTIVE_DEPLOY_ENABLED':'true',
                                    'ORDAX_SITE_CANDIDATE_SHA':GOOD_SHA,
                                    'GITHUB_TOKEN':'gh','VERCEL_TOKEN':'vercel'},clear=True), \
             patch.object(site_delivery,'json_request',side_effect=mock_json), \
             patch.object(site_delivery,'compare_paths',side_effect=lambda base,head,token: ['creator/core/portable.go'] if base==GOOD_SHA else ['site/public/index.html']), \
             patch.object(site_delivery,'publish',side_effect=lambda sha, token:calls.append(sha) or 'dpl_example'), \
             patch.object(site_delivery,'verify_ready'):
            self.assertEqual(site_delivery.main(),0)
        self.assertEqual(calls,[OLD_SHA])


if __name__ == '__main__':
    unittest.main()
