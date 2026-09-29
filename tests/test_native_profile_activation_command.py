from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import json
import os
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
MODULE = RUNTIME / "native_profile_activation_command.py"


def load_module():
    sys.path.insert(0, str(RUNTIME))
    try:
        spec = spec_from_file_location("ordax_profile_activation_command_test", MODULE)
        module = module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(RUNTIME))


def command(action="activate", revision=0, slug="developer"):
    payload = {
        "schema": "ordax.profile-activation-command/1",
        "action": action,
        "expectedRevision": revision,
        "spaceId": "space-professional-1",
    }
    if action == "activate":
        payload.update({
            "spaceKind": "professional",
            "profile": {"slug": slug, "version": 1},
            "components": [],
            "activatedAt": 1234,
        })
    return payload


class NativeProfileActivationCommandTests(unittest.TestCase):
    def test_owner_development_can_activate_canonical_developer_profile(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = module.execute_profile_activation_command(
                command(),
                distribution_profile="owner-development",
                state_path=str(root / "state.json"),
                inventory_path=str(root / "inventory.json"),
                lock_path=str(root / "state.lock"),
            )
            self.assertTrue(result["changed"])
            self.assertEqual(result["state"]["revision"], 1)
            row = result["state"]["spaces"][0]
            self.assertEqual(row["spaceKind"], "professional")
            self.assertEqual(row["current"]["profile"], {"slug": "developer", "version": 1})
            self.assertEqual(result["permissionDiff"], {
                "schema": "ordax.profile-permission-diff/1",
                "componentAdds": [],
                "componentRemovals": [],
                "authorityChanges": [],
                "requiresExplicitReview": False,
            })

    def test_stable_and_manifest_blocked_profiles_fail_closed(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = {
                "state_path": str(root / "state.json"),
                "inventory_path": str(root / "inventory.json"),
                "lock_path": str(root / "state.lock"),
            }
            with self.assertRaisesRegex(PermissionError, "unavailable in this distribution"):
                module.execute_profile_activation_command(
                    command(),
                    distribution_profile="stable-mvp",
                    **args,
                )
            with self.assertRaisesRegex(PermissionError, "blocked by canonical manifest"):
                module.execute_profile_activation_command(
                    command(slug="legal-br"),
                    distribution_profile="owner-development",
                    **args,
                )

    def test_arbitrary_profile_and_component_bearing_activation_are_rejected(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = {
                "distribution_profile": "owner-development",
                "state_path": str(root / "state.json"),
                "inventory_path": str(root / "inventory.json"),
                "lock_path": str(root / "state.lock"),
            }
            with self.assertRaisesRegex(ValueError, "canonical bundled catalog"):
                module.execute_profile_activation_command(command(slug="invented"), **args)
            payload = command()
            payload["components"] = [{
                "id": "knowledge.example",
                "kind": "knowledge-pack",
                "version": "1.0.0",
                "sha256": "a" * 64,
                "receiptSha256": "b" * 64,
                "installedAt": 1,
            }]
            with self.assertRaisesRegex(ValueError, "outside the canonical manifest"):
                module.execute_profile_activation_command(payload, **args)

    def test_canonical_component_binding_emits_permission_diff_and_blocks_unreviewed_activation(self):
        module = load_module()
        manifest = {
            "components": [{
                "id": "knowledge.example",
                "kind": "knowledge-pack",
                "version": "1.0.0",
                "required": True,
                "availability": "available",
                "sha256": "a" * 64,
                "signature_required": True,
            }]
        }
        component = {
            "id": "knowledge.example",
            "kind": "knowledge-pack",
            "version": "1.0.0",
            "sha256": "a" * 64,
            "receiptSha256": "b" * 64,
            "installedAt": 1,
        }
        diff = module._canonical_component_binding(manifest, [component])
        self.assertEqual(diff["componentAdds"][0]["id"], "knowledge.example")
        self.assertTrue(diff["requiresExplicitReview"])

    def test_revision_conflict_is_checked_inside_mutation_lock(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = {
                "distribution_profile": "owner-development",
                "state_path": str(root / "state.json"),
                "inventory_path": str(root / "inventory.json"),
                "lock_path": str(root / "state.lock"),
            }
            module.execute_profile_activation_command(command(), **args)
            with self.assertRaisesRegex(RuntimeError, "revision changed"):
                module.execute_profile_activation_command(command(revision=0), **args)

    def test_deactivate_and_rollback_are_revision_bound(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = {
                "distribution_profile": "owner-development",
                "state_path": str(root / "state.json"),
                "inventory_path": str(root / "inventory.json"),
                "lock_path": str(root / "state.lock"),
            }
            module.execute_profile_activation_command(command(), **args)
            deactivated = module.execute_profile_activation_command(
                command(action="deactivate", revision=1),
                **args,
            )
            self.assertIsNone(deactivated["state"]["spaces"][0]["current"])
            restored = module.execute_profile_activation_command(
                command(action="rollback", revision=2),
                **args,
            )
            self.assertEqual(
                restored["state"]["spaces"][0]["current"]["profile"]["slug"],
                "developer",
            )


if __name__ == "__main__":
    unittest.main()
