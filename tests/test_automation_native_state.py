import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "system" / "surface" / "runtime" / "native_automation_state.py"
spec = importlib.util.spec_from_file_location("native_automation_state", MODULE)
automation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(automation)


def run(revision=1, state="queued", authority="none"):
    lease = None
    if state == "running":
        lease = {
            "leaseId": "lease-1", "workerId": "worker-1",
            "acquiredAt": "2026-10-03T15:00:00.000Z",
            "heartbeatAt": "2026-10-03T15:00:01.000Z",
            "expiresAt": "2026-10-03T15:01:00.000Z",
        }
    return {
        "schema": "ordax.background-run/1", "revision": revision, "runId": "run-1",
        "consumerId": "personal-ordax", "subjectId": "work-1", "ownerKind": "account",
        "ownerId": "user-1", "spaceId": "space-1", "projectId": "project-1", "state": state,
        "budgets": {"wallClockMs": 120000, "stepLimit": 4, "actionLimit": 1, "egressBytesLimit": 0},
        "usage": {"steps": 0, "actions": 0, "egressBytes": 0},
        "createdAt": "2026-10-03T15:00:00.000Z", "startedAt": None,
        "deadlineAt": "2026-10-03T15:02:00.000Z", "lease": lease, "checkpoint": None,
        "cancelRequestedAt": None, "finishedAt": None, "failureCode": None, "authority": authority,
    }


def schedule(revision=1, run_count=0, enabled=True):
    return {
        "schema": "ordax.schedule/1", "revision": revision, "scheduleId": "schedule-1",
        "consumerId": "personal-ordax", "subjectId": "work-1", "ownerKind": "account",
        "ownerId": "user-1", "spaceId": "space-1", "projectId": "project-1",
        "timezone": "America/Bahia", "recurrence": {"kind": "fixed-interval", "intervalMs": 60000},
        "nextRunAt": "2026-10-03T15:01:00.000Z" if enabled else None,
        "lastRunAt": None if run_count == 0 else "2026-10-03T15:00:00.000Z",
        "maxRuns": 10, "runCount": run_count, "enabled": enabled,
        "deduplicationKey": "work-1-schedule", "createdAt": "2026-10-03T14:59:00.000Z",
        "authority": "none",
    }


def occurrence():
    return {
        "schema": "ordax.schedule-occurrence/1", "occurrenceId": "occurrence-1",
        "scheduleId": "schedule-1", "consumerId": "personal-ordax", "subjectId": "work-1",
        "sequence": 1, "dueAt": "2026-10-03T15:00:00.000Z",
        "createdAt": "2026-10-03T15:00:00.000Z",
        "deduplicationKey": "work-1-schedule:1:2026-10-03T15:00:00.000Z", "authority": "none",
    }


class NativeAutomationStateTests(unittest.TestCase):
    def test_private_atomic_roundtrip_and_generation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "automation.json")
            self.assertEqual(automation.read_automation_state(path)["generation"], 0)
            self.assertTrue(automation.create_background_run(run(), path))
            state = automation.read_automation_state(path)
            self.assertEqual(state["generation"], 1)
            self.assertEqual(state["backgroundRuns"]["run-1"]["authority"], "none")
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(os.stat(path + ".lock").st_mode), 0o600)

    def test_background_cas_rejects_stale_writer_and_identity_change(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "automation.json")
            automation.create_background_run(run(), path)
            next_run = run(revision=2)
            self.assertTrue(automation.compare_and_swap_background_run("run-1", 1, next_run, path))
            self.assertFalse(automation.compare_and_swap_background_run("run-1", 1, next_run, path))
            changed = run(revision=3)
            changed["subjectId"] = "other-work"
            with self.assertRaisesRegex(ValueError, "immutable identity"):
                automation.compare_and_swap_background_run("run-1", 2, changed, path)

    def test_schedule_occurrence_commit_is_one_atomic_outbox_transition(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "automation.json")
            self.assertTrue(automation.create_schedule(schedule(), path))
            next_schedule = schedule(revision=2, run_count=1, enabled=True)
            next_schedule["lastRunAt"] = "2026-10-03T15:00:00.000Z"
            next_schedule["nextRunAt"] = "2026-10-03T15:01:00.000Z"
            self.assertTrue(automation.commit_schedule_occurrence("schedule-1", 1, next_schedule, occurrence(), path))
            state = automation.read_automation_state(path)
            self.assertEqual(state["schedules"]["schedule-1"]["revision"], 2)
            self.assertIn("occurrence-1", state["pendingOccurrences"])
            self.assertTrue(automation.ack_schedule_occurrence("occurrence-1", path))
            self.assertNotIn("occurrence-1", automation.read_automation_state(path)["pendingOccurrences"])

    def test_symlink_corruption_and_authority_escalation_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            real = directory / "real.json"
            real.write_text("{}", encoding="utf-8")
            link = directory / "automation.json"
            link.symlink_to(real)
            with self.assertRaises((OSError, ValueError)):
                automation.read_automation_state(str(link))

        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "automation.json")
            unsafe = run(authority="grant")
            with self.assertRaisesRegex(ValueError, "authority"):
                automation.create_background_run(unsafe, path)
            Path(path).write_text("{not-json", encoding="utf-8")
            os.chmod(path, 0o600)
            with self.assertRaisesRegex(ValueError, "corrupt"):
                automation.read_automation_state(path)

    def test_source_uses_nofollow_flock_fsync_and_atomic_replace(self):
        source = MODULE.read_text(encoding="utf-8")
        for marker in ("O_NOFOLLOW", "fcntl.flock", "os.fsync", "os.replace", "0o600"):
            self.assertIn(marker, source)


if __name__ == "__main__":
    unittest.main()
