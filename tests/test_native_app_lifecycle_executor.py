from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

RUNTIME = Path(__file__).resolve().parents[1] / "system" / "surface" / "runtime"
if str(RUNTIME) not in sys.path:
    sys.path.insert(0, str(RUNTIME))

import native_app_artifact_store as artifacts
import native_app_lifecycle_executor as lifecycle

COMMIT = "a" * 40


def artifact(name: str, payload: bytes) -> dict:
    return {
        "name": name,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "size": len(payload),
    }


def request(operation: str = "install") -> dict:
    return {
        "schema": "ordax.app-lifecycle-request/1",
        "requestId": f"store:{operation}:notes:test",
        "appId": "notes",
        "operation": operation,
        "source": "store",
        "authority": "none",
    }


class Result:
    def __init__(self, stdout: str = "", returncode: int = 0) -> None:
        self.stdout = stdout
        self.stderr = ""
        self.returncode = returncode


class NativeAppLifecycleExecutorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.cache = self.root / "artifacts"
        self.slot_root = self.root / "slots"
        self.trust = self.root / "trust.json"
        self.trust.write_text("{}\n", encoding="utf-8")
        self.channel = str(self.root / "ordax-runtime-component-channel")
        self.watermark = self.root / "catalog-watermark.json"
        self.watermark.write_text(
            json.dumps({
                "schema": "ordax.store-catalog-watermark/1",
                "sequence": 9,
                "catalogSha256": "f" * 64,
            }, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

        self.release_bytes = b'{"release":"notes"}\n'
        self.package_bytes = b"notes-package"
        self.compatibility_bytes = b'{"compatibility":"notes"}\n'
        self.envelope_bytes = (
            json.dumps(
                {
                    "$schema": "prototype-ordax.runtime-component-envelope/1",
                    "payload": base64.b64encode(self.release_bytes).decode("ascii"),
                    "signature": base64.b64encode(bytes(range(64))).decode("ascii"),
                    "key_id": "ordax-runtime-components-v1",
                },
                sort_keys=True,
                separators=(",", ":"),
            )
            + "\n"
        ).encode("utf-8")
        self.artifact_set = {
            "package": artifact("notes.zip", self.package_bytes),
            "release": artifact("notes.release.json", self.release_bytes),
            "compatibility": artifact("notes.compatibility.json", self.compatibility_bytes),
            "componentEnvelope": artifact(
                "notes.runtime-component-envelope.json",
                self.envelope_bytes,
            ),
        }

    def tearDown(self) -> None:
        self.temp.cleanup()

    def plan(self, operation: str = "install", *, candidate: bool = True) -> dict:
        return {
            "schema": "ordax.app-lifecycle-plan/1",
            "request": request(operation),
            "catalogSequence": 9,
            "catalogSha256": "f" * 64,
            "catalogSourceCommit": COMMIT,
            "candidate": (
                {
                    "appId": "notes",
                    "version": "0.4.3",
                    "sourceCommit": COMMIT,
                    "artifacts": self.artifact_set,
                }
                if candidate
                else None
            ),
            "authority": "none",
        }

    def cache_all(self) -> None:
        for role, payload in {
            "package": self.package_bytes,
            "release": self.release_bytes,
            "compatibility": self.compatibility_bytes,
            "componentEnvelope": self.envelope_bytes,
        }.items():
            artifacts.store_verified_artifact(
                self.artifact_set[role],
                payload,
                root=str(self.cache),
            )

    def install_runner(self):
        calls = []

        def runner(argv, **kwargs):
            calls.append((list(argv), dict(kwargs)))
            command = argv[1]
            if command == "verify-envelope-v2":
                self.assertEqual(Path(argv[argv.index("--envelope") + 1]).name, "notes.runtime-component-envelope.json")
                self.assertEqual(Path(argv[argv.index("--compatibility") + 1]).name, "notes.compatibility.json")
                return Result(
                    "\n".join([
                        "RUNTIME_COMPONENT_RELEASE_V2_VERIFIED=YES",
                        "COMPONENT_ID=notes",
                        "COMPONENT_VERSION=0.4.3",
                        f"SOURCE_COMMIT={COMMIT}",
                        "PENDING_HEALTH_REQUIRED=YES",
                        "DIRECT_ACTIVATION_ALLOWED=NO",
                        "",
                    ])
                )
            if command == "stage-v2":
                self.assertEqual(Path(argv[argv.index("--package") + 1]).name, "notes.zip")
                self.assertEqual(Path(argv[argv.index("--compatibility") + 1]).name, "notes.compatibility.json")
                slot = self.slot_root / "notes" / "versions" / "0.4.3" / COMMIT
                return Result(
                    "\n".join([
                        "RUNTIME_COMPONENT_RELEASE_V2_STAGED=YES",
                        "COMPONENT_ID=notes",
                        "COMPONENT_VERSION=0.4.3",
                        f"SOURCE_COMMIT={COMMIT}",
                        f"SLOT={slot}",
                        "SLOT_CHANGED=true",
                        "PENDING_HEALTH_REQUIRED=YES",
                        "ACTIVATED=NO",
                        "",
                    ])
                )
            if command == "verify-slot-v2":
                return Result(
                    "\n".join([
                        "RUNTIME_COMPONENT_RELEASE_V2_SLOT_VERIFIED=YES",
                        "COMPONENT_ID=notes",
                        "COMPONENT_VERSION=0.4.3",
                        f"SOURCE_COMMIT={COMMIT}",
                        "DIRECT_ACTIVATION_ALLOWED=NO",
                        "",
                    ])
                )
            if command == "arm-pending":
                return Result(
                    "\n".join([
                        "RUNTIME_COMPONENT_PENDING_ARMED=YES",
                        "COMPONENT_ID=notes",
                        "REVISION=3",
                        "PENDING_VERSION=0.4.3",
                        f"PENDING_SOURCE_COMMIT={COMMIT}",
                        "PENDING_HEALTH=unknown",
                        "RUNTIME_ACTIVATED=NO",
                        "",
                    ])
                )
            self.fail(f"unexpected command: {command}")

        return calls, runner

    def test_install_uses_only_verified_offline_cache_and_stops_at_pending_health(self) -> None:
        self.cache_all()
        calls, runner = self.install_runner()
        result = lifecycle.execute_offline_lifecycle_plan(
            self.plan(),
            artifact_root=str(self.cache),
            channel_bin=self.channel,
            trust_path=str(self.trust),
            slot_root=str(self.slot_root),
            watermark_path=str(self.watermark),
            runner=runner,
        )
        self.assertEqual(
            [argv[1] for argv, _kwargs in calls],
            ["verify-envelope-v2", "stage-v2", "verify-slot-v2", "arm-pending"],
        )
        for argv, kwargs in calls:
            self.assertNotIn("promote-state", argv)
            self.assertNotIn("record-health", argv)
            self.assertNotIn("http", " ".join(argv).lower())
            self.assertFalse(kwargs["check"])
            self.assertTrue(kwargs["capture_output"])
        self.assertEqual(result["state"], "pending-health")
        self.assertFalse(result["activated"])
        self.assertFalse(result["appDataTouched"])
        self.assertFalse(result["artifactCachePurged"])
        self.assertEqual(result["revision"], 3)

    def test_update_has_same_nonactivating_stage_boundary(self) -> None:
        self.cache_all()
        calls, runner = self.install_runner()
        result = lifecycle.execute_offline_lifecycle_plan(
            self.plan("update"),
            artifact_root=str(self.cache),
            channel_bin=self.channel,
            trust_path=str(self.trust),
            slot_root=str(self.slot_root),
            watermark_path=str(self.watermark),
            runner=runner,
        )
        self.assertEqual(result["operation"], "update")
        self.assertEqual(result["state"], "pending-health")
        self.assertEqual([argv[1] for argv, _ in calls][-1], "arm-pending")

    def test_missing_cached_artifact_fails_before_runtime_channel(self) -> None:
        # Only three of four artifacts exist.
        for role, payload in {
            "release": self.release_bytes,
            "compatibility": self.compatibility_bytes,
            "componentEnvelope": self.envelope_bytes,
        }.items():
            artifacts.store_verified_artifact(
                self.artifact_set[role],
                payload,
                root=str(self.cache),
            )
        calls = []

        def runner(*args, **kwargs):
            calls.append((args, kwargs))
            return Result()

        with self.assertRaisesRegex(
            lifecycle.NativeAppLifecycleError,
            "not available offline",
        ):
            lifecycle.execute_offline_lifecycle_plan(
                self.plan(),
                artifact_root=str(self.cache),
                channel_bin=self.channel,
                trust_path=str(self.trust),
                slot_root=str(self.slot_root),
                watermark_path=str(self.watermark),
                runner=runner,
            )
        self.assertEqual(calls, [])

    def test_envelope_release_byte_drift_fails_before_runtime_channel(self) -> None:
        self.cache_all()
        drifted_release = b'{"release":"other"}\n'
        drifted = artifact("notes.release.json", drifted_release)
        artifacts.store_verified_artifact(drifted, drifted_release, root=str(self.cache))
        plan = self.plan()
        plan["candidate"]["artifacts"]["release"] = drifted
        calls = []

        with self.assertRaisesRegex(
            lifecycle.NativeAppLifecycleError,
            "release binding mismatch",
        ):
            lifecycle.execute_offline_lifecycle_plan(
                plan,
                artifact_root=str(self.cache),
                channel_bin=self.channel,
                trust_path=str(self.trust),
                slot_root=str(self.slot_root),
                watermark_path=str(self.watermark),
                runner=lambda *args, **kwargs: calls.append((args, kwargs)),
            )
        self.assertEqual(calls, [])

    def test_remove_resolves_exact_current_revision_and_preserves_data_and_cache(self) -> None:
        calls = []

        def runner(argv, **kwargs):
            calls.append(list(argv))
            if argv[1] == "status":
                return Result(json.dumps({
                    "$schema": "prototype-ordax.runtime-component-activation-state/1",
                    "component_id": "notes",
                    "revision": 12,
                    "current": {"version": "0.4.3", "source_commit": COMMIT},
                    "previous": None,
                    "pending": None,
                    "rejected": None,
                    "pending_health": "unknown",
                }) + "\n")
            if argv[1] == "uninstall-state":
                self.assertEqual(argv[argv.index("--expected-revision") + 1], "12")
                return Result(
                    "\n".join([
                        "RUNTIME_COMPONENT_STATE_UNINSTALLED=YES",
                        "COMPONENT_ID=notes",
                        "REVISION=13",
                        "CURRENT_PRESENT=NO",
                        "APP_DATA_TOUCHED=NO",
                        "SLOT_CACHE_PURGED=NO",
                        "",
                    ])
                )
            self.fail(f"unexpected command: {argv[1]}")

        result = lifecycle.execute_offline_lifecycle_plan(
            self.plan("remove", candidate=False),
            channel_bin=self.channel,
            trust_path=str(self.trust),
            slot_root=str(self.slot_root),
            watermark_path=str(self.watermark),
            runner=runner,
        )
        self.assertEqual([argv[1] for argv in calls], ["status", "uninstall-state"])
        self.assertEqual(result["state"], "removed")
        self.assertFalse(result["appDataTouched"])
        self.assertFalse(result["artifactCachePurged"])
        self.assertEqual(result["revision"], 13)

    def test_remove_refuses_pending_or_absent_current_before_uninstall(self) -> None:
        for state in [
            {
                "$schema": "prototype-ordax.runtime-component-activation-state/1",
                "component_id": "notes",
                "revision": 5,
                "current": None,
                "previous": None,
                "pending": None,
                "rejected": None,
                "pending_health": "unknown",
            },
            {
                "$schema": "prototype-ordax.runtime-component-activation-state/1",
                "component_id": "notes",
                "revision": 5,
                "current": {"version": "0.4.3", "source_commit": COMMIT},
                "previous": None,
                "pending": {"version": "0.4.4", "source_commit": "b" * 40},
                "rejected": None,
                "pending_health": "unknown",
            },
        ]:
            calls = []

            def runner(argv, **kwargs):
                calls.append(list(argv))
                return Result(json.dumps(state) + "\n")

            with self.assertRaisesRegex(
                lifecycle.NativeAppLifecycleError,
                "current activation is not removable",
            ):
                lifecycle.execute_offline_lifecycle_plan(
                    self.plan("remove", candidate=False),
                    channel_bin=self.channel,
                    trust_path=str(self.trust),
                    slot_root=str(self.slot_root),
                    watermark_path=str(self.watermark),
                    runner=runner,
                )
            self.assertEqual([argv[1] for argv in calls], ["status"])

    def test_stale_or_equivocated_plan_is_rejected_before_runtime_or_cache_access(self) -> None:
        calls = []

        stale = self.plan()
        stale["catalogSequence"] = 8
        with self.assertRaisesRegex(
            lifecycle.NativeAppLifecycleError,
            "does not match current Store catalog watermark",
        ):
            lifecycle.execute_offline_lifecycle_plan(
                stale,
                artifact_root=str(self.cache),
                channel_bin=self.channel,
                trust_path=str(self.trust),
                slot_root=str(self.slot_root),
                watermark_path=str(self.watermark),
                runner=lambda *args, **kwargs: calls.append((args, kwargs)),
            )

        equivocated = self.plan()
        equivocated["catalogSha256"] = "e" * 64
        with self.assertRaisesRegex(
            lifecycle.NativeAppLifecycleError,
            "does not match current Store catalog watermark",
        ):
            lifecycle.execute_offline_lifecycle_plan(
                equivocated,
                artifact_root=str(self.cache),
                channel_bin=self.channel,
                trust_path=str(self.trust),
                slot_root=str(self.slot_root),
                watermark_path=str(self.watermark),
                runner=lambda *args, **kwargs: calls.append((args, kwargs)),
            )

        self.assertEqual(calls, [])

    def test_missing_or_corrupt_watermark_fails_closed_before_runtime(self) -> None:
        calls = []
        self.watermark.unlink()
        with self.assertRaisesRegex(
            lifecycle.NativeAppLifecycleError,
            "watermark is unavailable",
        ):
            lifecycle.execute_offline_lifecycle_plan(
                self.plan("remove", candidate=False),
                channel_bin=self.channel,
                trust_path=str(self.trust),
                slot_root=str(self.slot_root),
                watermark_path=str(self.watermark),
                runner=lambda *args, **kwargs: calls.append((args, kwargs)),
            )

        self.watermark.write_text('{"schema":"broken"}\n', encoding="utf-8")
        with self.assertRaisesRegex(
            lifecycle.NativeAppLifecycleError,
            "watermark is unavailable",
        ):
            lifecycle.execute_offline_lifecycle_plan(
                self.plan("remove", candidate=False),
                channel_bin=self.channel,
                trust_path=str(self.trust),
                slot_root=str(self.slot_root),
                watermark_path=str(self.watermark),
                runner=lambda *args, **kwargs: calls.append((args, kwargs)),
            )

        self.assertEqual(calls, [])

    def test_native_plan_validation_rejects_authority_or_ui_artifact_smuggling(self) -> None:
        plan = self.plan()
        plan["authority"] = "platform-component-lifecycle"
        with self.assertRaisesRegex(lifecycle.NativeAppLifecycleError, "schema/authority"):
            lifecycle.validate_lifecycle_plan(plan)

        plan = self.plan()
        plan["request"]["artifactUrl"] = "https://example.invalid/app.zip"
        with self.assertRaisesRegex(lifecycle.NativeAppLifecycleError, "fields are not canonical"):
            lifecycle.validate_lifecycle_plan(plan)


if __name__ == "__main__":
    unittest.main()
