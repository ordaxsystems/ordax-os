#!/usr/bin/env python3
"""Content-addressed Native artifact store for verified first-party app delivery.

This owner is transport-neutral. It never accepts URLs, never selects versions,
never verifies signatures and never activates components. Callers must provide
artifact identities already derived from a verified Store lifecycle plan.
"""

from __future__ import annotations

from contextlib import contextmanager
import fcntl
import hashlib
import os
from pathlib import Path
import re
import stat
import tempfile
from typing import Callable

DEFAULT_ARTIFACT_ROOT = "/var/lib/ordax/app-install/artifacts/v1"
MAX_ARTIFACT_BYTES = 32 * 1024 * 1024
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")


class AppArtifactStoreError(RuntimeError):
    pass


def validate_artifact_identity(value: object) -> dict:
    if not isinstance(value, dict) or set(value) != {"name", "sha256", "size"}:
        raise AppArtifactStoreError("artifact identity fields are not canonical")
    name = value.get("name")
    digest = value.get("sha256")
    size = value.get("size")
    if (
        not isinstance(name, str)
        or not NAME_RE.fullmatch(name)
        or not isinstance(digest, str)
        or not SHA256_RE.fullmatch(digest)
        or not isinstance(size, int)
        or isinstance(size, bool)
        or size <= 0
        or size > MAX_ARTIFACT_BYTES
    ):
        raise AppArtifactStoreError("artifact identity is invalid")
    return {"name": name, "sha256": digest, "size": size}


def _real_directory(path: Path, label: str, *, private: bool = False) -> Path:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise AppArtifactStoreError(f"{label} is unavailable") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise AppArtifactStoreError(f"{label} must be a real directory")
    resolved = path.resolve(strict=True)
    if resolved != path.absolute():
        raise AppArtifactStoreError(f"{label} may not traverse symlinks")
    if private and os.name != "nt" and stat.S_IMODE(metadata.st_mode) != 0o700:
        raise AppArtifactStoreError(f"{label} permissions are not private")
    return resolved


def _ensure_store_root(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    return _real_directory(root, "app artifact store root", private=True)


def _artifact_path(root: Path, digest: str) -> Path:
    return root / "sha256" / digest[:2] / digest


def _ensure_digest_parent(root: Path, digest: str) -> Path:
    sha_root = root / "sha256"
    sha_root.mkdir(mode=0o700, exist_ok=True)
    _real_directory(sha_root, "app artifact sha256 root", private=True)
    prefix = sha_root / digest[:2]
    prefix.mkdir(mode=0o700, exist_ok=True)
    return _real_directory(prefix, "app artifact digest parent", private=True)


@contextmanager
def _artifact_lock(root: Path, digest: str):
    locks = root / ".locks"
    locks.mkdir(mode=0o700, exist_ok=True)
    locks = _real_directory(locks, "app artifact lock root", private=True)
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    lock_path = locks / f"{digest}.lock"
    try:
        fd = os.open(lock_path, flags, 0o600)
    except OSError as exc:
        raise AppArtifactStoreError("app artifact lock is unavailable") from exc
    try:
        metadata = os.fstat(fd)
        if not stat.S_ISREG(metadata.st_mode):
            raise AppArtifactStoreError("app artifact lock must be a regular file")
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    except OSError as exc:
        raise AppArtifactStoreError("app artifact lock failed") from exc
    finally:
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)


def _read_verified_path(path: Path, identity: dict) -> bytes:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise AppArtifactStoreError("cached app artifact is unavailable or unsafe") from exc
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise AppArtifactStoreError("cached app artifact must be a regular file")
        if metadata.st_nlink != 1:
            raise AppArtifactStoreError("cached app artifact must have one hardlink")
        if os.name != "nt" and stat.S_IMODE(metadata.st_mode) != 0o400:
            raise AppArtifactStoreError("cached app artifact permissions are not read-only private")
        if metadata.st_size != identity["size"]:
            raise AppArtifactStoreError("cached app artifact size mismatch")
        payload = bytearray()
        while len(payload) < identity["size"]:
            chunk = os.read(descriptor, min(1024 * 1024, identity["size"] - len(payload)))
            if not chunk:
                break
            payload.extend(chunk)
        if len(payload) != identity["size"] or os.read(descriptor, 1):
            raise AppArtifactStoreError("cached app artifact changed while reading")
        result = bytes(payload)
    finally:
        os.close(descriptor)
    if hashlib.sha256(result).hexdigest() != identity["sha256"]:
        raise AppArtifactStoreError("cached app artifact digest mismatch")
    return result


def read_cached_artifact(identity: object, *, root: str = DEFAULT_ARTIFACT_ROOT) -> bytes:
    normalized = validate_artifact_identity(identity)
    store = _ensure_store_root(Path(root))
    return _read_verified_path(_artifact_path(store, normalized["sha256"]), normalized)


def store_verified_artifact(
    identity: object,
    payload: bytes,
    *,
    root: str = DEFAULT_ARTIFACT_ROOT,
) -> Path:
    normalized = validate_artifact_identity(identity)
    if not isinstance(payload, bytes):
        raise AppArtifactStoreError("artifact payload must be bytes")
    if (
        len(payload) != normalized["size"]
        or hashlib.sha256(payload).hexdigest() != normalized["sha256"]
    ):
        raise AppArtifactStoreError("artifact payload does not match verified identity")

    store = _ensure_store_root(Path(root))
    _ensure_digest_parent(store, normalized["sha256"])
    target = _artifact_path(store, normalized["sha256"])

    with _artifact_lock(store, normalized["sha256"]):
        if target.exists() or target.is_symlink():
            _read_verified_path(target, normalized)
            return target

        parent = _real_directory(target.parent, "app artifact digest parent", private=True)
        fd, temporary_name = tempfile.mkstemp(prefix=".artifact-", dir=parent)
        temporary = Path(temporary_name)
        try:
            os.fchmod(fd, 0o400)
            with os.fdopen(fd, "wb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            # Publish without replacing another writer's artifact. A digest
            # lock coordinates our callers, but a racing process may not obey
            # that lock: os.replace() would clobber its target. Atomic hardlink
            # creation is O_EXCL-like on the same private filesystem. Drop the
            # staging name before verifying the target's single-link metadata.
            os.link(temporary, target)
            temporary.unlink()
            if os.name != "nt":
                directory_fd = os.open(parent, os.O_RDONLY | getattr(os, "O_CLOEXEC", 0))
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
        except OSError as exc:
            try:
                os.close(fd)
            except OSError:
                pass
            try:
                temporary.unlink()
            except OSError:
                pass
            raise AppArtifactStoreError("app artifact persistence failed") from exc

        _read_verified_path(target, normalized)
        return target


def acquire_verified_artifact(
    identity: object,
    *,
    loader: Callable[[dict], bytes],
    root: str = DEFAULT_ARTIFACT_ROOT,
) -> tuple[Path, bool]:
    normalized = validate_artifact_identity(identity)
    if not callable(loader):
        raise AppArtifactStoreError("artifact loader is unavailable")
    store = _ensure_store_root(Path(root))
    target = _artifact_path(store, normalized["sha256"])
    if target.exists() or target.is_symlink():
        _read_verified_path(target, normalized)
        return target, False

    try:
        payload = loader(dict(normalized))
    except Exception as exc:
        raise AppArtifactStoreError("artifact acquisition provider failed") from exc
    path = store_verified_artifact(normalized, payload, root=str(store))
    return path, True


def acquire_verified_artifact_set(
    artifacts: object,
    *,
    loader: Callable[[dict], bytes],
    root: str = DEFAULT_ARTIFACT_ROOT,
) -> dict[str, str]:
    if not isinstance(artifacts, dict) or set(artifacts) != {
        "package", "release", "compatibility", "componentEnvelope"
    }:
        raise AppArtifactStoreError("verified artifact set is not canonical")

    resolved: dict[str, str] = {}
    for role in ("package", "release", "compatibility", "componentEnvelope"):
        identity = validate_artifact_identity(artifacts[role])
        path, _changed = acquire_verified_artifact(
            identity,
            loader=loader,
            root=root,
        )
        resolved[role] = str(path)
    return resolved
