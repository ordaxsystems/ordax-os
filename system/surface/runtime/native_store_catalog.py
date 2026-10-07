"""Fail-closed Native Store catalog verification and anti-replay state.

This module owns only the persistent acceptance watermark for an already
cryptographically verified Store catalog. Cryptographic verification remains in
ordax-runtime-component-channel; Store UI/lifecycle authority remain elsewhere.
"""

from __future__ import annotations

from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
from typing import Callable

VERIFIED_SCHEMA = "ordax.verified-app-store-catalog/1"
WATERMARK_SCHEMA = "ordax.store-catalog-watermark/1"
SOURCE_REPOSITORY = "washingtonmsdj/ordax-apps"
TRUST_DOMAIN = "runtime-components"
KEY_ID = "ordax-runtime-components-v1"
MAX_VERIFIED_BYTES = 2 * 1024 * 1024
MAX_WATERMARK_BYTES = 16 * 1024
MAX_ENTRIES = 128
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
APP_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")


class StoreCatalogError(RuntimeError):
    pass


class StoreCatalogReplayError(StoreCatalogError):
    pass


def _canonical_json(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")


def _real_regular_file(path: Path, label: str, max_bytes: int | None = None) -> os.stat_result:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise StoreCatalogError(f"{label} is unavailable") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise StoreCatalogError(f"{label} must be a regular non-symlink file")
    if max_bytes is not None and (metadata.st_size <= 0 or metadata.st_size > max_bytes):
        raise StoreCatalogError(f"{label} size is outside allowed bounds")
    return metadata


def _real_directory(path: Path, label: str) -> Path:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise StoreCatalogError(f"{label} is unavailable") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise StoreCatalogError(f"{label} must be a real directory")
    resolved = path.resolve(strict=True)
    if resolved != path.absolute():
        raise StoreCatalogError(f"{label} may not traverse symlinks")
    return resolved


def _read_json(path: Path, label: str, max_bytes: int) -> dict:
    _real_regular_file(path, label, max_bytes)
    try:
        payload = path.read_bytes()
        value = json.loads(payload.decode("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise StoreCatalogError(f"{label} must be valid UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise StoreCatalogError(f"{label} must contain a JSON object")
    return value


def _validate_artifact(value: object, label: str) -> None:
    if not isinstance(value, dict) or set(value) != {"name", "sha256", "size"}:
        raise StoreCatalogError(f"{label} fields are not canonical")
    name = value.get("name")
    digest = value.get("sha256")
    size = value.get("size")
    if (
        not isinstance(name, str)
        or not name
        or "/" in name
        or "\\" in name
        or not isinstance(digest, str)
        or not SHA256_RE.fullmatch(digest)
        or not isinstance(size, int)
        or isinstance(size, bool)
        or size <= 0
    ):
        raise StoreCatalogError(f"{label} identity is invalid")


def validate_verified_catalog(value: object) -> dict:
    if not isinstance(value, dict):
        raise StoreCatalogError("verified Store catalog must be an object")
    if set(value) != {
        "schema", "state", "sequence", "catalogSha256", "source",
        "trust", "entries", "reason", "authority",
    }:
        raise StoreCatalogError("verified Store catalog fields are not canonical")
    if value.get("schema") != VERIFIED_SCHEMA or value.get("state") != "ready":
        raise StoreCatalogError("verified Store catalog identity is invalid")
    if value.get("authority") != "none" or value.get("reason") is not None:
        raise StoreCatalogError("verified Store catalog must remain ready and authority:none")

    sequence = value.get("sequence")
    digest = value.get("catalogSha256")
    if (
        not isinstance(sequence, int)
        or isinstance(sequence, bool)
        or sequence <= 0
        or not isinstance(digest, str)
        or not SHA256_RE.fullmatch(digest)
    ):
        raise StoreCatalogError("verified Store catalog publication identity is invalid")

    source = value.get("source")
    if (
        not isinstance(source, dict)
        or set(source) != {"repository", "commit"}
        or source.get("repository") != SOURCE_REPOSITORY
        or not isinstance(source.get("commit"), str)
        or not COMMIT_RE.fullmatch(source["commit"])
    ):
        raise StoreCatalogError("verified Store catalog source is not canonical")

    trust = value.get("trust")
    if trust != {"domain": TRUST_DOMAIN, "keyId": KEY_ID}:
        raise StoreCatalogError("verified Store catalog trust identity is not canonical")

    entries = value.get("entries")
    if not isinstance(entries, list) or not entries or len(entries) > MAX_ENTRIES:
        raise StoreCatalogError("verified Store catalog entries must be bounded and non-empty")
    ids: list[str] = []
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {
            "appId", "title", "version", "releaseMode", "sourceCommit", "artifacts"
        }:
            raise StoreCatalogError("verified Store catalog entry fields are not canonical")
        app_id = entry.get("appId")
        title = entry.get("title")
        version = entry.get("version")
        source_commit = entry.get("sourceCommit")
        if (
            not isinstance(app_id, str)
            or not APP_ID_RE.fullmatch(app_id)
            or not isinstance(title, str)
            or not title
            or title != title.strip()
            or len(title) > 160
            or not isinstance(version, str)
            or not version
            or entry.get("releaseMode") != "component-slot"
            or source_commit != source["commit"]
        ):
            raise StoreCatalogError("verified Store catalog entry identity is invalid")
        artifacts = entry.get("artifacts")
        if not isinstance(artifacts, dict) or set(artifacts) != {"package", "release", "compatibility", "componentEnvelope"}:
            raise StoreCatalogError("verified Store catalog artifacts are not canonical")
        _validate_artifact(artifacts["package"], f"{app_id} package")
        _validate_artifact(artifacts["release"], f"{app_id} release")
        _validate_artifact(artifacts["compatibility"], f"{app_id} compatibility")
        _validate_artifact(artifacts["componentEnvelope"], f"{app_id} component envelope")
        if artifacts["componentEnvelope"]["name"] != f"{app_id}.runtime-component-envelope.json":
            raise StoreCatalogError("verified Store catalog component envelope name is not canonical")
        ids.append(app_id)
    if ids != sorted(ids) or len(ids) != len(set(ids)):
        raise StoreCatalogError("verified Store catalog app ids must be sorted and unique")
    return value


def validate_watermark(value: object) -> dict:
    if not isinstance(value, dict) or set(value) != {"schema", "sequence", "catalogSha256"}:
        raise StoreCatalogError("Store catalog watermark fields are not canonical")
    sequence = value.get("sequence")
    digest = value.get("catalogSha256")
    if (
        value.get("schema") != WATERMARK_SCHEMA
        or not isinstance(sequence, int)
        or isinstance(sequence, bool)
        or sequence <= 0
        or not isinstance(digest, str)
        or not SHA256_RE.fullmatch(digest)
    ):
        raise StoreCatalogError("Store catalog watermark identity is invalid")
    return value


@contextmanager
def _watermark_lock(path: Path):
    parent = _real_directory(path.parent, "Store catalog watermark parent")
    lock_path = parent / f".{path.name}.lock"
    flags = os.O_RDWR | os.O_CREAT
    if hasattr(os, "O_CLOEXEC"):
        flags |= os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(lock_path, flags, 0o600)
    except OSError as exc:
        raise StoreCatalogError("Store catalog watermark lock is unavailable") from exc
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise StoreCatalogError("Store catalog watermark lock must be a regular file")
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield
    except OSError as exc:
        raise StoreCatalogError("Store catalog watermark lock failed") from exc
    finally:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        finally:
            os.close(descriptor)


def _load_watermark(path: Path) -> dict | None:
    try:
        path.lstat()
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise StoreCatalogError("Store catalog watermark is unavailable") from exc
    return validate_watermark(_read_json(path, "Store catalog watermark", MAX_WATERMARK_BYTES))


def _persist_watermark(path: Path, value: dict) -> None:
    parent = _real_directory(path.parent, "Store catalog watermark parent")
    if path.exists() or path.is_symlink():
        _real_regular_file(path, "Store catalog watermark", MAX_WATERMARK_BYTES)
    payload = _canonical_json(value)
    temporary = parent / f".{path.name}.tmp.{os.getpid()}"
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        if os.name != "nt":
            directory_fd = os.open(parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
    except OSError as exc:
        try:
            temporary.unlink()
        except OSError:
            pass
        raise StoreCatalogError("Store catalog watermark persistence failed") from exc


def accept_verified_catalog(value: object, watermark_path: Path) -> tuple[dict, bool]:
    catalog = validate_verified_catalog(value)
    with _watermark_lock(watermark_path):
        current = _load_watermark(watermark_path)
        if current is not None:
            if catalog["sequence"] < current["sequence"]:
                raise StoreCatalogReplayError("Store catalog sequence rollback detected")
            if catalog["sequence"] == current["sequence"]:
                if catalog["catalogSha256"] != current["catalogSha256"]:
                    raise StoreCatalogReplayError("Store catalog sequence equivocation detected")
                return catalog, False

        next_watermark = {
            "schema": WATERMARK_SCHEMA,
            "sequence": catalog["sequence"],
            "catalogSha256": catalog["catalogSha256"],
        }
        _persist_watermark(watermark_path, next_watermark)
        persisted = _load_watermark(watermark_path)
        if persisted != next_watermark:
            raise StoreCatalogError("Store catalog watermark persistence verification failed")
        return catalog, True


def verify_and_accept_store_catalog(
    *,
    helper_path: Path,
    trust_path: Path,
    envelope_path: Path,
    watermark_path: Path,
    runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
) -> tuple[dict, bool]:
    helper = _real_regular_file(helper_path, "runtime component channel")
    if os.name != "nt" and helper.st_mode & 0o111 == 0:
        raise StoreCatalogError("runtime component channel is not executable")
    _real_regular_file(trust_path, "runtime component trust", 16 * 1024)
    _real_regular_file(envelope_path, "Store catalog envelope", 4 * 1024 * 1024)
    _real_directory(watermark_path.parent, "Store catalog watermark parent")

    with tempfile.TemporaryDirectory(prefix="ordax-store-catalog-") as directory:
        verified_path = Path(directory) / "verified-store-catalog.json"
        try:
            completed = runner(
                [
                    str(helper_path),
                    "verify-store-catalog",
                    "--envelope",
                    str(envelope_path),
                    "--trust",
                    str(trust_path),
                    "--out",
                    str(verified_path),
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=10,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise StoreCatalogError("Store catalog verifier is unavailable") from exc
        if completed.returncode != 0:
            raise StoreCatalogError("Store catalog cryptographic verification failed")
        verified = _read_json(verified_path, "verified Store catalog", MAX_VERIFIED_BYTES)
        return accept_verified_catalog(verified, watermark_path)



def unavailable_verified_catalog(reason: str) -> dict:
    if (
        not isinstance(reason, str)
        or not reason
        or reason != reason.strip()
        or len(reason) > 256
    ):
        raise StoreCatalogError("verified Store catalog unavailable reason is invalid")
    return {
        "schema": VERIFIED_SCHEMA,
        "state": "unavailable",
        "sequence": None,
        "catalogSha256": None,
        "source": None,
        "trust": None,
        "entries": [],
        "reason": reason,
        "authority": "none",
    }


def read_native_store_catalog_snapshot(
    *,
    helper_path: Path,
    trust_path: Path,
    envelope_path: Path,
    watermark_path: Path,
    runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
) -> dict:
    try:
        envelope_path.lstat()
    except FileNotFoundError:
        return unavailable_verified_catalog("catalog-envelope-unavailable")
    except OSError:
        return unavailable_verified_catalog("catalog-envelope-unavailable")

    try:
        accepted, _changed = verify_and_accept_store_catalog(
            helper_path=helper_path,
            trust_path=trust_path,
            envelope_path=envelope_path,
            watermark_path=watermark_path,
            runner=runner,
        )
        return accepted
    except StoreCatalogReplayError:
        return unavailable_verified_catalog("catalog-replay-rejected")
    except StoreCatalogError:
        return unavailable_verified_catalog("catalog-verification-unavailable")
