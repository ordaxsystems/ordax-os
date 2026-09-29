#!/usr/bin/env python3
"""Execute build commands in an ephemeral container imported from a locked rootfs.

The container image is not a product artifact. Its only input is the already
reconstructed OrdaX Alpine rootfs. Runtime execution is networkless, read-only,
capability-free and exposes only one caller-owned writable /build bind mount.
"""

from __future__ import annotations

import os
from pathlib import Path
import re
import shutil
import subprocess

SAFE_TAG_RE = re.compile(r"^[a-z0-9][a-z0-9._/-]{0,127}$")


class LockedRootfsContainerError(RuntimeError):
    pass


def run_host(argv: list[str], *, capture: bool = False, stdin=None) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            argv,
            check=True,
            text=True,
            capture_output=capture,
            stdin=stdin,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        command = " ".join(argv)
        detail = ""
        if isinstance(exc, subprocess.CalledProcessError):
            output = (exc.stderr or exc.stdout or "").strip()
            if output:
                detail = ": " + output[-5000:]
        else:
            detail = f": {exc}"
        raise LockedRootfsContainerError(f"host command failed: {command}{detail}") from exc


def require_docker() -> str:
    docker = shutil.which("docker")
    if not docker:
        raise LockedRootfsContainerError("docker is required for locked rootfs build execution")
    completed = run_host([docker, "version", "--format", "{{.Server.Version}}"], capture=True)
    version = completed.stdout.strip()
    if not version:
        raise LockedRootfsContainerError("docker server version is unavailable")
    return version


def import_locked_rootfs(rootfs: Path, tag: str) -> str:
    docker = shutil.which("docker")
    tar = shutil.which("tar")
    if not docker or not tar:
        raise LockedRootfsContainerError("docker and tar are required for rootfs import")
    if not rootfs.is_dir():
        raise LockedRootfsContainerError("locked rootfs directory is missing")
    if not SAFE_TAG_RE.fullmatch(tag):
        raise LockedRootfsContainerError("unsafe ephemeral image tag")

    tar_process = subprocess.Popen(
        [tar, "--numeric-owner", "-C", str(rootfs), "-cf", "-", "."],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert tar_process.stdout is not None
    try:
        imported = subprocess.run(
            [docker, "import", "-", tag],
            stdin=tar_process.stdout,
            check=False,
            text=True,
            capture_output=True,
        )
    finally:
        tar_process.stdout.close()
    tar_stderr = tar_process.stderr.read().decode("utf-8", errors="replace") if tar_process.stderr else ""
    tar_rc = tar_process.wait()
    if tar_rc != 0:
        raise LockedRootfsContainerError(f"locked rootfs tar stream failed ({tar_rc}): {tar_stderr[-5000:]}")
    if imported.returncode != 0:
        raise LockedRootfsContainerError(
            f"docker import failed ({imported.returncode}): {(imported.stderr or imported.stdout)[-5000:]}"
        )
    image_id = imported.stdout.strip()
    if not image_id.startswith("sha256:"):
        raise LockedRootfsContainerError("docker import did not return an image identity")
    return image_id


def run_locked(
    image: str,
    build_dir: Path,
    command: str,
    *,
    capture: bool = False,
) -> subprocess.CompletedProcess:
    docker = shutil.which("docker")
    if not docker:
        raise LockedRootfsContainerError("docker is required for locked rootfs execution")
    build_dir = build_dir.resolve()
    if not build_dir.is_dir():
        raise LockedRootfsContainerError("container build directory is missing")
    uid = os.getuid()
    gid = os.getgid()
    argv = [
        docker,
        "run",
        "--rm",
        "--network", "none",
        "--read-only",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--pids-limit", "2048",
        "--user", f"{uid}:{gid}",
        "--tmpfs", "/tmp:rw,nosuid,nodev,mode=1777,size=536870912",
        "--mount", f"type=bind,src={build_dir},dst=/build",
        "--workdir", "/build",
        "--env", "HOME=/tmp",
        image,
        "/bin/sh",
        "-ec",
        command,
    ]
    try:
        return subprocess.run(argv, check=True, text=True, capture_output=capture)
    except (OSError, subprocess.CalledProcessError) as exc:
        detail = ""
        if isinstance(exc, subprocess.CalledProcessError):
            output = (exc.stderr or exc.stdout or "").strip()
            if output:
                detail = ": " + output[-8000:]
        else:
            detail = f": {exc}"
        raise LockedRootfsContainerError(f"locked container command failed{detail}") from exc


def remove_image(tag: str) -> None:
    docker = shutil.which("docker")
    if not docker:
        return
    subprocess.run(
        [docker, "image", "rm", "--force", tag],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
