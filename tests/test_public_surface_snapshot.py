"""The public demo may reuse presentation, never a live identity or transport."""
import hashlib
import json
import re
import unittest
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
            self.assertEqual(hashlib.sha256((ROOT/path).read_bytes()).hexdigest(),digest,path)
    def test_real_navigation_order_is_not_a_second_menu_catalog(self):
        source=(ROOT/'system/surface/workspace/components/central/config.ts').read_text(encoding='utf-8')
        block=source.split('export const navigation:')[1].split('];')[0]
        self.assertEqual([row['name'] for row in self.snapshot['navigation']],re.findall(r"name: '([^']+)'",block))
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
