import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
sys.path.insert(0, str(RUNTIME))
MODULE = RUNTIME / "native_work_coordination_endpoint.py"
spec = importlib.util.spec_from_file_location("native_work_coordination_endpoint", MODULE)
endpoint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(endpoint)


def state(owner_id="user-1", project_id="project-1", authority="none"):
    return {
        "schema": "ordax.work-coordination-store-state/1",
        "formatVersion": 1,
        "ownerKind": "account",
        "ownerId": owner_id,
        "projectId": project_id,
        "plans": [{
            "schema": "ordax.work-plan/1",
            "revision": 1,
            "id": "plan-1",
            "ownerKind": "account",
            "ownerId": owner_id,
            "spaceId": None,
            "projectId": project_id,
            "workItemId": None,
            "title": "Plano",
            "objective": "Objetivo",
            "state": "active",
            "taskIds": [],
            "authority": authority,
            "createdAt": "2026-10-06T12:00:00.000Z",
            "updatedAt": "2026-10-06T12:00:00.000Z",
        }],
        "tasks": [],
        "claims": [],
        "checkpoints": [],
        "evidence": [],
    }


def request_body(owner_id="user-1", project_id="project-1", expected_revision=0, **state_kwargs):
    return json.dumps({
        "action": "compare-and-swap",
        "ownerKind": "account",
        "ownerId": owner_id,
        "projectId": project_id,
        "expectedRevision": expected_revision,
        "payload": json.dumps(
            state(owner_id=owner_id, project_id=project_id, **state_kwargs),
            separators=(",", ":"),
        ),
    }, separators=(",", ":")).encode("utf-8")


class WorkCoordinationNativeEndpointTests(unittest.TestCase):
    def test_mutation_uses_authoritative_owner_and_project(self):
        with tempfile.TemporaryDirectory() as directory:
            result = endpoint.mutate_work_coordination_endpoint(
                request_body(),
                "account",
                "user-1",
                "project-1",
                directory,
            )
            self.assertEqual(result, {"ok": True, "revision": 1})
            restored = endpoint.read_work_coordination_endpoint(
                "account", "user-1", "project-1", directory,
            )
            self.assertEqual(restored["record"]["revision"], 1)

    def test_authoritative_selected_project_context_is_required(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(endpoint.WorkCoordinationEndpointRequestError) as raised:
                endpoint.read_work_coordination_endpoint(
                    "account", "user-1", None, directory,
                )
            self.assertEqual(raised.exception.status_code, 403)
            self.assertIn("Project context is required", str(raised.exception))

            with self.assertRaises(endpoint.WorkCoordinationEndpointRequestError) as raised:
                endpoint.mutate_work_coordination_endpoint(
                    request_body(),
                    "account", "user-1", None, directory,
                )
            self.assertEqual(raised.exception.status_code, 403)
            self.assertIn("Project context is required", str(raised.exception))

    def test_requested_owner_mismatch_is_forbidden(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(endpoint.WorkCoordinationEndpointRequestError) as raised:
                endpoint.mutate_work_coordination_endpoint(
                    request_body(owner_id="attacker"),
                    "account",
                    "user-1",
                    "project-1",
                    directory,
                )
            self.assertEqual(raised.exception.status_code, 403)

    def test_requested_project_mismatch_is_forbidden(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(endpoint.WorkCoordinationEndpointRequestError) as raised:
                endpoint.mutate_work_coordination_endpoint(
                    request_body(project_id="project-2"),
                    "account",
                    "user-1",
                    "project-1",
                    directory,
                )
            self.assertEqual(raised.exception.status_code, 403)

    def test_stale_revision_is_reported_as_conflict(self):
        with tempfile.TemporaryDirectory() as directory:
            endpoint.mutate_work_coordination_endpoint(
                request_body(), "account", "user-1", "project-1", directory,
            )
            with self.assertRaises(endpoint.WorkCoordinationEndpointRequestError) as raised:
                endpoint.mutate_work_coordination_endpoint(
                    request_body(expected_revision=0),
                    "account",
                    "user-1",
                    "project-1",
                    directory,
                )
            self.assertEqual(raised.exception.status_code, 409)

    def test_shape_is_exact_and_action_is_cas_only(self):
        valid = json.loads(request_body().decode("utf-8"))
        with tempfile.TemporaryDirectory() as directory:
            bad = dict(valid)
            bad["grantRef"] = "grant-1"
            with self.assertRaisesRegex(endpoint.WorkCoordinationEndpointRequestError, "shape is invalid"):
                endpoint.mutate_work_coordination_endpoint(
                    json.dumps(bad).encode("utf-8"),
                    "account", "user-1", "project-1", directory,
                )
            bad = dict(valid)
            bad["action"] = "save"
            with self.assertRaisesRegex(endpoint.WorkCoordinationEndpointRequestError, "action is invalid"):
                endpoint.mutate_work_coordination_endpoint(
                    json.dumps(bad).encode("utf-8"),
                    "account", "user-1", "project-1", directory,
                )

    def test_authority_smuggling_fails_before_persisting(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(endpoint.WorkCoordinationEndpointRequestError, "authority must remain none"):
                endpoint.mutate_work_coordination_endpoint(
                    request_body(authority="user-grant"),
                    "account", "user-1", "project-1", directory,
                )
            restored = endpoint.read_work_coordination_endpoint(
                "account", "user-1", "project-1", directory,
            )
            self.assertIsNone(restored["record"])

    def test_request_body_is_bounded_and_strict_json(self):
        with self.assertRaisesRegex(endpoint.WorkCoordinationEndpointRequestError, "must be bytes"):
            endpoint.mutate_work_coordination_endpoint(
                "{}", "account", "user-1", "project-1",
            )
        with self.assertRaisesRegex(endpoint.WorkCoordinationEndpointRequestError, "invalid JSON"):
            endpoint.mutate_work_coordination_endpoint(
                b"{", "account", "user-1", "project-1",
            )


if __name__ == "__main__":
    unittest.main()
