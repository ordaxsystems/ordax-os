#!/usr/bin/env python3
"""Developer-only Windows USB transport for the canonical OrdaX Git source.

This is not a boot updater, release signer or raw-disk writer. Its only
permitted destination is ORDAX-DATA on a physically validated USB disk.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

REPO_URL = "https://github.com/ordaxsystems/ordax-os.git"
SCHEMA = "ordax.owner-dev-usb-git/1"
SHA = re.compile(r"[0-9a-f]{40}\Z")
DIGEST = re.compile(r"[0-9a-f]{64}\Z")
MAX_BUNDLE = 1_000_000_000
SUBDIR = Path(".ordax") / "updates" / "owner-git"
BASE_SUBDIR = Path(".ordax") / "updates" / "owner-base"
BASE_FILES = ("dev-base.json", "vmlinuz", "initrd.gz", "rootfs.tar")
BUNDLE = "ordax-main.bundle"
MANIFEST = "owner-git-bundle.txt"
UPDATE_REQUEST = "owner-git-update-request.txt"
UPDATE_REQUEST_SCHEMA = "ordax.owner-usb-update-request/1"


class DeliveryError(RuntimeError):
    pass


@contextmanager
def exclusive_transport():
    """The GUI and the existing Windows task share one Owner USB writer."""
    if os.name != "nt":
        yield
        return
    import msvcrt
    root = Path.home() / "AppData" / "Local" / "OrdaX-Creator"
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock = root / "owner-usb-git.lock"
    if lock.is_symlink() or (hasattr(lock, "is_junction") and lock.is_junction()):
        raise DeliveryError("unsafe USB transport lock path")
    with lock.open("a+b") as handle:
        # LockFile permits a byte-range beyond EOF. Do not read or modify
        # the locked byte: Windows denies even same-process reads while it is
        # held by another descriptor. Only the kernel owns this mutex.
        handle.seek(0)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError as exc:
            raise DeliveryError("Owner USB transport already running") from exc
        try:
            yield
        finally:
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)


def _windows_git_job(argv: list[str], timeout: int) -> str:
    """Bound Git and its pack-objects descendants to one native Windows Job.

    Killing only git.exe on timeout can orphan pack-objects and leave a
    permanent .bundle.lock. Closing the Job handle terminates its descendants.
    This scope never includes the Creator, its task or another Git invocation.
    """
    import ctypes.wintypes as wt

    class BasicLimit(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_int64),
            ("PerJobUserTimeLimit", ctypes.c_int64),
            ("LimitFlags", wt.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wt.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wt.DWORD),
            ("SchedulingClass", wt.DWORD),
        ]

    class IOCounters(ctypes.Structure):
        _fields_ = [
            ("ReadOperationCount", ctypes.c_uint64),
            ("WriteOperationCount", ctypes.c_uint64),
            ("OtherOperationCount", ctypes.c_uint64),
            ("ReadTransferCount", ctypes.c_uint64),
            ("WriteTransferCount", ctypes.c_uint64),
            ("OtherTransferCount", ctypes.c_uint64),
        ]

    class ExtendedLimit(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", BasicLimit),
            ("IoInfo", IOCounters),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes = (ctypes.c_void_p, wt.LPCWSTR)
    kernel.CreateJobObjectW.restype = ctypes.c_void_p
    kernel.SetInformationJobObject.argtypes = (
        ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, wt.DWORD,
    )
    kernel.SetInformationJobObject.restype = wt.BOOL
    kernel.AssignProcessToJobObject.argtypes = (ctypes.c_void_p, ctypes.c_void_p)
    kernel.AssignProcessToJobObject.restype = wt.BOOL
    kernel.CloseHandle.argtypes = (ctypes.c_void_p,)
    kernel.CloseHandle.restype = wt.BOOL

    job = kernel.CreateJobObjectW(None, None)
    if not job:
        raise DeliveryError("cannot create bounded Windows Git job")
    process = None
    try:
        limits = ExtendedLimit()
        limits.BasicLimitInformation.LimitFlags = 0x2000  # KILL_ON_JOB_CLOSE
        if not kernel.SetInformationJobObject(
            job, 9, ctypes.byref(limits), ctypes.sizeof(limits)
        ):
            raise DeliveryError("cannot constrain Windows Git process tree")
        process = subprocess.Popen(
            argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, creationflags=subprocess.CREATE_NO_WINDOW,
        )
        if not kernel.AssignProcessToJobObject(job, ctypes.c_void_p(int(process._handle))):
            raise DeliveryError("cannot assign Git descendants to bounded Windows job")
        stdout, stderr = process.communicate(timeout=timeout)
        if process.returncode != 0:
            raise subprocess.CalledProcessError(
                process.returncode, argv, output=stdout, stderr=stderr,
            )
        return stdout.strip()
    finally:
        # Also on timeout, exception or assignment error: the OS kills all
        # process descendants before the exclusive USB transport lock releases.
        kernel.CloseHandle(job)
        if process is not None:
            try:
                process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate()


def git(repo: Path, *args: str, timeout=90) -> str:
    command = ["git", "-C", str(repo), *args]
    try:
        if os.name == "nt":
            return _windows_git_job(command, timeout)
        result = subprocess.run(command, text=True,
                                capture_output=True, check=True, timeout=timeout)
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired) as exc:
        raise DeliveryError("Git source or bundle verification failed") from exc
    return result.stdout.strip()


def source_commit(repo: Path) -> str:
    if repo.is_symlink() or not (repo / ".git").is_dir():
        raise DeliveryError("canonical OS checkout missing or linked")
    if git(repo, "remote", "get-url", "origin") != REPO_URL:
        raise DeliveryError("OS Git origin is not canonical")
    if git(repo, "branch", "--show-current") != "main":
        raise DeliveryError("OS Git checkout must be on main")
    if git(repo, "status", "--porcelain=v1"):
        raise DeliveryError("OS Git checkout contains pending edits")
    head = git(repo, "rev-parse", "HEAD")
    if not SHA.fullmatch(head):
        raise DeliveryError("OS Git HEAD is malformed")
    remote = git(repo, "ls-remote", "--heads", "origin", "refs/heads/main", timeout=40)
    if remote != head + "\trefs/heads/main":
        raise DeliveryError("OS checkout differs from current remote main")
    return head


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def manifest_bytes(commit: str, sha256: str, size: int) -> bytes:
    if not SHA.fullmatch(commit) or not DIGEST.fullmatch(sha256) or not 0 < size <= MAX_BUNDLE:
        raise DeliveryError("invalid offline Git provenance")
    return ("schema=" + SCHEMA + "\nrepository=ordaxsystems/ordax-os\n"
            + "source_commit=" + commit + "\n"
            + "bundle_sha256=" + sha256 + "\n"
            + "bundle_bytes=" + str(size) + "\n").encode("ascii")


def update_request_bytes(commit: str) -> bytes:
    # Owner intent only, NOT an offline signature or activation authorization.
    if not SHA.fullmatch(commit):
        raise DeliveryError("Owner USB update request SHA is invalid")
    return (f"schema={UPDATE_REQUEST_SCHEMA}\n"
            f"source_commit={commit}\n").encode("ascii")


def arm_update_request(target: Path, commit: str, digest: str, size: int) -> None:
    # Exact verified ORDAX-DATA transport, atomic and read back. The OS owns
    # activation after independent remote-main and health verification.
    if verified_local_bundle(target) != (commit, digest, size):
        raise DeliveryError("Owner USB update request requires a verified Git bundle")
    request = target / UPDATE_REQUEST
    pending = target / (UPDATE_REQUEST + ".pending")
    for member in (request, pending):
        if member.is_symlink() or (hasattr(member, "is_junction") and member.is_junction()):
            raise DeliveryError("Owner USB update request path is linked")
        if member.exists() and not member.is_file():
            raise DeliveryError("Owner USB update request path is not a regular file")
    payload = update_request_bytes(commit)
    try:
        with pending.open("wb") as dest:
            dest.write(payload)
            dest.flush()
            os.fsync(dest.fileno())
        os.replace(pending, request)
        if request.read_bytes() != payload:
            raise DeliveryError("Owner USB update request readback failed")
    finally:
        pending.unlink(missing_ok=True)


def verified_local_bundle(target: Path) -> tuple[str, str, int] | None:
    """Inspect only local Git transport bytes, never OS activation or provenance.

    This detects a consistent local cache, not a signed release or a commit
    authenticated against remote main. The OS retains that authority.
    """
    manifest = target / MANIFEST
    bundle = target / BUNDLE
    if manifest.is_symlink() or bundle.is_symlink():
        raise DeliveryError("Owner USB Git transport has an unsafe member")
    if not manifest.exists() and not bundle.exists():
        return None
    if not manifest.is_file() or not bundle.is_file():
        raise DeliveryError("Owner USB Git transport is incomplete")
    try:
        raw = manifest.read_bytes()
        lines = raw.splitlines(keepends=True)
        if len(lines) != 5 or any(not line.endswith(b"\n") or b"\r" in line for line in lines):
            raise DeliveryError("Owner USB Git transport manifest is malformed")
        expected = [b"schema=" + SCHEMA.encode("ascii"),
                    b"repository=ordaxsystems/ordax-os"]
        if [line.rstrip(b"\n") for line in lines[:2]] != expected:
            raise DeliveryError("Owner USB Git transport manifest authority differs")
        fields = [line.rstrip(b"\n").split(b"=", 1) for line in lines[2:]]
        if len(fields) != 3 or [item[0] for item in fields] != [
                b"source_commit", b"bundle_sha256", b"bundle_bytes"]:
            raise DeliveryError("Owner USB Git transport manifest fields are malformed")
        commit, digest, length = (item[1].decode("ascii") for item in fields)
        if not length.isdecimal() or str(int(length)) != length:
            raise DeliveryError("Owner USB Git transport length is malformed")
        size = int(length)
        if raw != manifest_bytes(commit, digest, size):
            raise DeliveryError("Owner USB Git transport manifest changed")
        if bundle.stat().st_size != size or sha256_file(bundle) != digest:
            raise DeliveryError("Owner USB Git transport integrity check failed")
        try:
            heads = subprocess.run(
                ["git", "bundle", "list-heads", str(bundle)],
                capture_output=True, text=True, check=True, timeout=30,
            ).stdout.strip()
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            raise DeliveryError("Owner USB Git bundle is not readable") from exc
        if heads != commit + " refs/heads/main":
            raise DeliveryError("Owner USB Git bundle head disagrees with manifest")
        return commit, digest, size
    except (UnicodeError, ValueError, OSError) as exc:
        raise DeliveryError("Owner USB Git transport cannot be verified") from exc


def existing_current(target: Path, commit: str) -> bool:
    try:
        value = verified_local_bundle(target)
        return value is not None and value[0] == commit
    except DeliveryError:
        return False


def build_bundle(repo: Path, destination: Path, commit: str) -> tuple[str, int]:
    git(repo, "-c", "pack.window=0", "-c", "pack.depth=0", "-c", "pack.compression=1", "bundle", "create", str(destination), "main", timeout=180)
    heads = git(repo, "bundle", "list-heads", str(destination))
    if heads != commit + " refs/heads/main":
        raise DeliveryError("bundle is not bound to one exact main revision")
    git(repo, "bundle", "verify", str(destination))
    size = destination.stat().st_size
    if size <= 0 or size > MAX_BUNDLE:
        raise DeliveryError("bundle exceeds bounded ORDAX-DATA budget")
    return sha256_file(destination), size


def checked_volume(letter: str) -> dict:
    """Verify the exact Owner USB through read-only native Windows disk APIs.

    Storage CIM Get-Partition/Get-Disk may block on removable disks. The
    kernel layout and volume extents are authoritative and require no UAC.
    """
    if not re.fullmatch(r"[A-Z]", letter):
        raise DeliveryError("USB destination requires one drive letter")
    if os.name != "nt":
        raise DeliveryError("Owner USB detection requires Windows")
    import struct
    import uuid

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateFileW.argtypes = [
        ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p,
        ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p,
    ]
    kernel.CreateFileW.restype = ctypes.c_void_p
    kernel.DeviceIoControl.argtypes = [
        ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32,
        ctypes.c_void_p, ctypes.c_uint32, ctypes.POINTER(ctypes.c_uint32),
        ctypes.c_void_p,
    ]
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]

    def read_ioctl(path: str, command: int, payload: bytes = b"") -> bytes:
        handle = kernel.CreateFileW(path, 0, 3, None, 3, 0, None)
        if handle == ctypes.c_void_p(-1).value:
            raise OSError(ctypes.get_last_error(), "disk metadata inaccessible")
        try:
            output = ctypes.create_string_buffer(8192)
            used = ctypes.c_uint32()
            request = ctypes.create_string_buffer(payload) if payload else None
            if not kernel.DeviceIoControl(
                ctypes.c_void_p(handle), command, request, len(payload),
                output, len(output), ctypes.byref(used), None,
            ):
                raise OSError(ctypes.get_last_error(), "disk metadata query failed")
            return output.raw[:used.value]
        finally:
            kernel.CloseHandle(ctypes.c_void_p(handle))

    def extent(drive: str) -> tuple[int, int, int]:
        raw = read_ioctl(rf"\\.\{drive}:", 0x560000)
        if len(raw) < 32 or struct.unpack_from("<I", raw)[0] != 1:
            raise DeliveryError("USB data volume requires one physical disk extent")
        return struct.unpack_from("<I4xqq", raw, 8)

    try:
        label = ctypes.create_unicode_buffer(256)
        fs = ctypes.create_unicode_buffer(256)
        serial = ctypes.c_uint32()
        maximum = ctypes.c_uint32()
        flags = ctypes.c_uint32()
        if not kernel.GetVolumeInformationW(
            letter + ":\\", label, len(label), ctypes.byref(serial),
            ctypes.byref(maximum), ctypes.byref(flags), fs, len(fs),
        ):
            raise OSError(ctypes.get_last_error(), "USB volume unreadable")
        disk, start, size = extent(letter)
        system_drive = (os.environ.get("SystemDrive") or "C:")[0].upper()
        system_disk, _, _ = extent(system_drive)
        layout = read_ioctl(rf"\\.\PhysicalDrive{disk}", 0x70050)
        if len(layout) < 48:
            raise DeliveryError("USB GPT layout missing")
        style, count = struct.unpack_from("<II", layout)
        if style != 1 or count != 3 or len(layout) < 48 + 144 * count:
            raise DeliveryError("USB does not contain the canonical GPT layout")
        parts = []
        for index in range(count):
            offset = 48 + 144 * index
            partition_style, first, length, number = struct.unpack_from(
                "<I4xqqI", layout, offset,
            )
            guid = str(uuid.UUID(bytes_le=layout[offset + 32:offset + 48]))
            if partition_style != 1 or number != index + 1 or first < 0 or length <= 0:
                raise DeliveryError("USB GPT partition metadata invalid")
            parts.append((number, first, length, guid))

        # STORAGE_DEVICE_DESCRIPTOR: get the physical USB serial and bus
        # from IOCTL_STORAGE_QUERY_PROPERTY (12-byte aligned query).
        descriptor = read_ioctl(
            rf"\\.\PhysicalDrive{disk}", 0x2d1400,
            struct.pack("<III", 0, 0, 0),
        )
        if len(descriptor) < 36:
            raise DeliveryError("USB storage descriptor missing")
        serial_offset = struct.unpack_from("<I", descriptor, 24)[0]
        bus_type = struct.unpack_from("<I", descriptor, 28)[0]
        if not 36 <= serial_offset < len(descriptor):
            raise DeliveryError("USB device serial is absent")
        physical_serial = descriptor[serial_offset:].split(b"\0", 1)[0].decode(
            "ascii", "strict",
        ).strip()
        device = {
            "Index": disk,
            "InterfaceType": "USB" if bus_type == 7 else "OTHER",
            "SerialNumber": physical_serial,
        }
    except (OSError, ValueError, TypeError, IndexError, struct.error) as exc:
        raise DeliveryError("physical USB identity could not be verified") from exc

    required = {
        "c12a7328-f81f-11d2-ba4b-00a0c93ec93b",
        "0fc63daf-8483-4772-8e79-3d69d8477de4",
        "ebd0a0a2-b9e5-4433-87c0-68b6b72699c7",
    }
    types = [part[3] for part in parts]
    if (
        {part[3] for part in parts} != required
        or parts[2][:3] != (3, start, size)
        or parts[2][3] != "ebd0a0a2-b9e5-4433-87c0-68b6b72699c7"
        or disk == system_disk
        or not isinstance(device, dict)
        or device.get("Index") != disk
        or device.get("InterfaceType") != "USB"
        or not str(device.get("SerialNumber") or "").strip()
        or label.value != "ORDAX-DATA" or fs.value != "exFAT"
    ):
        raise DeliveryError("target is not an authorized OrdaX development USB data volume")
    return {
        "disk": disk, "serial": str(device["SerialNumber"]).strip(),
        "bus": "USB", "style": "GPT", "label": label.value, "fs": fs.value,
        "systemDisk": system_disk, "partition": 3, "types": types,
    }


def enforce_selected_disk(identity: dict, expected: int | None) -> None:
    if expected is not None and (type(expected) is not int or expected < 0 or
                                 type(identity.get("disk")) is not int or identity["disk"] != expected):
        raise DeliveryError("USB disk number differs from the explicit Creator selection")


def ensure_real_ancestors(volume: Path, target: Path) -> None:
    current = volume
    for part in target.relative_to(volume).parts:
        current = current / part
        if current.exists() and (current.is_symlink() or
                                 (hasattr(current, "is_junction") and current.is_junction()) or
                                 not current.is_dir()):
            raise DeliveryError("USB update path is linked or not a directory")


def install_bundle(target: Path, bundle: Path, commit: str, digest: str, size: int) -> None:
    # Save manifest last: any interruption before that leaves mismatched data
    # that the OS verifier rejects. No raw block device is opened or formatted.
    if shutil.disk_usage(target.anchor).free < 2 * size + 32 * 1024 * 1024:
        raise DeliveryError("insufficient ORDAX-DATA free space for atomic transfer")
    target.mkdir(parents=True, exist_ok=True)
    temp_bundle = target / (BUNDLE + ".pending")
    temp_manifest = target / (MANIFEST + ".pending")
    for pending in (temp_bundle, temp_manifest):
        if pending.is_symlink() or (hasattr(pending, "is_junction") and pending.is_junction()):
            raise DeliveryError("unsafe USB pending path")
    try:
        with bundle.open("rb") as source, temp_bundle.open("wb") as dest:
            shutil.copyfileobj(source, dest, length=1024 * 1024)
            dest.flush()
            os.fsync(dest.fileno())
        if temp_bundle.stat().st_size != size or sha256_file(temp_bundle) != digest:
            raise DeliveryError("USB readback of Git bundle failed")
        with temp_manifest.open("wb") as dest:
            dest.write(manifest_bytes(commit, digest, size))
            dest.flush()
            os.fsync(dest.fileno())
        os.replace(temp_bundle, target / BUNDLE)
        os.replace(temp_manifest, target / MANIFEST)
        if not existing_current(target, commit):
            raise DeliveryError("final USB bundle readback failed")
    finally:
        temp_bundle.unlink(missing_ok=True)
        temp_manifest.unlink(missing_ok=True)


def available_ordax_data_letters() -> list[str]:
    """Read Windows volume labels cheaply; checked_volume owns disk identity."""
    if os.name != "nt":
        raise DeliveryError("automatic volume discovery requires Windows")
    from ctypes import wintypes
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    logical = kernel.GetLogicalDrives
    logical.restype = wintypes.DWORD
    volume_info = kernel.GetVolumeInformationW
    volume_info.argtypes = [
        wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(wintypes.DWORD),
        ctypes.POINTER(wintypes.DWORD), wintypes.LPWSTR, wintypes.DWORD]
    volume_info.restype = wintypes.BOOL
    drive_mask = logical()
    if not drive_mask:
        raise DeliveryError("cannot list Windows logical drives")
    matches = []
    for index in range(26):
        if not (drive_mask & (1 << index)):
            continue
        drive = chr(65 + index)
        path = drive + ":\\"
        label = ctypes.create_unicode_buffer(256)
        filesystem = ctypes.create_unicode_buffer(256)
        volume_serial = wintypes.DWORD()
        max_component = wintypes.DWORD()
        flags = wintypes.DWORD()
        if volume_info(path, label, len(label), ctypes.byref(volume_serial),
                       ctypes.byref(max_component), ctypes.byref(flags),
                       filesystem, len(filesystem)):
            if label.value == "ORDAX-DATA" and filesystem.value.lower() == "exfat":
                matches.append(drive)
    return matches


def discover_trusted_volume(expected_serial: str) -> str | None:
    """Find one locally authorized USB, never by drive letter or label alone."""
    if not re.fullmatch(r"[A-Za-z0-9._-]{4,64}", expected_serial):
        raise DeliveryError("authorized physical USB serial is malformed")
    matches = []
    for letter in available_ordax_data_letters():
        if not isinstance(letter, str) or not re.fullmatch(r"[A-Z]", letter):
            raise DeliveryError("malformed USB drive letter")
        try:
            current = checked_volume(letter)
        except DeliveryError:
            continue
        if str(current["serial"]).strip().casefold() == expected_serial.casefold():
            matches.append(letter)
    if len(matches) > 1:
        raise DeliveryError("multiple volumes claim the authorized USB serial")
    return matches[0] if matches else None


def stage_canonical_base(args: argparse.Namespace, volume: Path, letter: str,
                         before: dict) -> dict:
    """Media-only adapter; OS dev_channel.py owns the Base manifest and bytes.

    A local HTTPS-acquired candidate is imported using the *same* OS helper,
    so neither Creator nor this transport invents a Base validation policy.
    This does not write ESP, Linux ext4 or any boot selector.
    """
    if not args.apply or args.inspect or args.repo is not None:
        raise DeliveryError("Base transfer requires isolated non-activating apply")
    source = args.base_candidate_dir
    script = args.canonical_base_script
    sha = args.base_artifact_commit
    if (not isinstance(sha, str) or not SHA.fullmatch(sha)
            or source is None or script is None
            or not source.is_absolute() or not script.is_absolute()):
        raise DeliveryError("Base candidate must be pinned to canonical OS source")
    if (source.is_symlink() or not source.is_dir() or source.name != sha
            or script.is_symlink() or not script.is_file()):
        raise DeliveryError("verified Base candidate or OS helper is unavailable")
    if any((source / name).is_symlink() or not (source / name).is_file()
           for name in BASE_FILES):
        raise DeliveryError("verified Base candidate contains an unsafe file")
    target_root = volume / BASE_SUBDIR
    ensure_real_ancestors(volume, target_root)
    total = sum((source / name).stat().st_size for name in BASE_FILES)
    if (not (target_root / sha).is_dir() and
            shutil.disk_usage(volume).free <= total + 32 * 1024 * 1024):
        raise DeliveryError("insufficient ORDAX-DATA space for verified Base transport")
    # Revalidate the exact device again immediately before invoking OS-owned
    # file materialization; the output is never treated as an activation.
    if checked_volume(letter) != before:
        raise DeliveryError("physical USB identity changed before Base import")
    command = [
        sys.executable, "-I", str(script), "--source-commit", sha,
        "--destination-root", str(target_root),
        "--source-directory", str(source), "--import-only",
    ]
    try:
        result = subprocess.run(command, capture_output=True, timeout=600,
                                check=False, env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})
    except (OSError, subprocess.SubprocessError) as exc:
        raise DeliveryError("OS-owned Base import could not complete") from exc
    if result.returncode or not 0 < len(result.stdout) <= 4096:
        raise DeliveryError("OS-owned Base import refused the candidate")
    try:
        response = json.loads(result.stdout)
    except (UnicodeError, ValueError) as exc:
        raise DeliveryError("OS Base import returned invalid receipt") from exc
    if (response.get("status") != "imported-not-activated"
            or response.get("source_commit") != sha
            or response.get("path") != str(target_root / sha)
            or type(response.get("reused")) is not bool):
        raise DeliveryError("OS Base import did not attest exact on-USB bytes")
    if checked_volume(letter) != before:
        raise DeliveryError("physical USB identity changed after Base import")
    return {"status": "BASE_STAGED_NOT_ACTIVATED", "base_artifact_commit": sha,
            "reused": response["reused"]}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path)
    destination = parser.add_mutually_exclusive_group(required=True)
    destination.add_argument("--volume", help="ORDAX-DATA drive letter, e.g. E")
    destination.add_argument("--auto-volume", action="store_true",
                             help="discover only the locally authorized physical USB")
    parser.add_argument("--trusted-serial", help="USB serial selected locally, never in Git")
    parser.add_argument("--trusted-disk-number", type=int,
                        help="also require selected Windows physical disk number")
    parser.add_argument("--apply", action="store_true", help="stage only on verified USB data volume")
    parser.add_argument("--inspect", action="store_true", help="read-only integrity of local USB Git transport")
    parser.add_argument("--base-candidate-dir", type=Path,
                        help="canonical OS HTTPS-acquired immutable Base candidate")
    parser.add_argument("--canonical-base-script", type=Path,
                        help="exact OS main dev_channel.py exported by the Owner sync")
    parser.add_argument("--base-artifact-commit",
                        help="exact 40-hex OS-published Base source commit")
    args = parser.parse_args()
    base_flags = (args.base_candidate_dir, args.canonical_base_script, args.base_artifact_commit)
    if any(value is not None for value in base_flags) and not all(value is not None for value in base_flags):
        parser.error("Base import requires source directory, canonical OS helper and pinned SHA")
    try:
        with exclusive_transport():
            return deliver(args)
    except DeliveryError as exc:
        print("OWNER_USB_GIT_DELIVERY=BLOCKED:" + str(exc), file=sys.stderr)
        return 2


def deliver(args: argparse.Namespace) -> int:
    try:
        if args.inspect and args.apply:
            raise DeliveryError("inspection cannot write")
        if args.inspect and (not args.trusted_serial or args.trusted_disk_number is None):
            raise DeliveryError("inspection requires exact selected USB identity")
        if args.apply and not args.trusted_serial:
            raise DeliveryError("staging requires explicit locally authorized USB serial")
        if args.auto_volume:
            if not args.trusted_serial:
                raise DeliveryError("automatic USB discovery requires trusted serial")
            letter = discover_trusted_volume(args.trusted_serial)
            if letter is None:
                print(json.dumps({"status": "SKIP_TRUSTED_USB_NOT_PRESENT"}))
                return 0
        else:
            letter = args.volume.strip().upper().rstrip(":\\")
        before = checked_volume(letter)
        enforce_selected_disk(before, args.trusted_disk_number)
        if args.trusted_serial and str(before["serial"]).strip().casefold() != args.trusted_serial.casefold():
            raise DeliveryError("USB serial differs from locally authorized device")
        volume = Path(letter + ":\\")
        target = volume / SUBDIR
        ensure_real_ancestors(volume, target)
        if getattr(args, "base_candidate_dir", None) is not None:
            print(json.dumps(stage_canonical_base(args, volume, letter, before)))
            return 0
        if args.inspect:
            local = verified_local_bundle(target)
            if checked_volume(letter) != before:
                raise DeliveryError("physical USB identity changed during inspection")
            if local is None:
                print(json.dumps({"status": "GIT_BUNDLE_NOT_STAGED"}))
            else:
                commit, digest, size = local
                print(json.dumps({"status": "GIT_BUNDLE_LOCAL_VERIFIED",
                                  "source_commit": commit, "sha256": digest, "bytes": size}))
            return 0
        if args.repo is None:
            raise DeliveryError("canonical OS Git checkout required")
        commit = source_commit(args.repo.resolve())
        if existing_current(target, commit):
            if args.apply:
                verified = verified_local_bundle(target)
                if verified is None or verified[0] != commit:
                    raise DeliveryError("current USB bundle cannot be reverified")
                if checked_volume(letter) != before:
                    raise DeliveryError("physical USB identity changed before update request")
                arm_update_request(target, *verified)
                if source_commit(args.repo.resolve()) != commit:
                    raise DeliveryError("canonical OS main advanced after USB request")
            print(json.dumps({"status": "CURRENT", "source_commit": commit}))
            return 0
        if not args.apply:
            print(json.dumps({"status": "AVAILABLE", "source_commit": commit, "action": "staging-not-authorized"}))
            return 0
        with tempfile.TemporaryDirectory(prefix="ordax-usb-bundle-") as temp:
            bundle = Path(temp) / BUNDLE
            digest, size = build_bundle(args.repo.resolve(), bundle, commit)
            if checked_volume(letter) != before:
                raise DeliveryError("physical USB identity changed during packaging")
            # The main SHA was pinned before packaging. Long bundle generation
            # must not report "current" if another chat advanced canonical main.
            if source_commit(args.repo.resolve()) != commit:
                raise DeliveryError("canonical OS main advanced during USB packaging")
            install_bundle(target, bundle, commit, digest, size)
            if checked_volume(letter) != before:
                raise DeliveryError("physical USB identity changed after transfer")
            if source_commit(args.repo.resolve()) != commit:
                raise DeliveryError("canonical OS main advanced after USB readback; staged revision is not latest")
            arm_update_request(target, commit, digest, size)
            if checked_volume(letter) != before:
                raise DeliveryError("physical USB identity changed after update request")
            print(json.dumps({"status": "STAGED_NOT_ACTIVATED", "source_commit": commit,
                              "sha256": digest, "bytes": size}))
        return 0
    except DeliveryError as exc:
        print("OWNER_USB_GIT_DELIVERY=BLOCKED:" + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
