"""Site monorepo ownership checks — no source mirror or gateway downloader."""
import json
import unittest
from pathlib import Path

SITE=Path(__file__).resolve().parents[1]
OS=SITE.parent

class CanonicalModuleTests(unittest.TestCase):
 def test_one_public_frontend(self):
  self.assertTrue((SITE/"public/index.html").is_file())
  self.assertFalse((SITE/"site").exists())
  self.assertTrue((SITE/"scripts/build.py").is_file())
 def test_same_commit_source_contract(self):
  contract=json.loads((OS/"docs/contracts/public-site-source.json").read_text(encoding="utf-8"))
  self.assertEqual(contract["repository"],"ordaxsystems/ordax-os")
  self.assertEqual(contract["module_path"],"site")
  self.assertEqual(contract["frontend_path"],"site/public")
  self.assertEqual(contract["source_revision"],"same-git-commit-as-os")
  self.assertFalse(contract["production_deployment_activated"])
 def test_one_workspace_lock_for_serverless_dependencies(self):
  host=json.loads((SITE/"package.json").read_text(encoding="utf-8"))
  root=json.loads((OS/"package.json").read_text(encoding="utf-8"))
  lock=json.loads((OS/"package-lock.json").read_text(encoding="utf-8"))
  vercel=json.loads((SITE/"vercel.json").read_text(encoding="utf-8"))
  self.assertIn("site",root["workspaces"])
  self.assertEqual(lock["packages"]["site"]["dependencies"],host["dependencies"])
  self.assertFalse((SITE/"package-lock.json").exists())
  self.assertIn("cd .. && npm ci --workspace=site",vercel["installCommand"])
  self.assertTrue((OS/"lib/account-proxy-core.mjs").is_file())

 def test_canonical_gateway(self):
  self.assertFalse((SITE/"contracts/canonical-gateway-source.json").exists())
  self.assertFalse((SITE/"scripts/stage_canonical_gateway.py").exists())
  for name in ("account-proxy.mjs","oauth-consent.mjs"):
   body=(SITE/"api"/name).read_text(encoding="utf-8")
   self.assertIn("../../api/"+name,body)
   self.assertTrue((OS/"api"/name).is_file())
   self.assertNotIn(".gateway-source",body)
  vercel=json.loads((SITE/"vercel.json").read_text(encoding="utf-8"))
  self.assertNotIn("stage_canonical_gateway",vercel["installCommand"])
  self.assertTrue(any(x["source"]=="/oauth/consent" for x in vercel["rewrites"]))
  self.assertIn("noindex",str(vercel["headers"]))
 def test_no_site_repo_consumer(self):
  builder=(OS/"tools/vercel/build.py").read_text(encoding="utf-8")
  self.assertIn('"site/scripts/build.py"',builder)
  self.assertNotIn("ordax-site.git",builder)
  self.assertFalse((OS/"tools/vercel/site_source.py").exists())

if __name__=="__main__":
 unittest.main()
