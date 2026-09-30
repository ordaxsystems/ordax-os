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
        "subjectId": "user-1",
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

    def test_stable_mvp_allows_only_public_zero_component_bundled_profiles(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = {
                "state_path": str(root / "state.json"),
                "inventory_path": str(root / "inventory.json"),
                "lock_path": str(root / "state.lock"),
            }

            pizzaria = module.execute_profile_activation_command(
                command(slug="pizzaria-br"),
                distribution_profile="stable-mvp",
                **args,
            )
            self.assertTrue(pizzaria["changed"])
            self.assertEqual(
                pizzaria["state"]["spaces"][0]["current"]["profile"],
                {"slug": "pizzaria-br", "version": 1},
            )
            self.assertEqual(pizzaria["permissionDiff"]["componentAdds"], [])
            self.assertFalse(pizzaria["permissionDiff"]["requiresExplicitReview"])

            next_payload = command(revision=1, slug="impressao-3d-br")
            printing = module.execute_profile_activation_command(
                next_payload,
                distribution_profile="stable-mvp",
                **args,
            )
            self.assertTrue(printing["changed"])
            self.assertEqual(
                printing["state"]["spaces"][0]["current"]["profile"],
                {"slug": "impressao-3d-br", "version": 1},
            )

            with self.assertRaisesRegex(PermissionError, "not publicly available"):
                module.execute_profile_activation_command(
                    command(revision=2, slug="developer"),
                    distribution_profile="stable-mvp",
                    **args,
                )

            public_component_manifest = {
                "activation": {"publicly_available": True},
                "components": [{
                    "id": "knowledge.example",
                    "kind": "knowledge-pack",
                    "version": "1.0.0",
                    "required": True,
                    "availability": "available",
                    "sha256": "a" * 64,
                    "signature_required": True,
                }],
            }
            with self.assertRaisesRegex(PermissionError, "zero-component bundled Profile"):
                module._assert_stable_mvp_activation_allowed(
                    public_component_manifest,
                    [],
                    {
                        "schema": "ordax.profile-permission-diff/1",
                        "componentAdds": [],
                        "componentRemovals": [],
                        "authorityChanges": [],
                        "requiresExplicitReview": False,
                    },
                )
            with self.assertRaisesRegex(PermissionError, "blocked by canonical manifest"):
                module.execute_profile_activation_command(
                    command(revision=2, slug="legal-br"),
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
        digest = module._permission_review_digest(\n            expected_revision=1,
            subject_id="user-1",
            space_id="space-professional-1",
            space_kind="professional",
            profile={"slug": "developer", "version": 1},
            components=[component],
            permission_diff=diff,
        )
        self.assertRegex(digest, r"^[0-9a-f]{64}$")

    def test_permission_diff_acceptance_is_bound_to_exact_revision_and_components(self):
        module = load_module()
        manifest = {
            "space_kind": "professional",
            "state": "draft",
            "intelligence": {"external_provider_required": False},
            "security": {
                "auto_grant_privileges": False,
                "allow_unsigned_apps": False,
                "generic_shell_implied": False,
                "cross_space_memory": False,
            },
            "components": [{
                "id": "knowledge.example",
                "kind": "knowledge-pack",
                "version": "1.0.0",
                "required": True,
                "availability": "available",
                "sha256": "a" * 64,
                "signature_required": True,
            }],
        }
        component = {
            "id": "knowledge.example",
            "kind": "knowledge-pack",
            "version": "1.0.0",
            "sha256": "a" * 64,
            "receiptSha256": "b" * 64,
            "installedAt": 1,
        }
        original_manifest = module._canonical_manifest
        original_activate = module.activate_profile
        original_read = module.read_profile_activation_state
        try:
            module._canonical_manifest = lambda slug, version: manifest
            module.read_profile_activation_state = lambda path: {
                "schema": "ordax.profile-activation-state/2",
                "revision": 7,
                "persistence": "device",
                "spaces": [],
            }
            module.activate_profile = lambda **kwargs: {
                "changed": True,
                "state": {
                    "schema": "ordax.profile-activation-state/2",
                    "revision": 8,
                    "persistence": "device",
                    "spaces": [],
                },
            }
            preview = {
                "schema": "ordax.profile-activation-command/1",
                "action": "preview-activate",
                "expectedRevision": 7,
                "spaceId": "space-professional-1",
                "spaceKind": "professional",
                "profile": {"slug": "developer", "version": 1},
                "components": [component],
            }
            result = module.execute_profile_activation_command(
                preview,
                distribution_profile="owner-development",
            )
            self.assertTrue(result["permissionDiff"]["requiresExplicitReview"])
            digest = result["permissionDiffSha256"]
            self.assertEqual(len(digest), 64)

            activation_payload = {
                **preview,
                "action": "activate",
                "activatedAt": 1234,
                "acceptedPermissionDiffSha256": "0" * 64,
            }
            with self.assertRaisesRegex(PermissionError, "missing or stale"):
                module.execute_profile_activation_command(
                    activation_payload,
                    distribution_profile="owner-development",
                )

            activation_payload["acceptedPermissionDiffSha256"] = digest
            with self.assertRaisesRegex(PermissionError, "trusted human confirmation surface"):
                module.execute_profile_activation_command(
                    activation_payload,
                    distribution_profile="owner-development",
                )

            consumed = []
            resolved = []
            class ConsentAuthority:
                def consume(self, receipt, **kwargs):
                    consumed.append((receipt, kwargs))

            def consent_resolver(**kwargs):
                resolved.append(kwargs)
                return {"receipt": "native-only-test"}

            activated = module.execute_profile_activation_command(
                activation_payload,
                distribution_profile="owner-development",
                human_consent_authority=ConsentAuthority(),
                human_consent_resolver=consent_resolver,
            )
            self.assertTrue(activated["changed"])
            self.assertEqual(consumed[0][0], {"receipt": "native-only-test"})
            self.assertEqual(consumed[0][1]["permission_diff_sha256"], digest)
            self.assertEqual(consumed[0][1]["expected_revision"], 7)
            self.assertEqual(resolved[0]["permission_diff_sha256"], digest)
            self.assertEqual(resolved[0]["space_id"], "space-professional-1")

            forged = {**activation_payload, "humanConsent": {"receipt": "forged"}}
            with self.assertRaisesRegex(ValueError, "fields are incompatible"):
                module.execute_profile_activation_command(
                    forged,
                    distribution_profile="owner-development",
                    human_consent_authority=ConsentAuthority(),
                    human_consent_resolver=consent_resolver,
                )

            changed_revision = {**preview, "expectedRevision": 8}
            changed = module.execute_profile_activation_command(
                changed_revision,
                distribution_profile="owner-development",
            )
            self.assertNotEqual(changed["permissionDiffSha256"], digest)
        finally:
            module._canonical_manifest = original_manifest
            module.activate_profile = original_activate
            module.read_profile_activation_state = original_read

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

    def test_stable_rollback_revalidates_previous_profile_inside_lock(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state_path = root / "state.json"
            inventory_path = root / "inventory.json"
            lock_path = root / "state.lock"
            args = {
                "state_path": str(state_path),
                "inventory_path": str(inventory_path),
                "lock_path": str(lock_path),
            }

            module.execute_profile_activation_command(
                command(slug="pizzaria-br"),
                distribution_profile="stable-mvp",
                **args,
            )
            module.execute_profile_activation_command(
                command(revision=1, slug="impressao-3d-br"),
                distribution_profile="stable-mvp",
                **args,
            )

            state = json.loads(state_path.read_text(encoding="utf-8"))
            state["spaces"][0]["previous"]["profile"] = {"slug": "developer", "version": 1}
            state_path.write_text(
                json.dumps(state, separators=(",", ":"), sort_keys=True) + "\n",
                encoding="utf-8",
            )
            os.chmod(state_path, 0o600)

            with self.assertRaisesRegex(PermissionError, "not publicly available"):
                module.execute_profile_activation_command(
                    command(action="rollback", revision=2),
                    distribution_profile="stable-mvp",
                    **args,
                )

            after = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(after["revision"], 2)
            self.assertEqual(
                after["spaces"][0]["current"]["profile"]["slug"],
                "impressao-3d-br",
            )

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
