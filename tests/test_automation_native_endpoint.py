import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
sys.path.insert(0, str(RUNTIME))
MODULE = RUNTIME / "native_automation_endpoint.py"
spec = importlib.util.spec_from_file_location("native_automation_endpoint", MODULE)
endpoint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(endpoint)


def run(revision=1):
    return {
        "schema": "ordax.background-run/1", "revision": revision, "runId": "run-1",
        "consumerId": "personal-ordax", "subjectId": "work-1", "ownerKind": "device", "ownerId": None,
        "spaceId": None, "projectId": None, "state": "queued",
        "budgets": {"wallClockMs": 120000, "stepLimit": 4, "actionLimit": 0, "egressBytesLimit": 0},
        "usage": {"steps": 0, "actions": 0, "egressBytes": 0},
        "createdAt": "2026-10-03T15:00:00.000Z", "startedAt": None,
        "deadlineAt": "2026-10-03T15:02:00.000Z", "lease": None, "checkpoint": None,
        "cancelRequestedAt": None, "finishedAt": None, "failureCode": None, "authority": "none",
    }


def body(value):
    return json.dumps(value, separators=(",", ":")).encode("utf-8")


class NativeAutomationEndpointTests(unittest.TestCase):
    def test_typed_create_and_cas_conflict(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "automation.json")
            self.assertEqual(endpoint.mutate_automation_endpoint(body({"action": "background-create", "run": run()}), path), {"ok": True})
            next_run = run(2)
            self.assertEqual(endpoint.mutate_automation_endpoint(body({"action": "background-cas", "runId": "run-1", "expectedRevision": 1, "run": next_run}), path), {"ok": True})
            with self.assertRaises(endpoint.AutomationEndpointRequestError) as error:
                endpoint.mutate_automation_endpoint(body({"action": "background-cas", "runId": "run-1", "expectedRevision": 1, "run": next_run}), path)
            self.assertEqual(error.exception.status_code, 409)

    def test_unknown_raw_replace_and_oversize_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "automation.json")
            with self.assertRaises(endpoint.AutomationEndpointRequestError):
                endpoint.mutate_automation_endpoint(body({"action": "replace-state", "state": {}}), path)
            with self.assertRaises(endpoint.AutomationEndpointRequestError) as error:
                endpoint.mutate_automation_endpoint(b"x" * (endpoint.MAX_AUTOMATION_REQUEST_BODY_BYTES + 1), path)
            self.assertEqual(error.exception.status_code, 413)

    def test_endpoint_delegates_file_durability_to_state_owner(self):
        source = MODULE.read_text(encoding="utf-8")
        self.assertNotIn("os.replace", source)
        self.assertNotIn("fcntl.flock", source)
        self.assertIn("create_background_run", source)
        self.assertIn("commit_schedule_occurrence", source)


if __name__ == "__main__":
    unittest.main()
