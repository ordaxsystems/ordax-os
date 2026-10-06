import importlib.util
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
WORK_COORDINATION_CONTRACT = ROOT / "system" / "contracts" / "work-coordination.mjs"
sys.path.insert(0, str(RUNTIME))
MODULE = RUNTIME / "native_work_coordination_state.py"
spec = importlib.util.spec_from_file_location("native_work_coordination_state", MODULE)
state_owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(state_owner)


def coordination_state(
    owner_kind="account",
    owner_id="user-1",
    project_id="project-1",
    *,
    authority="none",
    format_version=1,
):
    return {
        "schema": "ordax.work-coordination-store-state/1",
        "formatVersion": format_version,
        "ownerKind": owner_kind,
        "ownerId": None if owner_kind == "device" else owner_id,
        "projectId": project_id,
        "plans": [{
            "schema": "ordax.work-plan/1",
            "revision": 1,
            "id": "plan-1",
            "ownerKind": owner_kind,
            "ownerId": None if owner_kind == "device" else owner_id,
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


def work_task(
    task_id,
    plan_id="plan-1",
    *,
    revision=1,
    state="planned",
    depends_on=None,
    evidence_requirements=None,
):
    return {
        "schema": "ordax.work-task/1",
        "revision": revision,
        "id": task_id,
        "planId": plan_id,
        "title": f"Task {task_id}",
        "objective": "Objetivo",
        "state": state,
        "dependsOnTaskIds": list(depends_on or []),
        "evidenceRequirements": list(evidence_requirements or []),
        "blockedReason": None,
        "authority": "none",
        "createdAt": "2026-10-06T12:00:00.000Z",
        "updatedAt": "2026-10-06T12:00:00.000Z",
        "completedAt": "2026-10-06T12:01:00.000Z" if state == "completed" else None,
    }


def payload(**kwargs):
    return json.dumps(coordination_state(**kwargs), separators=(",", ":"), ensure_ascii=False)


def raw_payload(state):
    return json.dumps(state, separators=(",", ":"), ensure_ascii=False)


def canonical_forbidden_authority_fields():
    source = WORK_COORDINATION_CONTRACT.read_text(encoding="utf-8")
    match = re.search(
        r"const FORBIDDEN_AUTHORITY_FIELDS = new Set\(\[(.*?)\]\);",
        source,
        flags=re.DOTALL,
    )
    if match is None:
        raise AssertionError("canonical Work Coordination authority field set was not found")
    return frozenset(re.findall(r'"([^"]+)"', match.group(1)))


class NativeWorkCoordinationStateTests(unittest.TestCase):
    def test_account_project_partition_is_private_atomic_and_opaque(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "work-coordination")
            record = state_owner.compare_and_swap_work_coordination_payload(
                "account", "private-user@example.test", "secret-project", 0,
                payload(owner_id="private-user@example.test", project_id="secret-project"), root,
            )
            self.assertEqual(record["revision"], 1)
            restored = state_owner.read_work_coordination_record(
                "account", "private-user@example.test", "secret-project", root,
            )
            self.assertEqual(restored["revision"], 1)
            self.assertEqual(restored["ownerId"], "private-user@example.test")
            self.assertEqual(restored["projectId"], "secret-project")
            names = [path.name for path in Path(root).iterdir()]
            self.assertTrue(any(name.startswith("partition-") and name.endswith(".json") for name in names))
            joined = " ".join(names)
            self.assertNotIn("private-user", joined)
            self.assertNotIn("secret-project", joined)

    def test_stale_revision_is_rejected_without_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "work-coordination")
            first = state_owner.compare_and_swap_work_coordination_payload(
                "account", "user-1", "project-1", 0, payload(), root,
            )
            self.assertEqual(first["revision"], 1)
            stale = state_owner.compare_and_swap_work_coordination_payload(
                "account", "user-1", "project-1", 0, payload(), root,
            )
            self.assertIsNone(stale)
            restored = state_owner.read_work_coordination_record(
                "account", "user-1", "project-1", root,
            )
            self.assertEqual(restored["revision"], 1)

    def test_projects_are_isolated_inside_the_same_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "work-coordination")
            state_owner.compare_and_swap_work_coordination_payload(
                "account", "user-1", "project-a", 0,
                payload(project_id="project-a"), root,
            )
            self.assertIsNone(state_owner.read_work_coordination_record(
                "account", "user-1", "project-b", root,
            ))

    def test_partition_binding_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "work-coordination")
            with self.assertRaisesRegex(ValueError, "partition binding mismatch"):
                state_owner.compare_and_swap_work_coordination_payload(
                    "account", "user-1", "project-1", 0,
                    payload(project_id="project-2"), root,
                )

    def test_authority_smuggling_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "work-coordination")
            with self.assertRaisesRegex(ValueError, "authority must remain none"):
                state_owner.compare_and_swap_work_coordination_payload(
                    "account", "user-1", "project-1", 0,
                    payload(authority="user-grant"), root,
                )

    def test_forbidden_authority_fields_match_contract_and_fail_closed(self):
        contract_fields = canonical_forbidden_authority_fields()
        self.assertEqual(contract_fields, state_owner._FORBIDDEN_AUTHORITY_FIELDS)

        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "work-coordination")
            for field in sorted(contract_fields):
                state = coordination_state()
                state["plans"][0][field] = (
                    True if field == "executionAuthorized" else f"forbidden-{field}"
                )
                raw = raw_payload(state)
                with self.subTest(field=field):
                    with self.assertRaisesRegex(ValueError, "authority field"):
                        state_owner.compare_and_swap_work_coordination_payload(
                            "account", "user-1", "project-1", 0, raw, root,
                        )
                    self.assertIsNone(state_owner.read_work_coordination_record(
                        "account", "user-1", "project-1", root,
                    ))

    def test_unknown_format_version_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "work-coordination")
            with self.assertRaisesRegex(ValueError, "format version is incompatible"):
                state_owner.compare_and_swap_work_coordination_payload(
                    "account", "user-1", "project-1", 0,
                    payload(format_version=2), root,
                )

    def test_collection_bounds_are_enforced(self):
        state = coordination_state()
        state["claims"] = [{} for _ in range(state_owner.MAX_CLAIMS + 1)]
        raw = raw_payload(state)
        with self.assertRaisesRegex(ValueError, "claims is invalid or unbounded"):
            state_owner.validate_work_coordination_payload(
                raw, "account", "user-1", "project-1",
            )

    def test_host_rejects_task_referencing_missing_plan(self):
        state = coordination_state()
        state["tasks"] = [work_task("task-1", plan_id="missing-plan")]
        with self.assertRaisesRegex(ValueError, "missing plan"):
            state_owner.validate_work_coordination_payload(
                raw_payload(state), "account", "user-1", "project-1",
            )

    def test_host_rejects_plan_task_retention_mismatch(self):
        state = coordination_state()
        state["plans"][0]["taskIds"] = ["task-1"]
        state["tasks"] = [work_task("task-1", plan_id="plan-2")]
        with self.assertRaisesRegex(ValueError, "missing plan|retained by its own plan"):
            state_owner.validate_work_coordination_payload(
                raw_payload(state), "account", "user-1", "project-1",
            )

    def test_host_rejects_dependency_cycle_before_persistence(self):
        state = coordination_state()
        state["plans"][0]["taskIds"] = ["task-1", "task-2"]
        state["tasks"] = [
            work_task("task-1", depends_on=["task-2"]),
            work_task("task-2", depends_on=["task-1"]),
        ]
        with self.assertRaisesRegex(ValueError, "dependency graph contains a cycle"):
            state_owner.validate_work_coordination_payload(
                raw_payload(state), "account", "user-1", "project-1",
            )

    def test_host_rejects_stale_claim_binding(self):
        state = coordination_state()
        state["plans"][0]["taskIds"] = ["task-1"]
        state["tasks"] = [work_task("task-1", revision=2, state="in-progress")]
        state["claims"] = [{
            "schema": "ordax.work-claim/1",
            "id": "claim-1",
            "planId": "plan-1",
            "taskId": "task-1",
            "planRevision": 1,
            "taskRevision": 1,
            "workerKind": "ai-client",
            "workerRef": "worker-1",
            "clientRef": "client-1",
            "sessionRef": "session-1",
            "leaseId": "lease-1",
            "acquiredAt": "2026-10-06T12:00:00.000Z",
            "heartbeatAt": "2026-10-06T12:00:00.000Z",
            "expiresAt": "2026-10-06T12:10:00.000Z",
            "authority": "none",
        }]
        with self.assertRaisesRegex(ValueError, "task revision is stale"):
            state_owner.validate_work_coordination_payload(
                raw_payload(state), "account", "user-1", "project-1",
            )

    def test_completed_task_requires_verified_evidence_on_host(self):
        state = coordination_state()
        state["plans"][0]["taskIds"] = ["task-1"]
        state["tasks"] = [
            work_task(
                "task-1",
                state="completed",
                evidence_requirements=["commit"],
            )
        ]
        with self.assertRaisesRegex(ValueError, "missing required verified evidence"):
            state_owner.validate_work_coordination_payload(
                raw_payload(state), "account", "user-1", "project-1",
            )


if __name__ == "__main__":
    unittest.main()
