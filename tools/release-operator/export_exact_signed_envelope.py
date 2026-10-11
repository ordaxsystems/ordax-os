#!/usr/bin/env python3
"""Export the exact approved Stable v4 envelope Git blob without checkout newline conversion.

Never signs, publishes, authorizes writes, opens devices or promotes a release.
"""
from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys

HEX40 = re.compile(r"^[0-9a-f]{40}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")


class EnvelopeExportError(ValueError):
    pass


def git(repo: Path, *args: str) -> bytes:
    try:
        result = subprocess.run(
            ["git", "-C", str(repo), *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise EnvelopeExportError("canonical Git blob cannot be read") from exc
    return result.stdout


def export_envelope(repo: Path, source_commit: str, expected_sha256: str, output: Path) -> str:
    if HEX40.fullmatch(source_commit) is None or HEX64.fullmatch(expected_sha256) is None:
        raise EnvelopeExportError("invalid frozen source or expected SHA-256")
    path = "docs/evidence/canonical-v4-signed-envelope-" + source_commit + ".json"
    entry = git(repo, "ls-tree", "-z", "HEAD", "--", path)
    expected_prefix = b"100644 blob "
    if not entry.startswith(expected_prefix) or not entry.endswith(b"\x00"):
        raise EnvelopeExportError("signed envelope is not a regular blob in HEAD")
    header, separator, tracked_path = entry[:-1].partition(b"\t")
    if separator != b"\t" or tracked_path.decode("ascii", errors="replace") != path:
        raise EnvelopeExportError("signed envelope tree path is invalid")
    object_id = header[len(expected_prefix):].decode("ascii")
    if re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", object_id) is None:
        raise EnvelopeExportError("signed envelope Git object ID is invalid")
    payload = git(repo, "cat-file", "blob", object_id)
    actual_sha = hashlib.sha256(payload).hexdigest()
    if actual_sha != expected_sha256:
        raise EnvelopeExportError("approved envelope blob SHA-256 mismatch")
    # O_EXCL means an existing file or symlink cannot be silently replaced.
    # Binary descriptor I/O avoids PowerShell text conversion on Windows.
    try:
        descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except OSError as exc:
        raise EnvelopeExportError("envelope output must be absent and writable") from exc
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        output.unlink(missing_ok=True)
        raise
    return actual_sha


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        export_envelope(args.repo_root, args.source_commit, args.expected_sha256, args.output)
    except EnvelopeExportError as exc:
        print("EXACT_SIGNED_ENVELOPE_GIT_BLOB=BLOCKED: " + str(exc), file=sys.stderr)
        return 2
    print("EXACT_SIGNED_ENVELOPE_GIT_BLOB_VERIFIED=YES")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
