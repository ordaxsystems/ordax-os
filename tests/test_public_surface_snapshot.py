"""The public demo may reuse presentation, never a live identity or transport."""
import hashlib
import json
import re
import unittest
import tempfile
import importlib.util
from unittest.mock import patch
from pathlib import Path
from html.parser import HTMLParser
ROOT=Path(__file__).resolve().parents[1]

class Markup(HTMLParser):
    def __init__(self):
        super().__init__(); self.tags=[]; self.copy=[]
    def handle_starttag(self,tag,attrs): self.tags.append((tag,dict(attrs)))
    def handle_data(self,data):
        if data.strip(): self.copy.append(data.strip())

class PublicSurfaceSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.snapshot=json.loads((ROOT/'sites/public/assets/surface-snapshot.json').read_text(encoding='utf-8'))
    def test_visual_artifact_tracks_real_component_sources(self):
        tracked={entry['path']:entry['sha256'] for entry in self.snapshot['sources']}
        for owner in ['meridian-home.tsx','meridian-navigation.tsx','config.ts','meridian.css','service-overview.tsx','settings.tsx','primitives.tsx']:
            self.assertTrue(any(path.endswith('/'+owner) for path in tracked),owner)
        for path,digest in tracked.items():
            payload=(ROOT/path).read_bytes()
            if Path(path).suffix in {'.ts','.tsx','.js','.jsx','.mjs','.css','.json','.svg'}: payload=payload.replace(b'\r\n',b'\n')
            self.assertEqual(hashlib.sha256(payload).hexdigest(),digest,path)
    def test_source_provenance_accepts_windows_and_linux_text_checkouts(self):
        spec=importlib.util.spec_from_file_location('public_demo_fixture',ROOT/'tools/public-site/playground_fixture.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(prefix='ordax-demo-portability-') as directory:
            checkout=Path(directory)
            for newline in (b'\n',b'\r\n'):
                for source in self.snapshot['sources']:
                    target=checkout/source['path']
                    self.assertTrue(target.resolve().is_relative_to(checkout.resolve()))
                    target.parent.mkdir(parents=True,exist_ok=True)
                    payload=(ROOT/source['path']).read_bytes()
                    if target.suffix in {'.ts','.tsx','.js','.jsx','.mjs','.css','.json','.svg'}:
                        payload=payload.replace(b'\r\n',b'\n').replace(b'\n',newline)
                    target.write_bytes(payload)
                with patch.object(module,'ROOT',checkout):
                    self.assertEqual(module._current_surface_snapshot()['cssSha256'],self.snapshot['cssSha256'])

    def test_real_navigation_order_is_not_a_second_menu_catalog(self):
        source=(ROOT/'system/surface/workspace/components/central/config.ts').read_text(encoding='utf-8')
        block=source.split('export const navigation:')[1].split('];')[0]
        catalog=(ROOT/'system/services/surface/destination-catalog.mjs').read_text(encoding='utf-8')
        labels=dict(re.findall(r"\{ id: '([^']+)', label: '([^']+)'",catalog))
        tokens=re.findall(r"name:\s*(?:'([^']+)'|surfaceName\('([^']+)'\))",block)
        actual=[]
        for literal,destination_id in tokens:
            if literal:
                actual.append(literal)
                continue
            self.assertIn(destination_id,labels)
            actual.append(labels[destination_id])
        self.assertEqual([row['name'] for row in self.snapshot['navigation']],actual)
        for destination_id in [destination_id for _,destination_id in tokens if destination_id]:
            self.assertNotIn("name: '"+labels[destination_id]+"'",block)
    def test_snapshots_are_static_local_presentation(self):
        markup=Markup();markup.feed(self.snapshot['chrome']+' '.join(self.snapshot['views'].values()))
        for tag,attrs in markup.tags:
            self.assertNotIn(tag,{'script','iframe'})
            self.assertNotIn('style',attrs)
            self.assertFalse(any(key.startswith('on') for key in attrs))
            if tag=='form': self.assertNotIn('action',attrs)
            if 'src' in attrs: self.assertTrue(attrs['src'].startswith('/assets/'),attrs['src'])
        self.assertIn('meridian-rail',self.snapshot['chrome'])
        self.assertIn('meridian-taskbar',self.snapshot['chrome'])
        self.assertIn('meridian-home',self.snapshot['views']['home'])
        self.assertIn('Conta não conectada',self.snapshot['views']['account'])
        for page in ['projects','files','devices','activity','continuity']:
            self.assertIn('Integração pendente',self.snapshot['views'][page])
    def test_public_renderer_has_no_account_or_surface_runtime_dependency(self):
        source=(ROOT/'sites/public/assets/playground.js').read_text(encoding='utf-8')
        self.assertNotIn('fetch(',source)
        self.assertNotIn('import(',source)
        self.assertIn("input.disabled=true",source)
        self.assertIn("event.preventDefault()",source)
        self.assertIn('surface.chrome',source)
