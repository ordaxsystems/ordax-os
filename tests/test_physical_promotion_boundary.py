#!/usr/bin/env python3
"""Regress separation between Portable layout policy and destructive authorization."""

import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "creator" / "physical_promotion.py"
spec = importlib.util.spec_from_file_location("ordax_physical_promotion_test", MODULE_PATH)
promotion = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(promotion)

AUTHORIZATION_TOOL_PATH = ROOT / "tools" / "creator" / "authorize_physical_write.py"
PHYSICAL_PROMOTION_WORKFLOW = ROOT / ".github" / "workflows" / "physical-write-promotion.yml"
PHYSICAL_TEST_SOURCE = ROOT / "tools" / "creator" / "cmd" / "ordax-creator-physical-test" / "main_windows.go"
authorization_spec = importlib.util.spec_from_file_location(
    "ordax_owner_authorization_test", AUTHORIZATION_TOOL_PATH
)
authorization = importlib.util.module_from_spec(authorization_spec)
assert authorization_spec.loader is not None
authorization_spec.loader.exec_module(authorization)


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class PhysicalPromotionBoundaryTests(unittest.TestCase):
    def make_ready_fixture(self, root: Path) -> None:
        trust = {
            "$schema": "prototype-ordax.release-trust/1",
            "key_id": "ordax-prototype-release-v1",
            "public_key_base64": base64.b64encode(bytes(range(32))).decode("ascii"),
        }
        trust_path = root / "bootstrap/trust/release-ed25519.json"
        write_json(trust_path, trust)
        trust_sha = sha256(trust_path)

        proof = {
            "schema": "prototype-ordax.portable-v4-canonical-release-proof/1",
            "source_commit": "a" * 40,
            "canonical_envelope_url": "https://releases.ordax.example/stable-v4/release-envelope.json",
            "canonical_trust_sha256": trust_sha,
            "release_manifest_sha256": "1" * 64,
            "release_envelope_sha256": "2" * 64,
            "artifacts": {
                "system.erofs": {"sha256": "3" * 64, "size": 4096},
                "native-surface-runtime.erofs": {"sha256": "4" * 64, "size": 8192},
                "local-ai-runtime.erofs": {"sha256": "5" * 64, "size": 16384},
            },
            "signed_handoff_receipt_sha256": "6" * 64,
            "canonical_materialization_receipt_sha256": "7" * 64,
            "signed_handoff_verified": True,
            "canonical_materialization_verified": True,
            "release_activated": False,
            "physical_target_selected": False,
            "physical_write_authorized": False,
            "physical_write_performed": False,
        }
        proof_path = root / "docs/evidence/canonical-v4-release-proof.json"
        write_json(proof_path, proof)
        proof_sha = sha256(proof_path)

        minimal = {
            "$schema": "prototype-ordax.minimal-bootstrap/4",
            "status": "canonical-bytes-resolved",
            "physical_write_allowed": False,
            "all_artifacts_resolved": True,
            "artifact_groups": [
                {
                    "id": "bootstrap-release-trust",
                    "partition": "ORDAX-ESP",
                    "source_owner": "bootstrap/trust",
                    "resolved": True,
                    "artifacts": [
                        {
                            "source_path": "bootstrap/trust/release-ed25519.json",
                            "target_path": "/ordax/bootstrap/trust/release-ed25519.json",
                            "sha256": trust_sha,
                            "mode": "0644",
                            "logical_owner": "bootstrap-release-trust",
                            "reason": "Canonical public Ed25519 release trust anchor",
                        }
                    ],
                }
            ],
        }
        minimal_path = root / "docs/contracts/minimal-bootstrap.json"
        write_json(minimal_path, minimal)

        portable = {
            "$schema": "prototype-ordax.portable-usb-v2/1",
            "product_scope": "mvp-usb-durable-storage-target",
            "physical_write_authorized": False,
            "physical_device_paths_allowed": False,
            "logical_sector_bytes": 512,
            "alignment_bytes": 1048576,
            "partitions": [
                {
                    "index": 1,
                    "name": "ORDAX-ESP",
                    "filesystem": "fat32",
                    "filesystem_label": "ORDAX-ESP",
                    "start_lba": 2048,
                    "size_bytes": 536870912,
                },
                {
                    "index": 2,
                    "name": "ORDAX-DATA",
                    "filesystem": "exfat",
                    "filesystem_label": "ORDAX-DATA",
                    "size_policy": "fill-all-remaining-usable-capacity",
                    "windows_visible": True,
                    "direct_overlayfs_upper": False,
                },
            ],
            "ordax_internal_layout": {
                "persistent_state_image": {
                    "path": ".ordax/state/persistent-state.img",
                    "filesystem": "ext4",
                    "filesystem_label": "ORDAX-STATE",
                    "mounted_through_loop_device_in_runtime": True,
                    "overlayfs_upper_owner": True,
                },
                "activation_state": {"not_stored_directly_on_exfat": True},
            },
        }
        portable_path = root / "docs/contracts/portable-usb-v2.json"
        write_json(portable_path, portable)

        creator_portable = {
            "$schema": "prototype-ordax.creator-portable-media-plan/1",
            "product_scope": "stable-mvp-usb-only",
            "artifact_count": 17,
            "partitions": ["ORDAX-ESP", "ORDAX-DATA"],
            "physical_write_authorized": False,
            "physical_device_paths_allowed": False,
            "disposable_materializer_implemented": True,
            "disposable_materializer_physical_device_allowed": False,
            "disposable_materializer_readback_verification": True,
            "physical_writer_v2_implemented": True,
            "application_planner": {
                "implemented": True,
                "consumes_exact_media_plan": True,
                "canonical_media_plan_sha256_bound": True,
                "host_neutral": True,
                "physical_device_bound": False,
                "physical_write_authorized": False,
                "public_promotion_allowed": False,
                "whole_disk_raw_image_required": False,
                "ordered_phases": [
                    "write-exact-two-partition-gpt",
                    "format-ORDAX-ESP-fat32",
                    "format-ORDAX-DATA-exfat",
                    "materialize-17-exact-artifacts",
                    "flush-and-sync",
                    "readback-sha256-and-size-for-17-artifacts",
                    "verify-gpt-filesystems-labels-and-capacity",
                ],
            },
            "surface_runtime_preseed": {
                "implemented": True,
                "image_artifact_id": "surface-runtime-image",
                "reference_artifact_id": "surface-runtime-ref",
                "content_addressed": True,
                "release_manifest_schema": "prototype-ordax.release-manifest/4",
                "physical_write_authorized": False,
            },
            "local_ai_runtime_preseed": {
                "implemented": True,
                "image_artifact_id": "local-ai-runtime-image",
                "reference_artifact_id": "local-ai-runtime-ref",
                "image_target": "/.ordax/ai-runtimes/sha256/<runtime-sha256>/local-ai-runtime.erofs",
                "reference_target": "/.ordax/releases/<source_commit>/local-ai-runtime.sha256",
                "content_addressed": True,
                "release_manifest_schema": "prototype-ordax.release-manifest/4",
                "physical_write_authorized": False,
            },
            "physical_writer_v2": {
                "exact_operation_count": 39,
                "exact_artifact_count": 17,
                "readback_sha256_and_size_per_artifact": True,
                "physical_write_authorized": False,
            },
        }
        creator_path = root / "docs/contracts/creator-portable-media-plan.json"
        write_json(creator_path, creator_portable)

        policy = {
            "$schema": "prototype-ordax.release-trust-policy/1",
            "consumer_creator": {
                "generates_publisher_private_keys": False,
                "stores_publisher_private_keys": False,
                "requests_private_key_backup_from_end_user": False,
                "runs_release_trust_ceremony": False,
                "signature_verification_is_automatic": True,
            },
            "gates": {
                "key_material_generated": True,
                "public_anchor_pinned": True,
                "minimal_bootstrap_resolved": True,
                "physical_authorization_eligible": True,
            },
        }
        write_json(root / "docs/contracts/release-trust-policy.json", policy)

        for source in promotion.authorization_context_files(ROOT):
            destination = root / source.relative_to(ROOT)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
        authorization_context_sha, _ = promotion.authorization_context_sha256(root)

        auth = {
            "$schema": "prototype-ordax.physical-write-authorization/3",
            "status": "authorized",
            "physical_write_allowed": True,
            "explicit_owner_authorization": True,
            "source_repository": "ordaxsystems/ordax-os",
            "scope": "first-real-stable-mvp-usb-proof",
            "release_sequence": 1,
            "authorization_context_sha256": authorization_context_sha,
            "requirements": {
                name: True
                for name in promotion.REQUIRED_AUTHORIZATION_REQUIREMENTS
            },
            "bindings": {
                "minimal_bootstrap_sha256": sha256(minimal_path),
                "release_trust_sha256": trust_sha,
                "portable_usb_contract_sha256": sha256(portable_path),
                "creator_portable_media_contract_sha256": sha256(creator_path),
                "canonical_v4_release_proof_sha256": proof_sha,
            },
            "release_binding": {
                "proof_path": "docs/evidence/canonical-v4-release-proof.json",
                "proof_schema": "prototype-ordax.portable-v4-canonical-release-proof/1",
                "source_commit": proof["source_commit"],
                "canonical_envelope_url": proof["canonical_envelope_url"],
                "release_manifest_sha256": proof["release_manifest_sha256"],
                "release_envelope_sha256": proof["release_envelope_sha256"],
            },
        }
        write_json(root / "docs/contracts/physical-write-authorization.json", auth)

    def test_authorized_candidate_materialization_is_canonical_main_push_only(self):
        workflow = PHYSICAL_PROMOTION_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn(
            "if: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.preflight.outputs.ready == 'true' }}",
            workflow,
        )
        self.assertNotIn(
            "if: ${{ needs.preflight.outputs.ready == 'true' }}",
            workflow,
        )

    def test_portable_writer_uses_canonical_release_commit_and_exact_17_sources(self):
        source = PHYSICAL_TEST_SOURCE.read_text(encoding="utf-8")
        workflow = PHYSICAL_PROMOTION_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn('buildReleaseSourceCommit', source)
        self.assertIn('json:"release_source_commit"', source)
        self.assertEqual(
            source.count("plan.SourceCommit != b.ReleaseSourceCommit"),
            2,
        )
        self.assertNotIn("plan.SourceCommit != b.SourceCommit", source)
        self.assertIn("exactly 17 canonical artifact sources", source)
        self.assertIn("repeat exactly 17 times", source)
        self.assertIn("exactly 17 --source values", source)
        self.assertNotIn("exactly 15 canonical artifact sources", source)
        self.assertNotIn("repeat exactly 15 times", source)
        self.assertIn("release_source_commit=", workflow)
        self.assertIn("-X main.buildReleaseSourceCommit=$release_source_commit", workflow)
        self.assertIn(
            "'canonical_v4_release_source_commit': auth['release_binding']['source_commit']",
            workflow,
        )
        self.assertIn("'writer_source_commit': os.environ['GITHUB_SHA']", workflow)

    def test_current_repo_authorization_owner_correct_but_still_fail_closed(self):
        # Repository transfer does not transfer an old destructive grant.
        auth = json.loads((ROOT / "docs/contracts/physical-write-authorization.json").read_text(encoding="utf-8"))
        self.assertEqual(auth["source_repository"], promotion.REPOSITORY)
        self.assertFalse(auth["physical_write_allowed"])
        self.assertFalse(auth["explicit_owner_authorization"])
        self.assertIsNone(auth["authorization_context_sha256"])
        self.assertFalse(auth["requirements"]["canonical_v4_release_proof_bound"])

    def test_pending_owner_authorization_fixture_remains_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_ready_fixture(root)
            auth_path = self._set_pending_owner_authorization(root)
            auth = json.loads(auth_path.read_text(encoding="utf-8"))

            self.assertEqual(
                auth["status"],
                "blocked-explicit-physical-authorization-pending",
            )
            self.assertFalse(auth["physical_write_allowed"])
            self.assertFalse(auth["explicit_owner_authorization"])
            self.assertIsNone(auth["authorization_context_sha256"])
            self.assertEqual(auth["scope"], "first-real-stable-mvp-usb-proof")
            self.assertEqual(auth["release_sequence"], 1)
            self.assertTrue(
                auth["requirements"]["writer_requires_exact_17_artifact_readback"]
            )
            self.assertNotIn(
                "writer_requires_exact_15_artifact_readback",
                auth["requirements"],
            )

            status = promotion.evaluate(root)
            self.assertFalse(status["ready"])
            self.assertTrue(status["pre_authorization_ready"])
            self.assertTrue(status["canonical_v4_release_proof_valid"])
            self.assertTrue(status["canonical_v4_release_binding_resolved"])
            self.assertTrue(status["physical_authorization_bindings_resolved"])
            self.assertEqual(status["pre_authorization_blockers"], [])
            self.assertEqual(
                status["authorization_blockers"],
                ["explicit-physical-write-authorization-missing"],
            )
            self.assertTrue(status["owner_authorization_required"])
            self.assertFalse(status["authorized_candidate_materialization_allowed"])
            for forbidden in ("physical_path", "device_path", "disk_number", "volume_id"):
                self.assertNotIn(forbidden, auth)

    def _set_pending_owner_authorization(self, root: Path) -> Path:
        auth_path = root / "docs/contracts/physical-write-authorization.json"
        auth = json.loads(auth_path.read_text(encoding="utf-8"))
        auth["status"] = "blocked-explicit-physical-authorization-pending"
        auth["physical_write_allowed"] = False
        auth["explicit_owner_authorization"] = False
        auth["authorization_context_sha256"] = None
        write_json(auth_path, auth)
        return auth_path

    def test_owner_authorization_check_is_read_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_ready_fixture(root)
            auth_path = self._set_pending_owner_authorization(root)
            before = auth_path.read_bytes()

            plan = authorization.prepare_authorization(root)

            self.assertTrue(plan["ready"])
            self.assertEqual(plan["scope"], "first-real-stable-mvp-usb-proof")
            self.assertEqual(plan["release_sequence"], 1)
            self.assertEqual(
                plan["confirmation"],
                "AUTHORIZE_FIRST_REAL_STABLE_MVP_USB_PROOF",
            )
            self.assertFalse(plan["physical_device_touched"])
            self.assertFalse(plan["writer_invoked"])
            self.assertFalse(plan["candidate_materialized"])
            self.assertRegex(plan["authorization_context_sha256"], r"^[0-9a-f]{64}$")
            self.assertGreater(plan["authorization_context_file_count"], 10)
            self.assertEqual(auth_path.read_bytes(), before)

            status = promotion.evaluate(root)
            self.assertFalse(status["ready"])
            self.assertTrue(status["pre_authorization_ready"])
            self.assertTrue(status["physical_authorization_bindings_resolved"])
            self.assertTrue(status["owner_authorization_required"])

    def test_owner_authorization_apply_requires_exact_three_part_confirmation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_ready_fixture(root)
            auth_path = self._set_pending_owner_authorization(root)
            before = auth_path.read_bytes()

            with self.assertRaises(authorization.AuthorizationError):
                authorization.apply_authorization(
                    root,
                    confirm_scope="wrong-scope",
                    confirm_release_sequence=1,
                    confirmation=authorization.CONFIRMATION,
                )
            self.assertEqual(auth_path.read_bytes(), before)

            with self.assertRaises(authorization.AuthorizationError):
                authorization.apply_authorization(
                    root,
                    confirm_scope=authorization.EXPECTED_SCOPE,
                    confirm_release_sequence=2,
                    confirmation=authorization.CONFIRMATION,
                )
            self.assertEqual(auth_path.read_bytes(), before)

            with self.assertRaises(authorization.AuthorizationError):
                authorization.apply_authorization(
                    root,
                    confirm_scope=authorization.EXPECTED_SCOPE,
                    confirm_release_sequence=1,
                    confirmation="AUTHORIZE",
                )
            self.assertEqual(auth_path.read_bytes(), before)

            result = authorization.apply_authorization(
                root,
                confirm_scope=authorization.EXPECTED_SCOPE,
                confirm_release_sequence=1,
                confirmation=authorization.CONFIRMATION,
            )
            self.assertEqual(result["status"], "owner-authorization-recorded")
            self.assertFalse(result["physical_device_touched"])
            self.assertFalse(result["writer_invoked"])
            self.assertFalse(result["candidate_materialized"])

            contract = json.loads(auth_path.read_text(encoding="utf-8"))
            self.assertEqual(contract["status"], "authorized")
            self.assertTrue(contract["physical_write_allowed"])
            self.assertTrue(contract["explicit_owner_authorization"])
            self.assertEqual(
                contract["authorization_context_sha256"],
                result["authorization_context_sha256"],
            )

            status = promotion.evaluate(root)
            self.assertTrue(status["ready"], status["blockers"])
            self.assertTrue(status["authorized_candidate_materialization_allowed"])
            self.assertEqual(
                status["next_stage"],
                "authorized-candidate-materialization",
            )

    def test_owner_authorization_check_reports_real_pretrust_blockers(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_ready_fixture(root)
            auth_path = root / "docs/contracts/physical-write-authorization.json"
            auth = json.loads(auth_path.read_text(encoding="utf-8"))
            auth["status"] = "blocked-canonical-trust-pending"
            auth["physical_write_allowed"] = False
            auth["explicit_owner_authorization"] = False
            auth["authorization_context_sha256"] = None
            auth["bindings"] = {
                "minimal_bootstrap_sha256": None,
                "release_trust_sha256": None,
                "portable_usb_contract_sha256": None,
                "creator_portable_media_contract_sha256": None,
                "canonical_v4_release_proof_sha256": None,
            }
            write_json(auth_path, auth)
            (root / "bootstrap/trust/release-ed25519.json").unlink()

            with self.assertRaisesRegex(
                authorization.AuthorizationError,
                "prerequisites are not ready",
            ) as raised:
                authorization.prepare_authorization(root)

            self.assertIn(
                "canonical-public-trust-missing-or-invalid",
                str(raised.exception),
            )
            self.assertFalse(
                json.loads(auth_path.read_text(encoding="utf-8"))[
                    "explicit_owner_authorization"
                ]
            )

    def test_missing_canonical_v4_release_proof_blocks_pre_authorization(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_ready_fixture(root)
            (root / "docs/evidence/canonical-v4-release-proof.json").unlink()

            status = promotion.evaluate(root)

            self.assertFalse(status["ready"])
            self.assertFalse(status["pre_authorization_ready"])
            self.assertFalse(status["canonical_v4_release_proof_valid"])
            self.assertIn(
                "canonical-v4-release-proof-missing-or-invalid",
                status["pre_authorization_blockers"],
            )
            self.assertFalse(status["authorized_candidate_materialization_allowed"])

    def test_ready_promotion_uses_only_portable_layout_authority(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_ready_fixture(root)
            status = promotion.evaluate(root)
            self.assertTrue(status["ready"], status["blockers"])
            self.assertTrue(status["pre_authorization_ready"])
            self.assertEqual(status["pre_authorization_blockers"], [])
            self.assertEqual(status["authorization_blockers"], [])
            self.assertFalse(status["owner_authorization_required"])
            self.assertTrue(status["authorized_candidate_materialization_allowed"])
            self.assertTrue(status["physical_authorization_bindings_resolved"])
            self.assertTrue(status["canonical_v4_release_proof_valid"])
            self.assertTrue(status["canonical_v4_release_binding_resolved"])
            self.assertEqual(status["canonical_v4_release_source_commit"], "a" * 40)
            self.assertEqual(
                status["canonical_v4_release_envelope_url"],
                "https://releases.ordax.example/stable-v4/release-envelope.json",
            )
            self.assertTrue(status["authorization_context_matches_current_source"])
            self.assertRegex(
                status["computed_authorization_context_sha256"],
                r"^[0-9a-f]{64}$",
            )
            self.assertGreater(status["authorization_context_file_count"], 10)
            self.assertEqual(status["next_stage"], "authorized-candidate-materialization")
            self.assertEqual(
                status["portable_layout_authority"],
                "tools/creator/core/portable_media.go",
            )
            self.assertFalse(status["legacy_physical_media_contract_authoritative"])
            self.assertEqual(
                set(status["computed_bindings"]),
                {
                    "minimal_bootstrap_sha256",
                    "release_trust_sha256",
                    "portable_usb_contract_sha256",
                    "creator_portable_media_contract_sha256",
                    "canonical_v4_release_proof_sha256",
                },
            )

    def test_resolved_bindings_leave_only_explicit_authorization_blocked(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_ready_fixture(root)
            auth_path = root / "docs/contracts/physical-write-authorization.json"
            auth = json.loads(auth_path.read_text(encoding="utf-8"))
            auth["status"] = "blocked-explicit-physical-authorization-pending"
            auth["physical_write_allowed"] = False
            auth["explicit_owner_authorization"] = False
            auth["authorization_context_sha256"] = None
            write_json(auth_path, auth)

            status = promotion.evaluate(root)

            self.assertFalse(status["ready"])
            self.assertTrue(status["pre_authorization_ready"], status["pre_authorization_blockers"])
            self.assertTrue(status["physical_authorization_bindings_resolved"])
            self.assertEqual(
                status["authorization_blockers"],
                ["explicit-physical-write-authorization-missing"],
            )
            self.assertTrue(status["owner_authorization_required"])
            self.assertEqual(status["next_stage"], "explicit-owner-authorization")
            self.assertFalse(status["authorized_candidate_materialization_allowed"])

    def test_pre_authorization_ready_does_not_authorize_destructive_candidate(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_ready_fixture(root)
            auth_path = root / "docs/contracts/physical-write-authorization.json"
            auth = json.loads(auth_path.read_text(encoding="utf-8"))
            auth["status"] = "eligible-awaiting-explicit-authorization"
            auth["physical_write_allowed"] = False
            auth["explicit_owner_authorization"] = False
            auth["authorization_context_sha256"] = None
            auth["bindings"] = {
                "minimal_bootstrap_sha256": None,
                "release_trust_sha256": None,
                "portable_usb_contract_sha256": None,
                "creator_portable_media_contract_sha256": None,
            }
            write_json(auth_path, auth)

            status = promotion.evaluate(root)

            self.assertFalse(status["ready"])
            self.assertTrue(status["pre_authorization_ready"], status["pre_authorization_blockers"])
            self.assertEqual(status["pre_authorization_blockers"], [])
            self.assertEqual(
                status["authorization_blockers"],
                [
                    "explicit-physical-write-authorization-missing",
                    "physical-authorization-bindings-unresolved",
                ],
            )
            self.assertTrue(status["owner_authorization_required"])
            self.assertFalse(status["authorized_candidate_materialization_allowed"])
            self.assertEqual(status["next_stage"], "explicit-owner-authorization")

    def test_authorization_context_is_stable_across_lf_and_crlf_checkouts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_ready_fixture(root)
            before, count_before = promotion.authorization_context_sha256(root)

            source = root / "tools/creator/physical_promotion.py"
            payload = source.read_bytes()
            self.assertNotIn(b"\r", payload)
            source.write_bytes(payload.replace(b"\n", b"\r\n"))

            after, count_after = promotion.authorization_context_sha256(root)

            self.assertEqual(after, before)
            self.assertEqual(count_after, count_before)

    def test_authorization_pre_replace_failure_does_not_attempt_rollback(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_ready_fixture(root)
            auth_path = self._set_pending_owner_authorization(root)
            before = auth_path.read_bytes()

            with mock.patch.object(
                authorization,
                "_atomic_replace",
                side_effect=authorization.AuthorizationError(
                    "simulated pre-replace failure"
                ),
            ) as replace:
                with self.assertRaisesRegex(
                    authorization.AuthorizationError,
                    "simulated pre-replace failure",
                ):
                    authorization.apply_authorization(
                        root,
                        confirm_scope=authorization.EXPECTED_SCOPE,
                        confirm_release_sequence=1,
                        confirmation=authorization.CONFIRMATION,
                    )

            self.assertEqual(replace.call_count, 1)
            self.assertEqual(auth_path.read_bytes(), before)

    def test_authorization_context_invalidates_consent_after_module_change(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_ready_fixture(root)
            module = root / "tools/creator/go.mod"
            module.write_text(
                module.read_text(encoding="utf-8") + "\n// changed after owner consent\n",
                encoding="utf-8",
            )

            status = promotion.evaluate(root)

            self.assertFalse(status["ready"])
            self.assertFalse(status["authorization_context_matches_current_source"])
            self.assertIn(
                "physical-authorization-context-mismatch",
                status["authorization_blockers"],
            )

    def test_authorization_context_invalidates_consent_after_writer_source_change(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_ready_fixture(root)
            writer = root / "tools/creator/host/windows/portable_apply_windows.go"
            writer.write_text(
                writer.read_text(encoding="utf-8") + "\n// changed after owner consent\n",
                encoding="utf-8",
            )

            status = promotion.evaluate(root)

            self.assertFalse(status["ready"])
            self.assertFalse(status["authorization_context_matches_current_source"])
            self.assertIn(
                "physical-authorization-context-mismatch",
                status["authorization_blockers"],
            )
            self.assertFalse(status["authorized_candidate_materialization_allowed"])

    def test_legacy_ordax_ext4_contract_cannot_satisfy_portable_gate(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_ready_fixture(root)
            portable_path = root / "docs/contracts/portable-usb-v2.json"
            auth_path = root / "docs/contracts/physical-write-authorization.json"
            portable = json.loads(portable_path.read_text(encoding="utf-8"))
            portable["partitions"][1] = {
                "index": 2,
                "name": "ORDAX",
                "filesystem": "ext4",
                "filesystem_label": "ORDAX",
                "size_policy": "fill-all-remaining-usable-capacity",
                "windows_visible": False,
                "direct_overlayfs_upper": True,
            }
            write_json(portable_path, portable)
            auth = json.loads(auth_path.read_text(encoding="utf-8"))
            auth["bindings"]["portable_usb_contract_sha256"] = sha256(portable_path)
            write_json(auth_path, auth)
            status = promotion.evaluate(root)
            self.assertFalse(status["ready"])
            self.assertFalse(status["pre_authorization_ready"])
            self.assertIn("portable-usb-contract-invalid", status["pre_authorization_blockers"])
            self.assertIn("portable-usb-contract-invalid", status["blockers"])

    def test_portable_writer_must_be_implemented_before_authorization(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_ready_fixture(root)
            creator_path = root / "docs/contracts/creator-portable-media-plan.json"
            auth_path = root / "docs/contracts/physical-write-authorization.json"
            creator = json.loads(creator_path.read_text(encoding="utf-8"))
            creator["physical_writer_v2_implemented"] = False
            write_json(creator_path, creator)
            auth = json.loads(auth_path.read_text(encoding="utf-8"))
            auth["bindings"]["creator_portable_media_contract_sha256"] = sha256(creator_path)
            write_json(auth_path, auth)
            status = promotion.evaluate(root)
            self.assertFalse(status["ready"])
            self.assertIn("portable-physical-writer-not-implemented", status["blockers"])

    def test_trust_policy_rejects_duplicate_destructive_authority(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_ready_fixture(root)
            policy_path = root / "docs/contracts/release-trust-policy.json"
            policy = json.loads(policy_path.read_text(encoding="utf-8"))
            policy["gates"]["physical_write_allowed"] = False
            write_json(policy_path, policy)
            status = promotion.evaluate(root)
            self.assertFalse(status["ready"])
            self.assertIn(
                "release-trust-policy-gates-not-authorized",
                status["blockers"],
            )

    def test_payload_level_destructive_flag_is_rejected_even_with_valid_bindings(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_ready_fixture(root)
            minimal_path = root / "docs/contracts/minimal-bootstrap.json"
            auth_path = root / "docs/contracts/physical-write-authorization.json"
            minimal = json.loads(minimal_path.read_text(encoding="utf-8"))
            minimal["physical_write_allowed"] = True
            write_json(minimal_path, minimal)
            auth = json.loads(auth_path.read_text(encoding="utf-8"))
            auth["bindings"]["minimal_bootstrap_sha256"] = sha256(minimal_path)
            write_json(auth_path, auth)
            status = promotion.evaluate(root)
            self.assertFalse(status["ready"])
            self.assertIn(
                "minimal-bootstrap-must-remain-non-destructive",
                status["blockers"],
            )


if __name__ == "__main__":
    unittest.main()
