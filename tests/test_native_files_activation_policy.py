"""Files cannot enter Native module-read before per-operation host scoping exists."""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "tools/app-policy/render_external_first_party_policy.py"
POLICY = ROOT / "docs/contracts/runtime-component-package.json"


def generator_module():
    spec = importlib.util.spec_from_file_location("ordax_external_app_policy", GENERATOR)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class NativeFilesActivationPolicyTests(unittest.TestCase):
    def test_files_module_read_rejects_unscoped_native_backend(self):
        generator = generator_module()
        original = json.loads(POLICY.read_text(encoding="utf-8"))
        self.assertFalse(original["native_files_slot_bound_file_space_enforced"])
        self.assertNotIn("files", original["native_loopback_broker_supported_components"])
        # If someone enables module-read through the SSOT without the Native
        # scope-enforcement gate, CI must fail before generated JS can change.
        for scoped in (False, None, "true"):
            mutated = json.loads(json.dumps(original))
            mutated["native_loopback_broker_supported_components"].append("files")
            mutated["native_files_slot_bound_file_space_enforced"] = scoped
            with tempfile.TemporaryDirectory() as temp:
                target = Path(temp) / "policy.json"
                target.write_text(json.dumps(mutated), encoding="utf-8")
                with self.assertRaisesRegex(
                    generator.PolicyGenerationError, "Files Native scoped|Files module-read",
                ):
                    generator.load_policy(target)

    def test_canonical_policy_still_generates_same_external_inventory(self):
        generator = generator_module()
        sources, module_ids, probation_ids = generator.load_policy(POLICY)
        self.assertNotIn("files", sources)
        self.assertNotIn("files", module_ids)
        self.assertNotIn("files", probation_ids)
        self.assertEqual(module_ids, ("calculator", "notes", "studio"))


if __name__ == "__main__":
    unittest.main()
