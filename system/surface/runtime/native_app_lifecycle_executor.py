#!/usr/bin/env python3
"""Offline-only Native executor for verified Store lifecycle plans.

Install/update consume only already-cached content-addressed artifacts and stop at
pending activation. Remove mutates only runtime-component activation state.
No network transport, catalog selection, health verdict, promotion, rollback,
App Data deletion, or cache purge is owned here.
"""

from __future__ import annotations

from contextlib import contextmanager
import base64
import binascii
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from typing import Callable

from native_app_artifact_store import (
    AppArtifactStoreError,
    DEFAULT_ARTIFACT_ROOT,
    read_cached_artifact,
    validate_artifact_identity,
)

PLAN_SCHEMA = "ordax.app-lifecycle-plan/1"
REQUEST_SCHEMA = "ordax.app-lifecycle-request/1"
RESULT_SCHEMA = "ordax.native-app-lifecycle-execution/1"
DEFAULT_CHANNEL_BIN = "/srv/ordax-system/bin/ordax-runtime-component-channel"
DEFAULT_TRUST_PATH = "/srv/ordax-system/trust/runtime-components-ed25519.json"
DEFAULT_SLOT_ROOT = "/var/lib/ordax/components"

APP_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
SEMVER_RE = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
OPERATIONS = {"install", "update", "remove"}
SOURCES = {"store", "launcher"}


class NativeAppLifecycleError(RuntimeError):
    pass


def _exact(value: object, fields: set[str], label: str) -> dict:
    if not isinstance(value, dict) or set(value) != fields:
        raise NativeAppLifecycleError(f"{label} fields are not canonical")
    return value


def _request(value: object) -> dict:
    request = _exact(
        value,
        {"schema", "requestId", "appId", "operation", "source", "authority"},
        "app lifecycle request",
    )
    if request["schema"] != REQUEST_SCHEMA or request["authority"] != "none":
        raise NativeAppLifecycleError("app lifecycle request schema/authority is invalid")
    if not isinstance(request["requestId"], str) or not REQUEST_ID_RE.fullmatch(request["requestId"]):
        raise NativeAppLifecycleError("app lifecycle request id is invalid")
    if not isinstance(request["appId"], str) or not APP_ID_RE.fullmatch(request["appId"]):
        raise NativeAppLifecycleError("app lifecycle app id is invalid")
    if request["operation"] not in OPERATIONS or request["source"] not in SOURCES:
        raise NativeAppLifecycleError("app lifecycle operation/source is invalid")
    if request["source"] == "launcher" and request["operation"] != "install":
        raise NativeAppLifecycleError("launcher may request install only")
    return dict(request)


def _candidate(value: object, *, app_id: str, catalog_commit: str) -> dict | None:
    if value is None:
        return None
    candidate = _exact(
        value,
        {"appId", "version", "sourceCommit", "artifacts"},
        "app lifecycle candidate",
    )
    if candidate["appId"] != app_id:
        raise NativeAppLifecycleError("app lifecycle candidate app id mismatch")
    if not isinstance(candidate["version"], str) or not SEMVER_RE.fullmatch(candidate["version"]):
        raise NativeAppLifecycleError("app lifecycle candidate version is invalid")
    if candidate["sourceCommit"] != catalog_commit:
        raise NativeAppLifecycleError("app lifecycle candidate source commit mismatch")
    artifacts = _exact(
        candidate["artifacts"],
        {"package", "release", "compatibility", "componentEnvelope"},
        "app lifecycle artifacts",
    )
    normalized = {
        role: validate_artifact_identity(artifacts[role])
        for role in ("package", "release", "compatibility", "componentEnvelope")
    }
    if normalized["componentEnvelope"]["name"] != f"{app_id}.runtime-component-envelope.json":
        raise NativeAppLifecycleError("component envelope filename is not canonical")
    return {
        "appId": app_id,
        "version": candidate["version"],
        "sourceCommit": catalog_commit,
        "artifacts": normalized,
    }


def validate_lifecycle_plan(value: object) -> dict:
    plan = _exact(
        value,
        {
            "schema", "request", "catalogSequence", "catalogSha256",
            "catalogSourceCommit", "candidate", "authority",
        },
        "app lifecycle plan",
    )
    if plan["schema"] != PLAN_SCHEMA or plan["authority"] != "none":
        raise NativeAppLifecycleError("app lifecycle plan schema/authority is invalid")
    request = _request(plan["request"])
    if (
        not isinstance(plan["catalogSequence"], int)
        or isinstance(plan["catalogSequence"], bool)
        or plan["catalogSequence"] <= 0
        or not isinstance(plan["catalogSha256"], str)
        or not SHA256_RE.fullmatch(plan["catalogSha256"])
        or not isinstance(plan["catalogSourceCommit"], str)
        or not COMMIT_RE.fullmatch(plan["catalogSourceCommit"])
    ):
        raise NativeAppLifecycleError("app lifecycle catalog identity is invalid")
    candidate = _candidate(
        plan["candidate"],
        app_id=request["appId"],
        catalog_commit=plan["catalogSourceCommit"],
    )
    if request["operation"] in {"install", "update"} and candidate is None:
        raise NativeAppLifecycleError("install/update requires verified candidate")
    return {
        "schema": PLAN_SCHEMA,
        "request": request,
        "catalogSequence": plan["catalogSequence"],
        "catalogSha256": plan["catalogSha256"],
        "catalogSourceCommit": plan["catalogSourceCommit"],
        "candidate": candidate,
        "authority": "none",
    }


def _run(
    argv: list[str],
    *,
    runner: Callable[..., subprocess.CompletedProcess],
    timeout: int = 30,
) -> subprocess.CompletedProcess:
    try:
        result = runner(
            argv,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise NativeAppLifecycleError("runtime component channel is unavailable") from exc
    if result.returncode != 0:
        raise NativeAppLifecycleError("runtime component lifecycle command failed")
    if not isinstance(result.stdout, str) or len(result.stdout.encode("utf-8", errors="strict")) > 64 * 1024:
        raise NativeAppLifecycleError("runtime component lifecycle output is invalid")
    return result


def _key_values(stdout: str, expected: set[str], label: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in stdout.splitlines():
        line = raw.strip()
        if not line:
            continue
        if "=" not in line:
            raise NativeAppLifecycleError(f"{label} output is not canonical")
        key, value = line.split("=", 1)
        if not key or key in values:
            raise NativeAppLifecycleError(f"{label} output has duplicate/empty keys")
        values[key] = value
    if set(values) != expected:
        raise NativeAppLifecycleError(f"{label} output fields are not canonical")
    return values


def _assert_envelope_release_bytes(envelope_bytes: bytes, release_bytes: bytes, app_id: str) -> None:
    try:
        envelope = json.loads(envelope_bytes.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise NativeAppLifecycleError("cached component envelope is invalid JSON") from exc
    if (
        not isinstance(envelope, dict)
        or set(envelope) != {"$schema", "payload", "signature", "key_id"}
        or envelope.get("$schema") != "prototype-ordax.runtime-component-envelope/1"
        or not isinstance(envelope.get("payload"), str)
    ):
        raise NativeAppLifecycleError("cached component envelope shape is not canonical")
    try:
        signed_release = base64.b64decode(envelope["payload"], validate=True)
    except (ValueError, binascii.Error) as exc:
        raise NativeAppLifecycleError("cached component envelope payload is invalid") from exc
    if signed_release != release_bytes:
        raise NativeAppLifecycleError(
            f"cached component envelope release binding mismatch for {app_id}"
        )


@contextmanager
def _materialized_cached_artifacts(candidate: dict, artifact_root: str):
    artifacts = candidate["artifacts"]
    try:
        payloads = {
            role: read_cached_artifact(artifacts[role], root=artifact_root)
            for role in ("package", "release", "compatibility", "componentEnvelope")
        }
    except AppArtifactStoreError as exc:
        raise NativeAppLifecycleError("verified app artifacts are not available offline") from exc

    _assert_envelope_release_bytes(
        payloads["componentEnvelope"],
        payloads["release"],
        candidate["appId"],
    )

    with tempfile.TemporaryDirectory(prefix="ordax-app-stage-") as directory:
        root = Path(directory)
        if os.name != "nt":
            root.chmod(0o700)
        paths: dict[str, Path] = {}
        for role in ("package", "release", "compatibility", "componentEnvelope"):
            name = artifacts[role]["name"]
            path = root / name
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0)
            descriptor = os.open(path, flags, 0o400)
            try:
                with os.fdopen(descriptor, "wb") as handle:
                    handle.write(payloads[role])
                    handle.flush()
                    os.fsync(handle.fileno())
                if os.name != "nt":
                    path.chmod(0o400)
            except Exception:
                try:
                    os.close(descriptor)
                except OSError:
                    pass
                raise
            paths[role] = path
        yield paths


def _stage_and_arm(
    plan: dict,
    *,
    artifact_root: str,
    channel_bin: str,
    trust_path: str,
    slot_root: str,
    runner: Callable[..., subprocess.CompletedProcess],
) -> dict:
    request = plan["request"]
    candidate = plan["candidate"]
    assert candidate is not None
    with _materialized_cached_artifacts(candidate, artifact_root) as paths:
        verified = _key_values(
                _run([
                    channel_bin,
                    "verify-envelope-v2",
                    "--envelope", str(paths["componentEnvelope"]),
                    "--trust", trust_path,
                    "--compatibility", str(paths["compatibility"]),
                ], runner=runner).stdout,
            {
                "RUNTIME_COMPONENT_RELEASE_V2_VERIFIED",
                "COMPONENT_ID", "COMPONENT_VERSION", "SOURCE_COMMIT",
                "PENDING_HEALTH_REQUIRED", "DIRECT_ACTIVATION_ALLOWED",
            },
            "verify-envelope-v2",
        )
        if (
            verified["RUNTIME_COMPONENT_RELEASE_V2_VERIFIED"] != "YES"
            or verified["COMPONENT_ID"] != request["appId"]
            or verified["COMPONENT_VERSION"] != candidate["version"]
            or verified["SOURCE_COMMIT"] != candidate["sourceCommit"]
            or verified["PENDING_HEALTH_REQUIRED"] != "YES"
            or verified["DIRECT_ACTIVATION_ALLOWED"] != "NO"
        ):
            raise NativeAppLifecycleError("verified component envelope identity drifted")

        staged = _key_values(
            _run([
                channel_bin,
                "stage-v2",
                "--envelope", str(paths["componentEnvelope"]),
                "--trust", trust_path,
                "--package", str(paths["package"]),
                "--compatibility", str(paths["compatibility"]),
                "--root", slot_root,
            ], runner=runner).stdout,
            {
                "RUNTIME_COMPONENT_RELEASE_V2_STAGED",
                "COMPONENT_ID", "COMPONENT_VERSION", "SOURCE_COMMIT",
                "SLOT", "SLOT_CHANGED", "PENDING_HEALTH_REQUIRED", "ACTIVATED",
            },
            "stage-v2",
        )
        if (
            staged["RUNTIME_COMPONENT_RELEASE_V2_STAGED"] != "YES"
            or staged["COMPONENT_ID"] != request["appId"]
            or staged["COMPONENT_VERSION"] != candidate["version"]
            or staged["SOURCE_COMMIT"] != candidate["sourceCommit"]
            or staged["PENDING_HEALTH_REQUIRED"] != "YES"
            or staged["ACTIVATED"] != "NO"
        ):
            raise NativeAppLifecycleError("staged component identity drifted")
        slot = staged["SLOT"]
        if not slot:
            raise NativeAppLifecycleError("stage-v2 did not return canonical slot")

        slot_verified = _key_values(
            _run([
                channel_bin,
                "verify-slot-v2",
                "--slot", slot,
                "--trust", trust_path,
            ], runner=runner).stdout,
            {
                "RUNTIME_COMPONENT_RELEASE_V2_SLOT_VERIFIED",
                "COMPONENT_ID", "COMPONENT_VERSION", "SOURCE_COMMIT",
                "DIRECT_ACTIVATION_ALLOWED",
            },
            "verify-slot-v2",
        )
        if (
            slot_verified["RUNTIME_COMPONENT_RELEASE_V2_SLOT_VERIFIED"] != "YES"
            or slot_verified["COMPONENT_ID"] != request["appId"]
            or slot_verified["COMPONENT_VERSION"] != candidate["version"]
            or slot_verified["SOURCE_COMMIT"] != candidate["sourceCommit"]
            or slot_verified["DIRECT_ACTIVATION_ALLOWED"] != "NO"
        ):
            raise NativeAppLifecycleError("verified staged slot identity drifted")

        pending = _key_values(
            _run([
                channel_bin,
                "arm-pending",
                "--slot", slot,
                "--trust", trust_path,
                "--root", slot_root,
            ], runner=runner).stdout,
            {
                "RUNTIME_COMPONENT_PENDING_ARMED",
                "COMPONENT_ID", "REVISION", "PENDING_VERSION",
                "PENDING_SOURCE_COMMIT", "PENDING_HEALTH", "RUNTIME_ACTIVATED",
            },
            "arm-pending",
        )
        if (
            pending["RUNTIME_COMPONENT_PENDING_ARMED"] != "YES"
            or pending["COMPONENT_ID"] != request["appId"]
            or pending["PENDING_VERSION"] != candidate["version"]
            or pending["PENDING_SOURCE_COMMIT"] != candidate["sourceCommit"]
            or pending["PENDING_HEALTH"] != "unknown"
            or pending["RUNTIME_ACTIVATED"] != "NO"
        ):
            raise NativeAppLifecycleError("pending component identity drifted")
        try:
            revision = int(pending["REVISION"])
        except ValueError as exc:
            raise NativeAppLifecycleError("pending component revision is invalid") from exc
        if revision <= 0:
            raise NativeAppLifecycleError("pending component revision is invalid")

        return {
            "schema": RESULT_SCHEMA,
            "requestId": request["requestId"],
            "appId": request["appId"],
            "operation": request["operation"],
            "state": "pending-health",
            "version": candidate["version"],
            "sourceCommit": candidate["sourceCommit"],
            "revision": revision,
            "activated": False,
            "appDataTouched": False,
            "artifactCachePurged": False,
        }


def _remove(
    plan: dict,
    *,
    channel_bin: str,
    trust_path: str,
    slot_root: str,
    runner: Callable[..., subprocess.CompletedProcess],
) -> dict:
    request = plan["request"]
    status = _run([
        channel_bin,
        "status",
        "--component", request["appId"],
        "--root", slot_root,
    ], runner=runner)
    try:
        state = json.loads(status.stdout)
    except json.JSONDecodeError as exc:
        raise NativeAppLifecycleError("runtime component status is invalid JSON") from exc
    if (
        not isinstance(state, dict)
        or state.get("$schema") != "prototype-ordax.runtime-component-activation-state/1"
        or state.get("component_id") != request["appId"]
        or not isinstance(state.get("revision"), int)
        or isinstance(state.get("revision"), bool)
        or state["revision"] <= 0
        or state.get("pending") is not None
        or not isinstance(state.get("current"), dict)
    ):
        raise NativeAppLifecycleError("runtime component current activation is not removable")
    current = state["current"]
    if (
        set(current) != {"version", "source_commit"}
        or not isinstance(current["version"], str)
        or not SEMVER_RE.fullmatch(current["version"])
        or not isinstance(current["source_commit"], str)
        or not COMMIT_RE.fullmatch(current["source_commit"])
    ):
        raise NativeAppLifecycleError("runtime component current identity is invalid")

    removed = _key_values(
        _run([
            channel_bin,
            "uninstall-state",
            "--component", request["appId"],
            "--version", current["version"],
            "--source-commit", current["source_commit"],
            "--expected-revision", str(state["revision"]),
            "--trust", trust_path,
            "--root", slot_root,
        ], runner=runner).stdout,
        {
            "RUNTIME_COMPONENT_STATE_UNINSTALLED",
            "COMPONENT_ID", "REVISION", "CURRENT_PRESENT",
            "APP_DATA_TOUCHED", "SLOT_CACHE_PURGED",
        },
        "uninstall-state",
    )
    if (
        removed["RUNTIME_COMPONENT_STATE_UNINSTALLED"] != "YES"
        or removed["COMPONENT_ID"] != request["appId"]
        or removed["CURRENT_PRESENT"] != "NO"
        or removed["APP_DATA_TOUCHED"] != "NO"
        or removed["SLOT_CACHE_PURGED"] != "NO"
    ):
        raise NativeAppLifecycleError("runtime component uninstall boundary drifted")
    try:
        revision = int(removed["REVISION"])
    except ValueError as exc:
        raise NativeAppLifecycleError("runtime component uninstall revision is invalid") from exc
    if revision != state["revision"] + 1:
        raise NativeAppLifecycleError("runtime component uninstall revision drifted")
    return {
        "schema": RESULT_SCHEMA,
        "requestId": request["requestId"],
        "appId": request["appId"],
        "operation": "remove",
        "state": "removed",
        "version": current["version"],
        "sourceCommit": current["source_commit"],
        "revision": revision,
        "activated": False,
        "appDataTouched": False,
        "artifactCachePurged": False,
    }


def execute_offline_lifecycle_plan(
    raw_plan: object,
    *,
    artifact_root: str = DEFAULT_ARTIFACT_ROOT,
    channel_bin: str = DEFAULT_CHANNEL_BIN,
    trust_path: str = DEFAULT_TRUST_PATH,
    slot_root: str = DEFAULT_SLOT_ROOT,
    runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
) -> dict:
    plan = validate_lifecycle_plan(raw_plan)
    operation = plan["request"]["operation"]
    if operation in {"install", "update"}:
        return _stage_and_arm(
            plan,
            artifact_root=artifact_root,
            channel_bin=channel_bin,
            trust_path=trust_path,
            slot_root=slot_root,
            runner=runner,
        )
    return _remove(
        plan,
        channel_bin=channel_bin,
        trust_path=trust_path,
        slot_root=slot_root,
        runner=runner,
    )
