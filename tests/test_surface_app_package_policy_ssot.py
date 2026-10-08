import json, re, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
POLICY=ROOT/"docs/contracts/runtime-component-package.json"
GENERATED=ROOT/"system/services/apps/package-source-policy.mjs"
class SurfaceAppPackagePolicySsotTests(unittest.TestCase):
    def test_generated_component_ids_match_policy(self):
        expected=sorted(json.loads(POLICY.read_text(encoding="utf-8"))["canonical_package_source_repository_by_component"])
        source=GENERATED.read_text(encoding="utf-8")
        found=re.findall(r'^  "([a-z][a-z0-9-]*)",$',source,re.MULTILINE)
        self.assertEqual(found,expected)
if __name__=="__main__":
    unittest.main()
