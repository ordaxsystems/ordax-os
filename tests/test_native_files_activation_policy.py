"""Files signed-slot reads and read-only pending mount probation are explicit gates."""

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
    def test_files_reads_require_slot_bound_device_local_scope(self):
        generator = generator_module()
        original = json.loads(POLICY.read_text(encoding="utf-8"))
        self.assertTrue(original["native_files_slot_bound_file_space_enforced"])
        sources, module_ids, probation_ids, bundled_owner_blocked = generator.load_policy(POLICY)
        self.assertEqual(sources["files"], "ordaxsystems/ordax-apps")
        self.assertIn("files", module_ids)
        self.assertIn("files", probation_ids)
        self.assertEqual(bundled_owner_blocked, ())
        self.assertEqual(original["runtime_health_bridge_probe_mode_by_component"]["files"], "mount-contract")
        self.assertFalse(original["files_component_distribution_activation_enabled"])

        # Canonical owner or Native module-read metadata cannot open Files
        # unless the exact signed-slot/device-local boundary remains enabled.
        mutated = json.loads(json.dumps(original))
        mutated["native_files_slot_bound_file_space_enforced"] = False
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "policy.json"
            target.write_text(json.dumps(mutated), encoding="utf-8")
            with self.assertRaisesRegex(
                generator.PolicyGenerationError,
                "Files source transfer or module-read",
            ):
                generator.load_policy(target)

    def test_files_activation_and_publication_stay_closed_until_lifecycle_proof(self):
        # Candidate mount probation does not transfer source ownership or open
        # current-slot activation. Promotion and publication remain separate.
        policy = json.loads(POLICY.read_text(encoding="utf-8"))
        self.assertFalse(policy["files_component_distribution_activation_enabled"])
        self.assertFalse(policy["files_component_promotion_proven"])
        self.assertFalse(policy["files_component_rollback_proven"])
        self.assertFalse(policy["publish_allowed"])
        self.assertTrue(policy["native_pending_files_mount_probe_opaque_origin"])
        self.assertFalse(policy["native_pending_files_mount_probe_exposes_user_data"])
        self.assertFalse(policy["native_pending_files_mount_probe_mutates_user_data"])
        self.assertEqual(
            policy["native_pending_files_mount_probe_file_space_scope"],
            "empty-synthetic-root",
        )


if __name__ == "__main__":
    unittest.main()
