import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RELEASE_V2_PATH = ROOT / "tools" / "component-package" / "release_v2.py"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


release_v2 = load_module("ordax_component_release_v2_bounds", RELEASE_V2_PATH)


def descriptor(*, provides=None, requires=None, state=None):
    return {
        "schema": release_v2.COMPATIBILITY_SCHEMA,
        "componentId": "local-ai-service",
        "componentVersion": "0.1.0",
        "provides": provides or [],
        "requires": requires or [],
        "state": state,
        "authority": "none",
    }


class RuntimeComponentReleaseV2BoundTests(unittest.TestCase):
    def test_accepts_canonical_contract_major_ceiling(self):
        value = descriptor(
            provides=[{"id": "ordax.contract", "major": release_v2.MAX_CONTRACT_MAJOR}],
            requires=[{
                "id": "ordax.required",
                "minMajor": release_v2.MAX_CONTRACT_MAJOR,
                "maxMajor": release_v2.MAX_CONTRACT_MAJOR,
                "optional": False,
            }],
        )
        self.assertIs(release_v2.validate_compatibility_descriptor(value), value)

    def test_rejects_contract_major_above_canonical_ceiling(self):
        value = descriptor(
            provides=[{
                "id": "ordax.contract",
                "major": release_v2.MAX_CONTRACT_MAJOR + 1,
            }],
        )
        with self.assertRaisesRegex(release_v2.ReleaseV2Error, "supported bound"):
            release_v2.validate_compatibility_descriptor(value)

    def test_accepts_canonical_state_version_ceiling(self):
        value = descriptor(
            state={
                "id": "ordax.state",
                "writeVersion": release_v2.MAX_STATE_VERSION,
                "readableFrom": 1,
                "readableThrough": release_v2.MAX_STATE_VERSION,
            },
        )
        self.assertIs(release_v2.validate_compatibility_descriptor(value), value)

    def test_rejects_state_version_above_canonical_ceiling(self):
        value = descriptor(
            state={
                "id": "ordax.state",
                "writeVersion": release_v2.MAX_STATE_VERSION + 1,
                "readableFrom": 1,
                "readableThrough": release_v2.MAX_STATE_VERSION + 1,
            },
        )
        with self.assertRaisesRegex(release_v2.ReleaseV2Error, "supported bound"):
            release_v2.validate_compatibility_descriptor(value)

    def test_accepts_128_compatibility_entries(self):
        value = descriptor(
            provides=[
                {"id": f"ordax.contract-{index}", "major": 1}
                for index in range(release_v2.MAX_COMPATIBILITY_ENTRIES)
            ]
        )
        self.assertIs(release_v2.validate_compatibility_descriptor(value), value)

    def test_rejects_129_compatibility_entries(self):
        value = descriptor(
            provides=[
                {"id": f"ordax.contract-{index}", "major": 1}
                for index in range(release_v2.MAX_COMPATIBILITY_ENTRIES + 1)
            ]
        )
        with self.assertRaisesRegex(release_v2.ReleaseV2Error, "provides list is invalid"):
            release_v2.validate_compatibility_descriptor(value)

    def test_accepts_canonical_160_character_id(self):
        contract_id = "a" + ("b" * 159)
        value = descriptor(provides=[{"id": contract_id, "major": 1}])
        self.assertIs(release_v2.validate_compatibility_descriptor(value), value)

    def test_rejects_id_longer_than_canonical_limit(self):
        contract_id = "a" + ("b" * 160)
        value = descriptor(provides=[{"id": contract_id, "major": 1}])
        with self.assertRaisesRegex(release_v2.ReleaseV2Error, "provided contract id is invalid"):
            release_v2.validate_compatibility_descriptor(value)


if __name__ == "__main__":
    unittest.main()
