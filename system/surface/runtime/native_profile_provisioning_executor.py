#!/usr/bin/env python3
"""Trusted Profile content provisioning executor.

This module has no Surface/HTTP entrypoint. It consumes evidence emitted by the
signed Profile content verifier, persists an immutable receipt first, then
atomically advances the device inventory under an exclusive host lock.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import stat
import subprocess
import time
from pathlib import Path

from native_profile_component_inventory import (
    PROFILE_COMPONENT_INVENTORY_FILE,
    read_profile_component_inventory,
    write_profile_component_inventory,
)

PROFILE_STAGE_EVIDENCE_SCHEMA = "ordax.profile-content-stage-evidence/1"
PROFILE_INSTALL_RECEIPT_SCHEMA = "ordax.profile-install-receipt/1"
PROFILE_CONTENT_HEALTH_SCHEMA = "ordax.profile-content-health/1"
DEFAULT_PROFILE_CONTENT_CHANNEL = "/srv/ordax-system/bin/ordax-profile-content-channel"
DEFAULT_PROFILE_CONTENT_TRUST = "/srv/ordax-system/trust/profile-content-ed25519.json"
DEFAULT_RECEIPT_ROOT = "/var/lib/ordax/profile-content-receipts"
DEFAULT_LOCK_PATH = "/var/lib/ordax/profile-provisioning.lock"
MAX_EVIDENCE_BYTES = 64 * 1024
MAX_RECEIPT_BYTES = 64 * 1024

_ID_RE = re.compile(r"^[a-z][a-z0-9._-]{1,127}$")
_SEMVER_RE = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$"
)
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_KEY_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
_KINDS = frozenset(("knowledge-pack", "skill-pack"))


def _exact_keys(value: object, expected: set[str], label: str) -> dict:
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError(f"{label} fields are incompatible")
    return value


def _bounded_text(value: object, label: str, maximum: int) -> str:
    if (
        not isinstance(value, str)
        or not value
        or len(value) > maximum
        or "\0" in value
    ):
        raise ValueError(f"{label} is invalid")
    return value


def _epoch(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{label} is invalid")
    return value


def validate_stage_evidence(value: object) -> dict:
    evidence = _exact_keys(
        value,
        {"schema", "artifact", "verification", "health"},
        "Profile stage evidence",
    )
    if evidence["schema"] != PROFILE_STAGE_EVIDENCE_SCHEMA:
        raise ValueError("Profile stage evidence schema is unsupported")

    artifact = _exact_keys(
        evidence["artifact"],
        {"id", "kind", "version", "sha256", "sizeBytes"},
        "Profile stage evidence artifact",
    )
    component_id = _bounded_text(artifact["id"], "artifact id", 128)
    if _ID_RE.fullmatch(component_id) is None:
        raise ValueError("artifact id is invalid")
    if artifact["kind"] not in _KINDS:
        raise ValueError("artifact kind is unsupported")
    version = _bounded_text(artifact["version"], "artifact version", 64)
    if _SEMVER_RE.fullmatch(version) is None:
        raise ValueError("artifact version is invalid")
    artifact_sha = _bounded_text(artifact["sha256"], "artifact sha256", 64)
    if _SHA256_RE.fullmatch(artifact_sha) is None:
        raise ValueError("artifact sha256 is invalid")
    size_bytes = artifact["sizeBytes"]
    if isinstance(size_bytes, bool) or not isinstance(size_bytes, int) or size_bytes <= 0:
        raise ValueError("artifact sizeBytes is invalid")

    verification = _exact_keys(
        evidence["verification"],
        {"signatureAlgorithm", "keyId", "manifestSha256"},
        "Profile stage evidence verification",
    )
    if verification["signatureAlgorithm"] != "ed25519":
        raise ValueError("Profile stage evidence signature algorithm is unsupported")
    key_id = _bounded_text(verification["keyId"], "verification keyId", 64)
    if _KEY_ID_RE.fullmatch(key_id) is None:
        raise ValueError("verification keyId is invalid")
    manifest_sha = _bounded_text(
        verification["manifestSha256"],
        "verification manifestSha256",
        64,
    )
    if _SHA256_RE.fullmatch(manifest_sha) is None:
        raise ValueError("verification manifestSha256 is invalid")

    health = _exact_keys(
        evidence["health"],
        {
            "schema",
            "state",
            "entryCount",
            "perEntryHashVerified",
            "perEntryProvenanceVerified",
            "executablePayloadAllowed",
            "authority",
        },
        "Profile stage evidence health",
    )
    if health["schema"] != PROFILE_CONTENT_HEALTH_SCHEMA or health["state"] != "healthy":
        raise ValueError("Profile stage evidence health is not healthy")
    entry_count = health["entryCount"]
    if (
        isinstance(entry_count, bool)
        or not isinstance(entry_count, int)
        or entry_count < 1
        or entry_count > 2048
    ):
        raise ValueError("Profile stage evidence entryCount is invalid")
    if (
        health["perEntryHashVerified"] is not True
        or health["perEntryProvenanceVerified"] is not True
        or health["executablePayloadAllowed"] is not False
        or health["authority"] != "none"
    ):
        raise ValueError("Profile stage evidence health authority is unsafe")

    return {
        "schema": PROFILE_STAGE_EVIDENCE_SCHEMA,
        "artifact": {
            "id": component_id,
            "kind": artifact["kind"],
            "version": version,
            "sha256": artifact_sha,
            "sizeBytes": size_bytes,
        },
        "verification": {
            "signatureAlgorithm": "ed25519",
            "keyId": key_id,
            "manifestSha256": manifest_sha,
        },
        "health": {
            "schema": PROFILE_CONTENT_HEALTH_SCHEMA,
            "state": "healthy",
            "entryCount": entry_count,
            "perEntryHashVerified": True,
            "perEntryProvenanceVerified": True,
            "executablePayloadAllowed": False,
            "authority": "none",
        },
    }


def read_stage_evidence(
    slot: str,
    trust_path: str = DEFAULT_PROFILE_CONTENT_TRUST,
    channel_bin: str = DEFAULT_PROFILE_CONTENT_CHANNEL,
) -> dict:
    if not isinstance(slot, str) or not slot:
        raise ValueError("Profile content slot path is required")
    if not isinstance(trust_path, str) or not trust_path:
        raise ValueError("Profile content trust path is required")
    result = subprocess.run(
        [
            channel_bin,
            "evidence",
            "--slot",
            slot,
            "--trust",
            trust_path,
        ],
        check=False,
        capture_output=True,
        timeout=30,
    )
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"Profile content evidence failed: {message or result.returncode}")
    if not result.stdout or len(result.stdout) > MAX_EVIDENCE_BYTES:
        raise ValueError("Profile content evidence output is outside bounds")
    try:
        value = json.loads(result.stdout.decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Profile content evidence output is invalid JSON") from exc
    return validate_stage_evidence(value)


def receipt_from_stage_evidence(evidence: object, now_ms: int) -> dict:
    value = validate_stage_evidence(evidence)
    timestamp = _epoch(now_ms, "receipt timestamp")
    return {
        "schema": PROFILE_INSTALL_RECEIPT_SCHEMA,
        "artifact": dict(value["artifact"]),
        "verification": {
            **value["verification"],
            "verifiedAt": timestamp,
        },
        "health": {
            **value["health"],
            "checkedAt": timestamp,
        },
        "installedAt": timestamp,
    }


def _canonical_json_bytes(value: object) -> bytes:
    return (
        json.dumps(
            value,
            separators=(",", ":"),
            sort_keys=True,
            ensure_ascii=False,
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")


def _secure_directory(path: str) -> None:
    os.makedirs(path, mode=0o700, exist_ok=True)
    info = os.stat(path, follow_symlinks=False)
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise ValueError("Profile provisioning directory boundary is unsafe")
    os.chmod(path, 0o700)


def _write_receipt_once(receipt: dict, receipt_root: str) -> tuple[str, str, bool]:
    payload = _canonical_json_bytes(receipt)
    if len(payload) > MAX_RECEIPT_BYTES:
        raise ValueError("Profile install receipt exceeds maximum size")
    digest = hashlib.sha256(payload).hexdigest()
    _secure_directory(receipt_root)
    path = os.path.join(receipt_root, f"{digest}.json")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    flags |= getattr(os, "O_NOFOLLOW", 0)
    flags |= getattr(os, "O_CLOEXEC", 0)
    try:
        descriptor = os.open(path, flags, 0o600)
    except FileExistsError:
        existing = Path(path).read_bytes()
        if hashlib.sha256(existing).hexdigest() != digest or existing != payload:
            raise ValueError("Existing Profile receipt does not match its content address")
        return path, digest, False
    try:
        with os.fdopen(descriptor, "wb", closefd=True) as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(path, 0o600)
    except Exception:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
        raise
    directory_fd = os.open(
        receipt_root,
        os.O_RDONLY | getattr(os, "O_DIRECTORY", 0),
    )
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
    return path, digest, True


def _lock_file(path: str):
    parent = os.path.dirname(path)
    _secure_directory(parent)
    descriptor = os.open(
        path,
        os.O_RDWR | os.O_CREAT | getattr(os, "O_CLOEXEC", 0),
        0o600,
    )
    os.chmod(path, 0o600)
    handle = os.fdopen(descriptor, "a+b", closefd=True)
    fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
    return handle


def commit_verified_receipt(
    receipt: dict,
    *,
    inventory_path: str = PROFILE_COMPONENT_INVENTORY_FILE,
    receipt_root: str = DEFAULT_RECEIPT_ROOT,
    lock_path: str = DEFAULT_LOCK_PATH,
) -> dict:
    artifact = receipt.get("artifact") if isinstance(receipt, dict) else None
    health = receipt.get("health") if isinstance(receipt, dict) else None
    verification = receipt.get("verification") if isinstance(receipt, dict) else None
    if (
        receipt.get("schema") != PROFILE_INSTALL_RECEIPT_SCHEMA
        or not isinstance(artifact, dict)
        or not isinstance(health, dict)
        or not isinstance(verification, dict)
    ):
        raise ValueError("Profile install receipt is invalid")
    # Reuse the evidence validator for every security-sensitive field, dropping
    # only timestamps that belong to the durable receipt layer.
    validate_stage_evidence({
        "schema": PROFILE_STAGE_EVIDENCE_SCHEMA,
        "artifact": artifact,
        "verification": {
            "signatureAlgorithm": verification.get("signatureAlgorithm"),
            "keyId": verification.get("keyId"),
            "manifestSha256": verification.get("manifestSha256"),
        },
        "health": {
            "schema": health.get("schema"),
            "state": health.get("state"),
            "entryCount": health.get("entryCount"),
            "perEntryHashVerified": health.get("perEntryHashVerified"),
            "perEntryProvenanceVerified": health.get("perEntryProvenanceVerified"),
            "executablePayloadAllowed": health.get("executablePayloadAllowed"),
            "authority": health.get("authority"),
        },
    })
    verified_at = _epoch(verification.get("verifiedAt"), "verifiedAt")
    checked_at = _epoch(health.get("checkedAt"), "checkedAt")
    installed_at = _epoch(receipt.get("installedAt"), "installedAt")
    if checked_at < verified_at or installed_at < checked_at:
        raise ValueError("Profile install receipt timestamps are not monotonic")

    with _lock_file(lock_path) as lock_handle:
        try:
            inventory = read_profile_component_inventory(inventory_path)
            identity = (
                artifact["id"],
                artifact["version"],
                artifact["sha256"],
            )
            for entry in inventory["entries"]:
                current = (entry["id"], entry["version"], entry["sha256"])
                if current == identity:
                    receipt_path = os.path.join(
                        receipt_root,
                        f"{entry['receiptSha256']}.json",
                    )
                    if not os.path.isfile(receipt_path):
                        raise ValueError("Installed Profile component receipt is missing")
                    payload = Path(receipt_path).read_bytes()
                    if hashlib.sha256(payload).hexdigest() != entry["receiptSha256"]:
                        raise ValueError("Installed Profile component receipt hash mismatch")
                    return {
                        "changed": False,
                        "inventory": inventory,
                        "receiptPath": receipt_path,
                        "receiptSha256": entry["receiptSha256"],
                    }

            receipt_path, receipt_sha, _ = _write_receipt_once(receipt, receipt_root)
            entry = {
                "id": artifact["id"],
                "kind": artifact["kind"],
                "version": artifact["version"],
                "sha256": artifact["sha256"],
                "installedAt": installed_at,
                "receiptSha256": receipt_sha,
            }
            next_inventory = {
                "schema": inventory["schema"],
                "revision": inventory["revision"] + 1,
                "persistence": "device",
                "entries": [*inventory["entries"], entry],
            }
            write_profile_component_inventory(next_inventory, inventory_path)
            return {
                "changed": True,
                "inventory": next_inventory,
                "receiptPath": receipt_path,
                "receiptSha256": receipt_sha,
            }
        finally:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)


def provision_verified_stage(
    slot: str,
    *,
    trust_path: str = DEFAULT_PROFILE_CONTENT_TRUST,
    channel_bin: str = DEFAULT_PROFILE_CONTENT_CHANNEL,
    inventory_path: str = PROFILE_COMPONENT_INVENTORY_FILE,
    receipt_root: str = DEFAULT_RECEIPT_ROOT,
    lock_path: str = DEFAULT_LOCK_PATH,
    now_ms: int | None = None,
) -> dict:
    evidence = read_stage_evidence(slot, trust_path, channel_bin)
    timestamp = int(time.time() * 1000) if now_ms is None else now_ms
    receipt = receipt_from_stage_evidence(evidence, timestamp)
    return commit_verified_receipt(
        receipt,
        inventory_path=inventory_path,
        receipt_root=receipt_root,
        lock_path=lock_path,
    )
