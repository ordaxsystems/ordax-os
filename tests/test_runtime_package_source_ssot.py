import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
POLICY = ROOT / "docs" / "contracts" / "runtime-component-package.json"
GENERATED = ROOT / "tools" / "runtime-component-channel" / "external_sources_generated.go"

def test_runtime_package_source_go_table_matches_policy_ssot():
    policy = json.loads(POLICY.read_text(encoding="utf-8"))
    expected = policy["canonical_package_source_repository_by_component"]
    source = GENERATED.read_text(encoding="utf-8")
    found = {
        component_id: "washingtonmsdj/ordax-apps"
        for component_id in re.findall(r'^\t"([a-z][a-z0-9-]*)": appsSourceRepository,$', source, re.MULTILINE)
    }
    assert found == expected
