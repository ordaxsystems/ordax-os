#!/usr/bin/env python3
"""Canonical SHA-256-pinned BusyBox download for both OS bootstrap consumers.

An alternate HTTPS transport is not another source authority: every response
must contain the exact archive identified by the existing per-consumer pin.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re
import shutil
import time
import urllib.error
import urllib.request

VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")


class PinnedBusyBoxSourceError(RuntimeError):
    pass


def hash_file(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def download(source: dict, destination: Path) -> Path:
    version = source.get("version")
    digest = source.get("archive_sha256")
    primary = source.get("archive_url")
    if (not isinstance(version, str) or not VERSION.fullmatch(version)
            or not isinstance(digest, str) or not SHA256.fullmatch(digest)):
        raise PinnedBusyBoxSourceError("invalid canonical BusyBox source pin")
    expected_primary = f"https://busybox.net/downloads/busybox-{version}.tar.bz2"
    if primary != expected_primary:
        raise PinnedBusyBoxSourceError("BusyBox primary source changed outside canonical transport")
    alternate = f"https://sources.buildroot.net/busybox/busybox-{version}.tar.bz2"
    archive = destination / f"busybox-{version}.tar.bz2"
    if archive.is_symlink() or destination.is_symlink():
        raise PinnedBusyBoxSourceError("BusyBox source cache must not be a symlink")
    if archive.is_file() and hash_file(archive) == digest:
        return archive
    destination.mkdir(parents=True, exist_ok=True)
    part = archive.with_suffix(archive.suffix + f".part.{os.getpid()}")
    # Keep total bounded. The alternate host carries the *same* pinned bytes.
    for index, (url, timeout) in enumerate((
            (primary, 20), (alternate, 40), (primary, 55)), start=1):
        part.unlink(missing_ok=True)
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response, part.open("wb") as output:
                shutil.copyfileobj(response, output, length=1024 * 1024)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            part.unlink(missing_ok=True)
            if index == 3:
                raise PinnedBusyBoxSourceError(
                    f"BusyBox download failed after {index} attempts: {exc}") from exc
            time.sleep(index)
            continue
        actual = hash_file(part)
        if actual != digest:
            part.unlink(missing_ok=True)
            raise PinnedBusyBoxSourceError(
                f"BusyBox digest mismatch: expected={digest} actual={actual}")
        part.replace(archive)
        return archive
    raise PinnedBusyBoxSourceError("BusyBox source transport exhausted")
