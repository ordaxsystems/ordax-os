#!/usr/bin/env python3
"""Owner Dev local Creator synchronizer. Never writes a USB or upgrades a running EXE.

Consumes only the canonical OS Creator release channel, with both application
and OS media revisions checked against the same verified OS Git history. The installed application directory is replaced
as a unit, only after digest, provenance and offline executable smoke checks.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

REPO = "ordaxsystems/ordax-os"
TAG = "creator-owner-prototype"
BASE = f"https://github.com/{REPO}/releases/download/{TAG}/"
MANIFEST_URL = BASE + "creator-owner-update.json"
BUNDLE_NAME = "OrdaX-Creator-Owner-Prototype.zip"
EXPECTED_FILES = {
    "OrdaX-Creator/OrdaX-Creator.exe",
    "OrdaX-Creator/provenance.json",
    "OrdaX-Creator/ordax-symbol.png",
    "OrdaX-Creator/ordax-design-theme.json",
    "OrdaX-Creator/LEIA-ME.txt",
}
HEX40 = re.compile(r"[0-9a-f]{40}\Z")
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z][a-z0-9]*(?:\.[0-9]+)?)?\Z")
MAX_BUNDLE_BYTES = 2 << 30


class SyncError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as src:
        for chunk in iter(lambda: src.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def request_json(url: str, max_bytes: int = 64 << 10) -> dict:
    request = urllib.request.Request(url, headers={
        "User-Agent": "OrdaX-Creator-Owner-Dev-Local-Sync/1",
        "Cache-Control": "no-cache",
    })
    with urllib.request.urlopen(request, timeout=25) as response:
        body = response.read(max_bytes + 1)
    if not body or len(body) > max_bytes:
        raise SyncError("untrusted remote JSON size")
    value = json.loads(body)
    if not isinstance(value, dict):
        raise SyncError("remote JSON must be an object")
    return value


def fresh_manifest_url(nonce: int | None = None) -> str:
    # Immutable releases are published behind a stable tag URL. GitHub CDNs
    # can return a previous manifest after --clobber without a cache key.
    if nonce is None:
        nonce = time.time_ns()
    return MANIFEST_URL + "?ordax_nocache=" + str(nonce)


def verified_bundle_url(digest: str) -> str:
    if not HEX64.fullmatch(digest):
        raise SyncError("untrusted Creator download digest")
    # Each published ZIP gets a distinct URL cache key even when the release
    # tag and filename stay fixed. SHA-256/size checks remain authoritative.
    return BASE + BUNDLE_NAME + "?ordax_sha256=" + digest


def validate_manifest(value: dict) -> dict:
    if (value.get("$schema") != "prototype-ordax.creator-owner-bundle-update/2"
            or value.get("owner_repository") != REPO
            or value.get("channel") != "owner-prototype"
            or value.get("artifact") != BUNDLE_NAME
            or value.get("download_url") != BASE + BUNDLE_NAME
            or value.get("automatic_in_app_update") is not False
            or not isinstance(value.get("version"), str)
            or not VERSION.fullmatch(value["version"])):
        raise SyncError("untrusted Creator update manifest")
    for key in ("source_commit", "creator_source_commit"):
        if not isinstance(value.get(key), str) or not HEX40.fullmatch(value[key]):
            raise SyncError("invalid Owner revision identity: " + key)
    if (not isinstance(value.get("sha256"), str) or not HEX64.fullmatch(value["sha256"])
            or type(value.get("size")) is not int
            or not 0 < value["size"] <= MAX_BUNDLE_BYTES):
        raise SyncError("untrusted Creator bundle integrity descriptor")
    # Accept previously published v2 manifests, but never a malformed new
    # producer identity. The archive digest/size remain the installation gate.
    media_sha = value.get("os_media_payload_sha256")
    if "os_media_payload_sha256" in value and (
        not isinstance(media_sha, str) or not HEX64.fullmatch(media_sha)
    ):
        raise SyncError("untrusted OS media payload identity")
    return value


def current_provenance(root: Path) -> dict:
    current = root / "current"
    path = current / "OrdaX-Creator" / "provenance.json"
    if current.is_symlink() or not path.is_file() or path.is_symlink():
        raise SyncError("existing Owner Creator must have safe provenance")
    data = json.loads(path.read_text(encoding="utf-8"))
    if (data.get("$schema") != "prototype-ordax.creator-owner-physical/1"
            or data.get("creator_source_repository") != REPO
            or not isinstance(data.get("creator_version"), str)
            or not VERSION.fullmatch(data["creator_version"])
            or any(not isinstance(data.get(k), str) or not HEX40.fullmatch(data[k])
                   for k in ("source_commit", "creator_source_commit"))):
        raise SyncError("installed Owner Creator has untrusted provenance")
    return data


def local_repo_path(repository: str) -> Path:
    if repository != "ordax-os":
        raise SyncError("invalid local source owner")
    # tools/ sits in creator/ of the current OS checkout, not beside a second repo.
    return Path(__file__).resolve().parents[2]


def local_source_relation(repository: str, installed: str, candidate: str) -> int | None:
    """Use the canonical local Git history, without transferring a giant Compare diff."""
    repo = local_repo_path(repository)
    # In a linked Git worktree .git is a regular gitdir pointer file.
    # Both a normal checkout and a linked worktree are valid read-only sources.
    marker = repo / ".git"
    if (repo.is_symlink() or marker.is_symlink()
            or not (marker.is_dir() or marker.is_file())):
        return None

    def git(*args: str) -> subprocess.CompletedProcess:
        return subprocess.run(["git", "-C", str(repo), *args], capture_output=True,
                              text=True, check=False, timeout=12)

    try:
        if (git("symbolic-ref", "--quiet", "--short", "HEAD").stdout.strip() != "main"
                or git("remote", "get-url", "origin").stdout.strip()
                != f"https://github.com/ordaxsystems/{repository}.git"
                or git("diff", "--quiet", "HEAD", "--").returncode != 0):
            return None
        for revision in (installed, candidate):
            if git("cat-file", "-e", revision + "^{commit}").returncode != 0:
                return None
        # A release can legitimately lag the latest main; it must never point
        # to a commit unreachable from that same verified local main lineage.
        if git("merge-base", "--is-ancestor", candidate, "HEAD").returncode != 0:
            return None
        if git("merge-base", "--is-ancestor", installed, candidate).returncode != 0:
            raise SyncError(f"{repository} local Git history is not fast-forward")
        return 1
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        return None


def source_relation(repository: str, installed: str, candidate: str) -> int:
    if installed == candidate:
        return 0
    if repository != "ordax-os":
        raise SyncError("invalid history owner")
    local_relation = local_source_relation(repository, installed, candidate)
    if local_relation is not None:
        return local_relation
    url = f"https://api.github.com/repos/ordaxsystems/{repository}/compare/{installed}...{candidate}?per_page=1"
    relation = request_json(url, 16 << 20)
    if (relation.get("status") == "ahead"
            and type(relation.get("ahead_by")) is int and relation["ahead_by"] > 0
            and relation.get("behind_by") == 0):
        return 1
    raise SyncError(f"{repository} release history is not a verified fast-forward")


def download_bundle(manifest: dict, cache: Path) -> Path:
    cache.mkdir(mode=0o700, parents=True, exist_ok=True)
    expected = manifest["sha256"]
    target = cache / (expected + ".zip")
    if target.is_symlink():
        raise SyncError("Creator cache must not contain symlinks")
    if target.is_file() and target.stat().st_size == manifest["size"] and sha256_file(target) == expected:
        return target
    part = cache / (expected + f".{os.getpid()}.part")
    part.unlink(missing_ok=True)
    digest = hashlib.sha256()
    size = 0
    try:
        request = urllib.request.Request(verified_bundle_url(expected), headers={
            "User-Agent": "OrdaX-Creator-Owner-Dev-Local-Sync/1"})
        with urllib.request.urlopen(request, timeout=40) as response, part.open("xb") as dst:
            for block in iter(lambda: response.read(1024 * 1024), b""):
                size += len(block)
                if size > manifest["size"] or size > MAX_BUNDLE_BYTES:
                    raise SyncError("Creator bundle exceeds release size")
                digest.update(block)
                dst.write(block)
        if size != manifest["size"] or digest.hexdigest() != expected:
            raise SyncError("Creator bundle digest or length mismatch")
        part.replace(target)
        return target
    finally:
        part.unlink(missing_ok=True)


def verify_extracted(staging: Path, bundle: Path, manifest: dict, *, smoke: bool = True) -> None:
    with zipfile.ZipFile(bundle) as archive:
        files = archive.infolist()
        if (len(files) != len(EXPECTED_FILES)
                or {item.filename for item in files} != EXPECTED_FILES
                or sum(item.file_size for item in files) > MAX_BUNDLE_BYTES):
            raise SyncError("Creator package has unexpected files or unsafe size")
        for item in files:
            if item.is_dir() or ((item.external_attr >> 16) & 0o170000) == 0o120000:
                raise SyncError("Creator package contains linked or non-file entry")
            path = staging / item.filename
            path.parent.mkdir(parents=True, exist_ok=True)
            # A growing 380 MB PE is repeatedly inspected by Windows storage
            # filters. Extract it under a non-executable suffix and publish
            # the complete file in the same directory only after ZIP CRC
            # validation; never expose a partially extracted .exe.
            temporary = path.with_name(path.name + ".part") if path.name == "OrdaX-Creator.exe" else path
            try:
                with archive.open(item, "r") as src, temporary.open("xb") as dst:
                    shutil.copyfileobj(src, dst, length=8 * 1024 * 1024)
                if temporary != path:
                    temporary.replace(path)
            finally:
                if temporary != path:
                    temporary.unlink(missing_ok=True)
    doc = json.loads((staging / "OrdaX-Creator/provenance.json").read_text(encoding="utf-8"))
    if (doc.get("$schema") != "prototype-ordax.creator-owner-physical/1"
            or doc.get("creator_source_repository") != REPO
            or doc.get("source_commit") != manifest["source_commit"]
            or doc.get("creator_source_commit") != manifest["creator_source_commit"]
            or doc.get("creator_version") != manifest["version"]
            or doc.get("physical_write_authorized_in_binary") is not True):
        raise SyncError("Creator package provenance differs from published release")
    executable = staging / "OrdaX-Creator/OrdaX-Creator.exe"
    with executable.open("rb") as binary:
        if binary.read(2) != b"MZ":
            raise SyncError("Creator package does not contain Windows executable")
    if smoke:
        result = subprocess.run([str(executable), "--offline-package-smoke"],
                                cwd=executable.parent, timeout=45, check=False)
        if result.returncode:
            raise SyncError("Creator offline package smoke failed")


def creator_process_active() -> bool:
    """Read the Windows process snapshot without spawning tasklist/conhost.

    Task Scheduler may run in an unattended session where a captured tasklist
    pipe never reaches EOF. No external subprocess or unbounded wait is needed
    to decide whether the already-open Creator must defer replacement.
    """
    if os.name != "nt":
        raise SyncError("local Creator updates require Windows")
    import ctypes
    from ctypes import wintypes

    class ProcessEntry(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.c_size_t),
            ("th32ModuleID", wintypes.DWORD),
            ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD),
            ("pcPriClassBase", wintypes.LONG),
            ("dwFlags", wintypes.DWORD),
            ("szExeFile", ctypes.c_wchar * 260),
        ]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    snapshot = kernel.CreateToolhelp32Snapshot
    snapshot.argtypes = (wintypes.DWORD, wintypes.DWORD)
    snapshot.restype = wintypes.HANDLE
    first = kernel.Process32FirstW
    first.argtypes = (wintypes.HANDLE, ctypes.POINTER(ProcessEntry))
    first.restype = wintypes.BOOL
    following = kernel.Process32NextW
    following.argtypes = (wintypes.HANDLE, ctypes.POINTER(ProcessEntry))
    following.restype = wintypes.BOOL
    close = kernel.CloseHandle
    close.argtypes = (wintypes.HANDLE,)
    close.restype = wintypes.BOOL

    handle = snapshot(0x00000002, 0)  # TH32CS_SNAPPROCESS
    if handle in (None, ctypes.c_void_p(-1).value):
        raise SyncError("cannot obtain native Creator process snapshot")
    try:
        entry = ProcessEntry()
        entry.dwSize = ctypes.sizeof(ProcessEntry)
        if not first(handle, ctypes.byref(entry)):
            raise SyncError("native Creator process enumeration failed")
        while True:
            if entry.szExeFile.casefold() == "ordax-creator.exe":
                return True
            ctypes.set_last_error(0)
            if following(handle, ctypes.byref(entry)):
                continue
            if ctypes.get_last_error() != 18:  # ERROR_NO_MORE_FILES
                raise SyncError("native Creator process enumeration was incomplete")
            return False
    finally:
        if not close(handle):
            raise SyncError("cannot release native Creator process snapshot")


def recover_interrupted_swap(root: Path) -> None:
    current, previous = root / "current", root / ".ordax-previous"
    if not current.exists() and previous.is_dir() and not previous.is_symlink():
        previous.rename(current)


def sync(root: Path, *, check_only: bool = False) -> str:
    if os.name != "nt":
        raise SyncError("Owner Creator local sync supports Windows only")
    if root.is_symlink():
        raise SyncError("Owner Creator install root is a symbolic link")
    root = root.resolve()
    if root.name != "OrdaX-Creator-Owner-Prototype" or not root.is_dir():
        raise SyncError("not an existing Owner Development Creator installation")
    import msvcrt
    lock = root / ".ordax-sync.lock"
    with lock.open("a+b") as handle:
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            return "SKIP_ALREADY_RUNNING"
        try:
            recover_interrupted_swap(root)
            current = current_provenance(root)
            try:
                remote = validate_manifest(request_json(fresh_manifest_url()))
            except urllib.error.HTTPError as exc:
                if exc.code == 404:
                    return "DEFERRED_NO_PUBLISHED_RELEASE"
                raise
            newer_os = source_relation("ordax-os", current["source_commit"], remote["source_commit"])
            newer_creator = source_relation("ordax-os", current["creator_source_commit"], remote["creator_source_commit"])
            if not (newer_os or newer_creator):
                return "CURRENT"
            if check_only:
                return "AVAILABLE_VERIFIED"
            if creator_process_active():
                return "DEFERRED_CREATOR_RUNNING"
            bundle = download_bundle(remote, root / ".ordax-update-cache")
            stage = Path(tempfile.mkdtemp(prefix=".ordax-next-", dir=root))
            try:
                # Task Scheduler may run in a noninteractive Windows session;
                # the publisher already runs the real GUI smoke on Windows.
                # Local safety relies on release SHA-256, exact ZIP membership,
                # provenance, lineage and the binary header, not a GUI window.
                verify_extracted(stage, bundle, remote, smoke=False)
                if creator_process_active():
                    return "DEFERRED_CREATOR_RUNNING"
                installed = root / "current"
                previous = root / ".ordax-previous"
                if previous.exists():
                    shutil.rmtree(previous)
                installed.rename(previous)
                try:
                    stage.rename(installed)
                except OSError:
                    previous.rename(installed)
                    raise
                try:
                    shutil.rmtree(previous)
                except OSError:
                    return "UPDATED_VERIFIED_CLEANUP_PENDING"
                return "UPDATED_VERIFIED"
            finally:
                if stage.exists():
                    shutil.rmtree(stage)
        finally:
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)


@contextmanager
def owner_usb_stage_gate(wait_seconds: float):
    """Serialize the one Git-main cache across Creator UI and scheduled task.

    This lock protects the cache checkout through transport execution. The
    existing delivery lock still independently protects the physical USB.
    """
    if os.name != "nt":
        yield True
        return
    import msvcrt
    root = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local")) / "OrdaX-Creator"
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = root / "owner-main-delivery.lock"
    if path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction()):
        raise SyncError("Owner main staging lock path is unsafe")
    deadline = time.monotonic() + wait_seconds
    with path.open("a+b") as handle:
        while True:
            handle.seek(0)
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                break
            except OSError as exc:
                if time.monotonic() >= deadline:
                    if wait_seconds == 0:
                        yield False
                        return
                    raise SyncError("Owner Git staging remains busy; try on the next cycle") from exc
                time.sleep(min(1.0, max(0, deadline - time.monotonic())))
        try:
            yield True
        finally:
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)


def run_owner_usb_transport(command: list[str], *, from_creator_ui: bool):
    """Retry only a proven transient writer mutex collision, never an invalid USB."""
    busy = "OWNER_USB_GIT_DELIVERY=BLOCKED:Owner USB transport already running"
    deadline = time.monotonic() + (60.0 if from_creator_ui else 0.0)
    while True:
        try:
            completed = subprocess.run(command, capture_output=True, text=True,
                                       timeout=300, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise SyncError("bounded Owner USB Git staging failed") from exc
        if completed.returncode != 2 or completed.stderr.strip() != busy:
            return completed
        if not from_creator_ui:
            return None  # Scheduled task will retry on its existing cadence.
        if time.monotonic() >= deadline:
            raise SyncError("Owner USB writer remained busy beyond the bounded wait")
        time.sleep(min(2.0, max(0.0, deadline - time.monotonic())))


def _owner_main_delivery_checkout() -> Path:
    """Keep one independent exact-main delivery cache, never borrow a DEV checkout."""
    from owner_usb_git_delivery import REPO_URL
    root = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local")) / "OrdaX-Creator"
    cache = root / "owner-main-delivery"
    retired = root / "owner-main-delivery.retired"

    def run_git(*args: str, timeout: int = 150) -> str:
        try:
            completed = subprocess.run(
                ["git", *args], capture_output=True, text=True,
                timeout=timeout, check=True,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise SyncError("canonical Owner Git main cache could not be updated") from exc
        return completed.stdout.strip()

    def linked(path: Path) -> bool:
        return path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction())

    def check_checkout(path: Path) -> None:
        if linked(path) or linked(path / ".git") or not (path / ".git").is_dir():
            raise SyncError("Owner main cache is not a standalone Git checkout")
        if run_git("-C", str(path), "remote", "get-url", "origin") != REPO_URL:
            raise SyncError("Owner main cache origin differs from canonical OS")
        if run_git("-C", str(path), "status", "--porcelain=v1"):
            raise SyncError("Owner main cache contains uncommitted changes")

    def remove_disposable_cache(path: Path) -> None:
        # Git for Windows marks pack files read-only. Only known disposable
        # transport caches are removed here, never the developer's checkout.
        def retry_readonly(operation, filename, exc_info):
            if (not isinstance(exc_info[1], PermissionError)
                    or Path(filename).is_symlink()):
                raise exc_info[1]
            os.chmod(filename, 0o700)
            operation(filename)
        shutil.rmtree(path, onerror=retry_readonly)

    def borrowed(path: Path) -> bool:
        gitdir = path / ".git"
        return (os.path.lexists(gitdir / "objects/info/alternates")
                or (gitdir / "shallow").exists()
                or any((gitdir / "objects/pack").glob("*.promisor")))

    if linked(root) or linked(cache) or linked(retired):
        raise SyncError("Owner main cache path is unsafe")
    root.mkdir(parents=True, exist_ok=True)
    # Recover an interrupted cache cutover under the existing stage lock.
    if retired.exists():
        check_checkout(retired)
        if not cache.exists():
            retired.rename(cache)
        else:
            check_checkout(cache)
            if borrowed(cache):
                raise SyncError("Owner main cache cutover is ambiguous")
            remove_disposable_cache(retired)

    if cache.exists():
        check_checkout(cache)

    # Full history is required by the current self-contained Git bundle.
    # A shallow/partial/alternate checkout can silently lack those objects.
    # Rebuild only the existing disposable transport cache once when needed.
    if not cache.exists() or borrowed(cache):
        pending = root / ("owner-main-delivery.pending-" + str(os.getpid()))
        if os.path.lexists(pending):
            raise SyncError("Owner main cache creation is already pending")
        try:
            run_git("clone", "--no-tags", "--single-branch", "--branch", "main",
                    "--no-checkout", REPO_URL, str(pending), timeout=300)
            run_git("-C", str(pending), "sparse-checkout", "init", "--cone")
            run_git("-C", str(pending), "sparse-checkout", "set", "bootstrap/dev-base")
            # --no-checkout leaves the initial index empty on Git for
            # Windows. Materialize only this newly cloned disposable tree.
            run_git("-C", str(pending), "reset", "--hard", "HEAD")
            check_checkout(pending)
            if run_git("-C", str(pending), "branch", "--show-current") != "main":
                raise SyncError("new Owner main cache is not on main")
            if borrowed(pending):
                raise SyncError("new Owner main cache lacks independent Git objects")
            if cache.exists():
                # Preserve the old validated cache until replacement succeeds.
                cache.rename(retired)
            try:
                pending.rename(cache)
            except OSError:
                if retired.exists() and not cache.exists():
                    retired.rename(cache)
                raise
            if retired.exists():
                remove_disposable_cache(retired)
        finally:
            if pending.exists():
                remove_disposable_cache(pending)
        # The writer independently confirms the canonical remote main SHA.
        return cache

    previous_branch = run_git("-C", str(cache), "branch", "--show-current")
    previous_head = run_git("-C", str(cache), "rev-parse", "HEAD")
    run_git("-C", str(cache), "fetch", "--no-tags", "origin", "main")
    candidate = run_git("-C", str(cache), "rev-parse", "FETCH_HEAD")
    if previous_branch != "main":
        raise SyncError("Owner main delivery cache is not on main")
    if previous_head != candidate:
        run_git("-C", str(cache), "merge-base", "--is-ancestor", previous_head, candidate)
        run_git("-C", str(cache), "merge", "--ff-only", candidate)
    check_checkout(cache)
    return cache



def _export_canonical_base_policy(repo: Path, directory: Path) -> tuple[Path, str, str]:
    """Export only the OS-owned Base policy at the cached canonical Git HEAD."""
    git_bin = shutil.which("git")
    awk_bin = shutil.which("awk")
    if not git_bin:
        raise SyncError("canonical Git executable unavailable")
    if not awk_bin and os.name == "nt":
        candidate = Path(git_bin).resolve().parent.parent / "usr" / "bin" / "awk.exe"
        if candidate.is_file() and not candidate.is_symlink():
            awk_bin = str(candidate)
    if not awk_bin:
        raise SyncError("canonical Base impact policy interpreter unavailable")
    paths = (
        "system/services/base-update/dev_channel.py",
        "system/services/base-update/dev-impact.awk",
        "system/services/base-update/dev-helper-manifest.tsv",
    )
    for relative in paths:
        fetched = subprocess.run(
            [git_bin, "-C", str(repo), "show", "HEAD:" + relative],
            capture_output=True, timeout=8, check=True,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        ).stdout
        if not fetched or len(fetched) > (256 << 10):
            raise SyncError("OS Base source missing or oversized")
        output = directory / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(fetched)
    return directory / paths[0], git_bin, awk_bin


def inspect_canonical_dev_base(repo: Path, source_commit_sha: str) -> dict:
    """Read-only binary availability via the OS-owned resolver, not another updater.

    Run only for explicit Creator UI staging. The Git bundle transport already
    proved that this disposable checkout is the canonical OS main.
    """
    if not isinstance(source_commit_sha, str) or not HEX40.fullmatch(source_commit_sha):
        return {}
    try:
        with tempfile.TemporaryDirectory(prefix="ordax-canonical-base-probe-") as temporary:
            script, git_bin, awk_bin = _export_canonical_base_policy(repo, Path(temporary))
            result = subprocess.run(
                [
                    sys.executable, "-I", str(script),
                    "--source-commit", source_commit_sha,
                    "--compatible-worktree", str(repo),
                    "--resolve-only", "--git-bin", git_bin, "--awk-bin", awk_bin,
                ],
                capture_output=True, timeout=15, check=False,
                env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
            )
            if result.returncode != 0 or not 0 < len(result.stdout) <= 2048:
                return {}
            response = json.loads(result.stdout.decode("utf-8"))
            artifact = response.get("source_commit")
            if (response.get("status") != "resolved"
                    or response.get("requested_source_commit") != source_commit_sha
                    or not isinstance(artifact, str)
                    or not HEX40.fullmatch(artifact)
                    or response.get("exact_source") is not (artifact == source_commit_sha)):
                return {}
            return {"base_status": "AVAILABLE_NOT_STAGED",
                    "base_artifact_commit": artifact}
    except (SyncError, OSError, ValueError, UnicodeError, json.JSONDecodeError,
            subprocess.SubprocessError):
        return {}


def _run_canonical_base_child(command: list[str], timeout: int) -> dict:
    """OS-owned Base subcommands stay in a native kill-on-close Windows Job."""
    try:
        if os.name == "nt":
            from owner_usb_git_delivery import _windows_git_job
            stdout = _windows_git_job(command, timeout)
        else:
            done = subprocess.run(
                command, capture_output=True, timeout=timeout, check=True,
                env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
            )
            stdout = done.stdout.decode("utf-8")
        if not 0 < len(stdout) <= 4096:
            raise SyncError("canonical Base child returned invalid receipt size")
        value = json.loads(stdout)
        if not isinstance(value, dict):
            raise SyncError("canonical Base child did not return a JSON object")
        return value
    except (OSError, ValueError, UnicodeError, subprocess.SubprocessError) as exc:
        raise SyncError("canonical Base child failed or timed out") from exc


def stage_canonical_base_for_creator(
    repo: Path, requested: str, artifact: str, serial: str, disk: int,
) -> dict:
    """Acquire via OS policy; use existing authorized USB writer for transport."""
    if (not HEX40.fullmatch(requested) or not HEX40.fullmatch(artifact)
            or type(disk) is not int or disk < 0):
        raise SyncError("invalid exact development Base identity")
    root = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local")) / "OrdaX-Creator"
    if root.is_symlink() or (hasattr(root, "is_junction") and root.is_junction()):
        raise SyncError("Owner Base cache path is linked")
    root.mkdir(parents=True, exist_ok=True)
    cache = root / "owner-base-delivery"
    if cache.is_symlink() or (hasattr(cache, "is_junction") and cache.is_junction()):
        raise SyncError("Owner Base cache is linked")
    with tempfile.TemporaryDirectory(prefix="ordax-canonical-base-transfer-") as tmp:
        script, git_bin, awk_bin = _export_canonical_base_policy(repo, Path(tmp))
        receipt = _run_canonical_base_child(
            [sys.executable, "-I", str(script), "--source-commit", requested,
             "--compatible-worktree", str(repo), "--destination-root", str(cache),
             "--acquire-only", "--git-bin", git_bin, "--awk-bin", awk_bin],
            timeout=600,
        )
        source = cache / artifact
        if (receipt.get("status") != "acquired"
                or receipt.get("source_commit") != artifact
                or receipt.get("requested_source_commit") != requested
                or receipt.get("path") != str(source)
                or type(receipt.get("reused")) is not bool):
            raise SyncError("Base acquisition does not match source binding")
        writer = Path(__file__).with_name("owner_usb_git_delivery.py")
        command = [sys.executable, str(writer), "--auto-volume",
                   "--trusted-serial", serial, "--trusted-disk-number", str(disk),
                   "--base-candidate-dir", str(source),
                   "--canonical-base-script", str(script),
                   "--base-artifact-commit", artifact, "--apply"]
        result = _run_canonical_base_child(command, timeout=660)
        if (result.get("status") != "BASE_STAGED_NOT_ACTIVATED"
                or result.get("base_artifact_commit") != artifact
                or type(result.get("reused")) is not bool):
            raise SyncError("USB Base transfer did not pass OS readback")
        return {"base_status": "STAGED_NOT_ACTIVATED",
                "base_artifact_commit": artifact}


def stage_owner_usb_dev(expected_serial: str, *, from_creator_ui: bool = False,
                        expected_disk_number: int | None = None) -> str | dict:
    """Reuse the single cached Git deliverer for the task and the Creator GUI."""
    if not from_creator_ui and creator_process_active():
        return "DEFERRED_CREATOR_RUNNING"
    delivery = Path(__file__).with_name("owner_usb_git_delivery.py")
    if not delivery.is_file():
        raise SyncError("canonical Owner Git deliverer unavailable")
    if expected_disk_number is not None and (
            type(expected_disk_number) is not int or expected_disk_number < 0):
        raise SyncError("invalid selected USB disk number")
    with owner_usb_stage_gate(60.0 if from_creator_ui else 0.0) as acquired:
        if not acquired:
            return "DEFERRED_OWNER_GIT_BUSY"
        # The canonical writer owns physical discovery; reuse it before any
        # network/cache work. The writer independently revalidates identity
        # after fetch and before staging, so hot-unplug cannot authorize writes.
        from owner_usb_git_delivery import DeliveryError, discover_trusted_volume
        try:
            present_volume = discover_trusted_volume(expected_serial)
        except DeliveryError as exc:
            raise SyncError(str(exc)) from exc
        if present_volume is None:
            if from_creator_ui:
                raise SyncError("selected Owner USB disappeared before staging")
            return "SKIP_TRUSTED_USB_NOT_PRESENT"
        main_repo = _owner_main_delivery_checkout()
        command = [sys.executable, str(delivery), "--repo", str(main_repo),
                   "--auto-volume", "--trusted-serial", expected_serial, "--apply"]
        if expected_disk_number is not None:
            command += ["--trusted-disk-number", str(expected_disk_number)]
        completed = run_owner_usb_transport(command, from_creator_ui=from_creator_ui)
    if completed is None:
        return "DEFERRED_USB_TRANSPORT_BUSY"
    if completed.returncode:
        raise SyncError("Owner USB Git staging blocked: " + completed.stderr.strip()[-350:])
    try:
        receipt = json.loads(completed.stdout)
    except ValueError as exc:
        raise SyncError("Owner USB Git staging returned no valid receipt") from exc
    status = receipt.get("status")
    if status not in ("CURRENT", "STAGED_NOT_ACTIVATED", "SKIP_TRUSTED_USB_NOT_PRESENT"):
        raise SyncError("Owner USB Git staging returned unknown status")
    if from_creator_ui:
        if status == "SKIP_TRUSTED_USB_NOT_PRESENT":
            raise SyncError("selected Owner USB disappeared during staging")
        evidence = inspect_canonical_dev_base(main_repo, receipt["source_commit"])
        if evidence:
            try:
                evidence = stage_canonical_base_for_creator(
                    main_repo, receipt["source_commit"],
                    evidence["base_artifact_commit"], expected_serial,
                    expected_disk_number,
                )
            except (SyncError, OSError, ValueError, subprocess.SubprocessError):
                # Never claim Base transferred when only its release exists.
                evidence = {"base_status": "AVAILABLE_NOT_STAGED",
                            "base_artifact_commit": evidence["base_artifact_commit"]}
        # Binary acquisition may be long. The Git transport checked main
        # before it finished; verify again before promising a current result.
        from owner_usb_git_delivery import source_commit
        if source_commit(main_repo) != receipt["source_commit"]:
            raise SyncError("canonical OS main changed during Base acquisition")
        receipt.update(evidence)
        return receipt
    return status


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--install-root", type=Path,
                   default=Path.home() / "Downloads" / "OrdaX-Creator-Owner-Prototype")
    p.add_argument("--check-only", action="store_true")
    p.add_argument("--creator-ui-stage", action="store_true",
                   help="stage through the canonical USB transport while Creator UI is open")
    p.add_argument("--trusted-disk-number", type=int)
    p.add_argument("--stage-owner-dev-usb-serial",
                   help="locally authorized serial for non-activating Git transfer")
    args = p.parse_args()
    if args.creator_ui_stage:
        if (args.check_only or not args.stage_owner_dev_usb_serial
                or args.trusted_disk_number is None or args.trusted_disk_number < 0):
            print("OWNER_DEV_USB_GIT_STAGE=BLOCKED:missing selected physical USB", file=sys.stderr)
            return 2
        try:
            receipt = stage_owner_usb_dev(
                args.stage_owner_dev_usb_serial, from_creator_ui=True,
                expected_disk_number=args.trusted_disk_number,
            )
        except (SyncError, ValueError, OSError) as exc:
            print(f"OWNER_DEV_USB_GIT_STAGE=BLOCKED:{exc}", file=sys.stderr)
            return 2
        print(json.dumps(receipt))
        return 0
    # The physical Dev USB cache is independent of the Creator release CDN.
    # Stage first so a slow Creator manifest lookup never blocks reconnection.
    usb_failed = False
    if args.stage_owner_dev_usb_serial and not args.check_only:
        try:
            staged = stage_owner_usb_dev(args.stage_owner_dev_usb_serial)
            print("OWNER_DEV_USB_GIT_STAGE=" + staged, flush=True)
        except (SyncError, ValueError) as exc:
            print(f"OWNER_DEV_USB_GIT_STAGE=BLOCKED:{exc}", file=sys.stderr, flush=True)
            usb_failed = True
    try:
        result = sync(args.install_root, check_only=args.check_only)
    except (SyncError, ValueError, OSError, zipfile.BadZipFile,
            urllib.error.URLError, subprocess.TimeoutExpired) as exc:
        print(f"OWNER_CREATOR_LOCAL_SYNC=BLOCKED:{type(exc).__name__}:{exc}", file=sys.stderr)
        return 1
    print("OWNER_CREATOR_LOCAL_SYNC=" + result)
    return 1 if usb_failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
