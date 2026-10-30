#!/usr/bin/env python3
"""Build the one canonical Alpine-free OrdaX Surface runtime using Buildroot.

Physical media and Stable publication remain separately gated.
"""
from __future__ import annotations

import argparse
import codecs
import fcntl
import hashlib
import json
import os
import posixpath
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import uuid

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SOURCE = HERE / "source.json"
BASE_SOURCE = ROOT / "bootstrap/independent-base/source.json"
CONFIG = HERE / "configs/ordax_surface_defconfig"
UUID_NAMESPACE = uuid.UUID("9dc9e517-2e1e-54df-b408-49215ac9ab12")
HASH = re.compile(r"[0-9a-f]{64}\Z")
SURFACE_NATIVE_PATHS = {
    "bin/udevadm": "usr/bin/udevadm",
    "usr/lib/udev/rules.d/60-input-id.rules": "lib/udev/rules.d/60-input-id.rules",
}
SURFACE_COMPAT_LINKS = {
    "bin/udevadm": "../usr/bin/udevadm",
    "usr/lib/udev/rules.d/60-input-id.rules": "../../../../lib/udev/rules.d/60-input-id.rules",
}


class SurfaceBuildError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SurfaceBuildError(f"cannot read contract {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise SurfaceBuildError(f"contract must be an object: {path}")
    return value


def contracts() -> tuple[dict, dict]:
    source = load_json(SOURCE)
    base = load_json(BASE_SOURCE)
    if source.get("$schema") != "prototype-ordax.surface-runtime-source/1":
        raise SurfaceBuildError("unexpected canonical Surface runtime schema")
    if source.get("status") != "candidate-not-promotable":
        raise SurfaceBuildError("canonical Surface runtime may not be promotable")
    if source.get("buildroot_source_contract") != BASE_SOURCE.relative_to(ROOT).as_posix():
        raise SurfaceBuildError("Buildroot source SSOT drift")
    if source.get("architecture") != "x86_64" or source.get("libc") != "musl":
        raise SurfaceBuildError("Surface runtime architecture/libc drift")
    if source.get("first_boot_offline_required") is not True:
        raise SurfaceBuildError("first Surface boot must remain offline-capable")
    if source.get("network_package_install_during_boot_allowed") is not False:
        raise SurfaceBuildError("boot-time package installation is forbidden")
    if source.get("package_manager_in_runtime_allowed") is not False:
        raise SurfaceBuildError("runtime package manager is forbidden")
    artifact = source.get("artifact")
    if not isinstance(artifact, dict):
        raise SurfaceBuildError("artifact contract missing")
    if artifact.get("filesystem") != "erofs" or artifact.get("compression") != "lz4":
        raise SurfaceBuildError("Surface runtime artifact must remain EROFS/LZ4")
    if artifact.get("label") != "ORDAX-SURFACE":
        raise SurfaceBuildError("Surface runtime label drift")
    if artifact.get("physical_artifact_authorized") is not False:
        raise SurfaceBuildError("physical artifact authorization forbidden")
    if artifact.get("stable_promotion_authorized") is not False:
        raise SurfaceBuildError("Stable promotion authorization forbidden")

    required = source.get("required_runtime_paths")
    forbidden = source.get("forbidden_runtime_paths")
    if not isinstance(required, list) or not required or not isinstance(forbidden, list) or not forbidden:
        raise SurfaceBuildError("runtime path policy missing")
    for group, paths in (("required", required), ("forbidden", forbidden)):
        if len(paths) != len(set(paths)):
            raise SurfaceBuildError(f"duplicate {group} runtime path")
        for path in paths:
            if not isinstance(path, str) or not path or path.startswith("/") or ".." in Path(path).parts:
                raise SurfaceBuildError(f"unsafe {group} runtime path: {path!r}")
    if set(required) & set(forbidden):
        raise SurfaceBuildError("runtime path policy overlaps")
    if not set(SURFACE_NATIVE_PATHS).issubset(required):
        raise SurfaceBuildError("Surface native/compatibility paths are not part of required runtime ABI")
    if not set(SURFACE_COMPAT_LINKS).issubset(required):
        raise SurfaceBuildError("Surface compatibility paths are not part of required runtime ABI")

    if base.get("$schema") != "prototype-ordax.independent-base-experiment/1":
        raise SurfaceBuildError("canonical Independent Base source contract changed")
    buildroot = base.get("buildroot")
    if not isinstance(buildroot, dict):
        raise SurfaceBuildError("canonical Buildroot source missing")
    expected_url = f"https://buildroot.org/downloads/buildroot-{buildroot.get('version', '')}.tar.xz"
    if buildroot.get("url") != expected_url or not HASH.fullmatch(str(buildroot.get("sha256", ""))):
        raise SurfaceBuildError("canonical Buildroot source is not pinned")
    return source, base


def run(argv: list[str], *, cwd: Path | None = None, bounded: bool = False) -> str:
    if bounded:
        try:
            with subprocess.Popen(
                argv,
                cwd=cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
            ) as process:
                assert process.stdout is not None
                # read() buffered 64 KiB silently, leaving a multi-hour
                # Buildroot/LLVM/WebKit job without progress diagnostics.
                # read1() exposes available bytes immediately; stream while
                # retaining only a bounded failure tail in memory.
                tail = bytearray()
                decoder = codecs.getincrementaldecoder("utf-8")("replace")
                for chunk in iter(lambda: process.stdout.read1(65536), b""):
                    tail.extend(chunk)
                    if len(tail) > 20000:
                        del tail[:-20000]
                    visible = decoder.decode(chunk)
                    if visible:
                        sys.stdout.write(visible)
                        sys.stdout.flush()
                remaining = decoder.decode(b"", final=True)
                if remaining:
                    sys.stdout.write(remaining)
                    sys.stdout.flush()
                code = process.wait()
        except OSError as exc:
            raise SurfaceBuildError(f"cannot run {' '.join(argv)}: {exc}") from exc
        output = bytes(tail).decode("utf-8", errors="replace")
        if code:
            raise SurfaceBuildError(f"{' '.join(argv)} failed ({code}):\n{output}")
        return output
    try:
        result = subprocess.run(argv, cwd=cwd, check=False, text=True, capture_output=True)
    except OSError as exc:
        raise SurfaceBuildError(f"cannot run {' '.join(argv)}: {exc}") from exc
    output = result.stdout + result.stderr
    if result.returncode:
        raise SurfaceBuildError(f"{' '.join(argv)} failed ({result.returncode}):\n{output[-20000:]}")
    return output


def source_archive(base: dict, cache: Path) -> Path:
    buildroot = base["buildroot"]
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / f"buildroot-{buildroot['version']}.tar.xz"
    expected = buildroot["sha256"]
    if target.is_file() and sha256_file(target) == expected:
        return target
    part = target.with_suffix(".part")
    part.unlink(missing_ok=True)
    try:
        with urllib.request.urlopen(buildroot["url"], timeout=120) as response:
            with part.open("wb") as stream:
                shutil.copyfileobj(response, stream)
        if sha256_file(part) != expected:
            raise SurfaceBuildError("Buildroot archive SHA-256 mismatch")
        part.replace(target)
        return target
    finally:
        part.unlink(missing_ok=True)


def safe_unpack(archive: Path, work: Path, version: str) -> Path:
    expected_root = f"buildroot-{version}"
    with tarfile.open(archive, "r:xz") as bundle:
        members = bundle.getmembers()
        symlink_names = {member.name for member in members if member.issym()}
        for member in members:
            parts = Path(member.name).parts
            if not parts or parts[0] != expected_root or ".." in parts or member.name.startswith("/"):
                raise SurfaceBuildError(f"unsafe Buildroot archive path: {member.name}")
            if any(member.name.startswith(link + "/") for link in symlink_names):
                raise SurfaceBuildError(f"Buildroot archive traversal through symlink: {member.name}")
        bundle.extractall(work, filter="fully_trusted")
    source = work / expected_root
    if not (source / "Makefile").is_file():
        raise SurfaceBuildError("Buildroot source tree incomplete")
    return source


def source_commit() -> str:
    value = os.environ.get("ORDAX_SOURCE_COMMIT", "").strip().lower()
    if not value:
        value = run(["git", "-C", str(ROOT), "rev-parse", "HEAD"]).strip().lower()
    if re.fullmatch(r"[0-9a-f]{40}", value) is None:
        raise SurfaceBuildError("source commit must be lowercase 40-hex")
    return value


def normalized_member_name(name: str) -> str:
    # Only an explicit tar root entry may normalize to an empty path.
    while name.startswith("./"):
        name = name[2:]
    if name in ("", "."):
        return ""
    path = name.rstrip("/")
    if (
        name.startswith("/")
        or "\\" in name
        or any(ord(char) < 32 or ord(char) == 127 for char in name)
        or any(part in ("", ".", "..") for part in path.split("/"))
    ):
        raise SurfaceBuildError(f"unsafe Surface runtime tar member: {name!r}")
    return path


def indexed_rootfs_members(archive: tarfile.TarFile) -> dict[str, tarfile.TarInfo]:
    """Never let a later tar member shadow an earlier verified member."""
    result: dict[str, tarfile.TarInfo] = {}
    for member in archive.getmembers():
        name = normalized_member_name(member.name)
        if not name:
            if not member.isdir():
                raise SurfaceBuildError("non-directory tar root entry")
            continue
        if name in result:
            raise SurfaceBuildError(f"duplicate Surface runtime tar member: {name}")
        result[name] = member
    return result


def resolve_runtime_file(
    members: dict[str, tarfile.TarInfo], path: str
) -> tarfile.TarInfo:
    """Follow in-image file links; reject dangling, cyclic or escaping links."""
    seen: set[str] = set()
    current = path
    for _ in range(32):
        if current in seen:
            break
        seen.add(current)
        member = members.get(current)
        if member is None:
            raise SurfaceBuildError(f"Surface runtime required path has no target: {path}")
        if member.isfile():
            if member.size <= 0:
                raise SurfaceBuildError(f"Surface runtime required file is empty: {path}")
            return member
        if not (member.issym() or member.islnk()):
            raise SurfaceBuildError(f"Surface runtime required path is not a file: {path}")
        target = member.linkname
        if not target or "\\" in target or any(ord(char) < 32 for char in target):
            raise SurfaceBuildError(f"unsafe Surface runtime link target: {path}")
        if member.issym():
            current = posixpath.normpath(
                posixpath.join(posixpath.dirname(current), target)
                if not target.startswith("/") else target.lstrip("/")
            )
        else:
            current = posixpath.normpath(target.lstrip("/"))
        current = normalized_member_name(current)
    raise SurfaceBuildError(f"cyclic or overlong Surface runtime link: {path}")


def _compat_symlink(path: str, target: str) -> tarfile.TarInfo:
    link = tarfile.TarInfo(path)
    link.type = tarfile.SYMTYPE
    link.linkname = target
    link.mode = 0o777
    link.uid = link.gid = 0
    link.uname = link.gname = ""
    link.mtime = 0
    return link


def ensure_surface_runtime_path_compatibility(rootfs_tar: Path) -> dict[str, str]:
    """Preserve the current Surface path ABI without changing OrdaX consumers.

    Buildroot 2026.08/eudev uses split-/usr in this profile: udevadm is native at
    /usr/bin while udev rules are native under /lib/udev/rules.d. Expose only
    the compatibility paths required by the current Surface ABI and keep those
    native Buildroot locations authoritative.
    """
    with tarfile.open(rootfs_tar, "r:") as archive:
        members = indexed_rootfs_members(archive)

    pending: list[tarfile.TarInfo] = []
    links: dict[str, str] = {}
    for exposed, native in SURFACE_NATIVE_PATHS.items():
        native_member = members.get(native)
        if native_member is None or not native_member.isfile():
            raise SurfaceBuildError(f"Buildroot eudev did not provide /{native} for Surface ABI")
        if exposed == native:
            continue
        current = members.get(exposed)
        if current is not None:
            raise SurfaceBuildError(
                f"Buildroot now provides /{exposed} natively; review compatibility binding before changing ABI"
            )
        link_target = SURFACE_COMPAT_LINKS[exposed]
        pending.append(_compat_symlink(exposed, link_target))
        links[exposed] = link_target

    with tarfile.open(rootfs_tar, "a:") as archive:
        for link in pending:
            archive.addfile(link)
    return links


def inspect_rootfs_tar(rootfs_tar: Path, source: dict) -> dict:
    if not rootfs_tar.is_file() or rootfs_tar.is_symlink():
        raise SurfaceBuildError("Buildroot rootfs.tar missing")
    with tarfile.open(rootfs_tar, "r:") as archive:
        by_name = indexed_rootfs_members(archive)
    names = set(by_name)
    required = set(source["required_runtime_paths"])
    missing = sorted(required - names)
    if missing:
        raise SurfaceBuildError(f"Buildroot Surface runtime missing required paths: {missing}")
    # Names alone are not proof: resolve required executables and typelibs
    # to nonempty in-image files, including Buildroot's legitimate symlinks.
    for path in required - set(SURFACE_COMPAT_LINKS):
        target = resolve_runtime_file(by_name, path)
        if path in {
            "usr/bin/cage", "usr/bin/python3", "usr/bin/Xwayland",
            "usr/bin/seatd-launch", "sbin/udevd", "bin/busybox",
        } and target.mode & 0o111 == 0:
            raise SurfaceBuildError(f"Surface runtime executable is not executable: {path}")

    native_requirements = {
        "usr/bin/udevadm": "Buildroot native /usr/bin/udevadm is missing",
        "lib/udev/rules.d/60-input-id.rules": "Buildroot native input udev rule is missing",
    }
    for path, message in native_requirements.items():
        member = by_name.get(path)
        if member is None or not member.isfile():
            raise SurfaceBuildError(message)
    for path, target in SURFACE_COMPAT_LINKS.items():
        member = by_name.get(path)
        if member is None or not member.issym() or member.linkname != target:
            raise SurfaceBuildError(f"Surface /{path} ABI is not bound to native Buildroot path")

    forbidden_hits: list[str] = []
    for forbidden in source["forbidden_runtime_paths"]:
        for name in names:
            if name == forbidden or name.startswith(forbidden.rstrip("/") + "/"):
                forbidden_hits.append(name)
    for name in names:
        basename = Path(name).name
        if basename == "apk" or name.startswith("lib/apk/") or name.startswith("etc/apk/"):
            forbidden_hits.append(name)
    if forbidden_hits:
        raise SurfaceBuildError(f"Alpine/APK payload leaked into Buildroot runtime: {sorted(set(forbidden_hits))[:20]}")

    return {
        "member_count": len(by_name),
        "required_runtime_paths": sorted(required),
        "compatibility_links": dict(SURFACE_COMPAT_LINKS),
        "forbidden_runtime_paths_absent": True,
        "apk_runtime_absent": True,
    }


GRAPHICAL_KCONFIG_REQUIRED = (
        "BR2_x86_64=y",
        "BR2_TOOLCHAIN_BUILDROOT_MUSL=y",
        "BR2_SHARED_LIBS=y",
        "BR2_PACKAGE_EUDEV=y",
        "BR2_PACKAGE_CAGE=y",
        "BR2_PACKAGE_WEBKITGTK=y",
        "BR2_PACKAGE_WEBKITGTK_WAYLAND=y",
        "BR2_PACKAGE_LIBGTK3=y",
        "BR2_PACKAGE_LIBGTK3_WAYLAND=y",
        "BR2_PACKAGE_PYTHON3=y",
        "BR2_PACKAGE_PYTHON_GOBJECT=y",
        "BR2_PACKAGE_GOBJECT_INTROSPECTION=y",
        "BR2_PACKAGE_XWAYLAND=y",
        "BR2_PACKAGE_XKEYBOARD_CONFIG=y",
        "BR2_PACKAGE_MESA3D_LLVM=y",
        "BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_I915=y",
        "BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_CROCUS=y",
        "BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_IRIS=y",
        "BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_SOFTPIPE=y",
        "BR2_PACKAGE_MESA3D_OPENGL_GLX=y",
        "BR2_PACKAGE_SEATD=y",
    "BR2_PACKAGE_WEBKITGTK_HTTPS=y",
    "BR2_PACKAGE_WEBKITGTK_SANDBOX=y",
    "BR2_PACKAGE_WEBKITGTK_MULTIMEDIA=y",
    # Maintain media support without a second Alpine/APK runtime.
    "BR2_PACKAGE_GSTREAMER1=y",
    "BR2_PACKAGE_GSTREAMER1_INSTALL_TOOLS=y",
    "BR2_PACKAGE_GST1_PLUGINS_BASE=y",
    "BR2_PACKAGE_GST1_PLUGINS_GOOD=y",
    "BR2_PACKAGE_GST1_PLUGINS_GOOD_PLUGIN_PULSE=y",
    "BR2_PACKAGE_GST1_LIBAV=y",
    "BR2_PACKAGE_PIPEWIRE=y",
    "BR2_PACKAGE_PIPEWIRE_GSTREAMER=y",
    "BR2_PACKAGE_PULSEAUDIO=y",
    "BR2_PACKAGE_LUA=y",
    "BR2_PACKAGE_LUA_5_4=y",
    "BR2_PACKAGE_WIREPLUMBER=y",
    "BR2_PACKAGE_DBUS=y",
)


def resolved_kconfig(path: Path) -> dict[str, str]:
    """Read exact active assignments, never substrings or commented options."""
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        value = line.strip()
        if not value or value.startswith("#") or not value.startswith("BR2_"):
            continue
        if "=" not in value:
            raise SurfaceBuildError(f"invalid resolved Buildroot option: {value!r}")
        key, assigned = value.split("=", 1)
        if key in values:
            raise SurfaceBuildError(f"duplicate resolved Buildroot option: {key}")
        values[key] = assigned
    return values


def verify_build_config(build_dir: Path) -> str:
    config = build_dir / ".config"
    if not config.is_file():
        raise SurfaceBuildError("Buildroot generated .config missing")
    settings = resolved_kconfig(config)
    missing = [marker for marker in GRAPHICAL_KCONFIG_REQUIRED if settings.get(marker.split("=", 1)[0]) != "y"]
    if missing:
        raise SurfaceBuildError(f"Buildroot resolved config lost Surface requirements: {missing}")
    if settings.get("BR2_ROOTFS_MERGED_USR") == "y":
        raise SurfaceBuildError("Surface eudev compatibility binding requires the validated split-/usr layout")
    if settings.get("BR2_STATIC_LIBS") == "y":
        raise SurfaceBuildError("graphical Surface runtime cannot use static-only toolchain")
    return sha256_file(config)


def erofs_identity(image: Path) -> dict[str, str]:
    output = run(["blkid", "-p", "-o", "export", str(image)])
    values: dict[str, str] = {}
    for line in output.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    return values


PERSISTENT_WORKSPACE_SCHEMA = "prototype-ordax.surface-buildroot-workspace/1"
HOSTED_MAKE_TIMEOUT_MINUTES = 330
PERSISTENT_MAKE_TIMEOUT_MINUTES = 690


def surface_make_timeout_minutes(*, persistent: bool) -> int:
    """Select a bounded make budget before the corresponding CI deadline.

    Hosted runners are disposable and limited to a six-hour CI job. Only
    a deliberately configured --work-dir selects the resumable Buildroot O=
    mode with the twelve-hour self-hosted CI job budget.
    """
    return PERSISTENT_MAKE_TIMEOUT_MINUTES if persistent else HOSTED_MAKE_TIMEOUT_MINUTES
PERSISTENT_WORKSPACE_INPUTS = (
    HERE / "build.py",
    HERE / "prepare_config.py",
    SOURCE,
    BASE_SOURCE,
    ROOT / "bootstrap/kernel/source.json",
    CONFIG,
)


def workspace_identity(base: dict) -> dict:
    """A Buildroot output tree is reusable only with identical native inputs.

    Do not include Surface UI/Internet application source: those are injected
    into the composition outside this immutable graphical EROFS build.
    """
    return {
        "$schema": PERSISTENT_WORKSPACE_SCHEMA,
        "buildroot_version": base["buildroot"]["version"],
        "buildroot_archive_sha256": base["buildroot"]["sha256"],
        "environment": os.environ.get("ORDAX_COMPONENT_CACHE_ENVIRONMENT", "local-unpinned"),
        "inputs": {
            path.relative_to(ROOT).as_posix(): sha256_file(path)
            for path in PERSISTENT_WORKSPACE_INPUTS
        },
    }


def materialize_surface_workspace(archive: Path | None, base: dict, work: Path) -> Path:
    """Create once, or resume at exactly the original absolute workspace path.

    Interrupted extraction without a sealed marker is never silently trusted.
    A mismatched input or runner environment must be explicitly rebuilt in a
    different fingerprinted workspace; there is no implicit destructive clean.
    """
    record = workspace_identity(base)
    marker = work / ".ordax-surface-workspace.json"
    if marker.is_symlink():
        raise SurfaceBuildError("persistent Surface workspace receipt is unsafe")
    version = base["buildroot"]["version"]
    source = work / f"buildroot-{version}"
    if marker.exists():
        if not marker.is_file():
            raise SurfaceBuildError("persistent Surface workspace receipt is invalid")
        try:
            stored = json.loads(marker.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise SurfaceBuildError("persistent Surface workspace receipt is corrupt") from exc
        if stored != record:
            raise SurfaceBuildError("persistent Surface workspace native inputs changed")
        if source.is_symlink() or not (source / "Makefile").is_file():
            raise SurfaceBuildError("persistent Surface Buildroot source tree is incomplete")
        return source
    if any(path.name != ".ordax-workspace.lock" for path in work.iterdir()):
        raise SurfaceBuildError("unsealed persistent Surface workspace cannot be resumed")
    if archive is None:
        raise SurfaceBuildError("first persistent Buildroot extraction requires a pinned archive")
    source = safe_unpack(archive, work, version)
    staged = work / ".ordax-surface-workspace.json.tmp"
    with staged.open("x", encoding="utf-8") as stream:
        json.dump(record, stream, indent=2, sort_keys=True)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    staged.replace(marker)
    return source


PERSISTENT_CONFIG_RECEIPT_SCHEMA = "prototype-ordax.surface-resolved-kconfig/1"


def prepare_surface_config(
    tree: Path, build_dir: Path, config: Path, work: Path, *,
    persistent: bool,
) -> str:
    """Skip Kconfig regeneration only after verifying an immutable receipt.

    Buildroot's defconfig rewrites .config and can invalidate its stamps.
    Never claim a resumable O= without an exact, locally sealed .config.
    """
    receipt = work / ".ordax-surface-resolved-config.json"
    resolved = build_dir / ".config"
    if receipt.is_symlink() or resolved.is_symlink():
        raise SurfaceBuildError("persistent Surface config receipt is unsafe")
    source_sha = sha256_file(config)
    if persistent and receipt.exists():
        if not receipt.is_file() or not resolved.is_file():
            raise SurfaceBuildError("persistent Surface resolved config is missing")
        try:
            record = json.loads(receipt.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise SurfaceBuildError("persistent Surface resolved config receipt corrupt") from exc
        if (record.get("$schema") != PERSISTENT_CONFIG_RECEIPT_SCHEMA
                or record.get("defconfig_sha256") != source_sha):
            raise SurfaceBuildError("persistent Surface resolved defconfig changed")
        actual = verify_build_config(build_dir)
        if record.get("resolved_config_sha256") != actual:
            raise SurfaceBuildError("persistent Surface resolved config bytes changed")
        return actual
    if persistent and (receipt.exists() or resolved.exists()):
        raise SurfaceBuildError("unsealed persistent Surface resolved config cannot be resumed")
    run([
        "make", "-C", str(tree), f"O={build_dir}",
        f"BR2_DEFCONFIG={config}", "defconfig",
    ])
    resolved_sha = verify_build_config(build_dir)
    if persistent:
        value = {
            "$schema": PERSISTENT_CONFIG_RECEIPT_SCHEMA,
            "defconfig_sha256": source_sha,
            "resolved_config_sha256": resolved_sha,
        }
        temporary = work / ".ordax-surface-resolved-config.json.tmp"
        if temporary.is_symlink():
            raise SurfaceBuildError("persistent Surface config temporary path is unsafe")
        with temporary.open("x", encoding="utf-8") as stream:
            json.dump(value, stream, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(receipt)
    return resolved_sha


def build(out_dir: Path, cache_dir: Path, jobs: int, *, persistent_work_dir: Path | None = None) -> dict:
    source, base = contracts()
    if platform.system() != "Linux" or platform.machine().lower() not in {"x86_64", "amd64"}:
        raise SurfaceBuildError("Buildroot Surface candidate requires x86_64 Linux builder")
    if jobs < 1 or jobs > 64:
        raise SurfaceBuildError("jobs must be between 1 and 64")
    for program in ("make", "timeout", "mkfs.erofs", "fsck.erofs", "blkid"):
        if shutil.which(program) is None:
            raise SurfaceBuildError(f"required host build tool missing: {program}")
    if not CONFIG.is_file():
        raise SurfaceBuildError("Surface Buildroot defconfig missing")

    out_dir = out_dir.resolve()
    cache_dir = cache_dir.resolve()
    if out_dir.exists() and any(out_dir.iterdir()):
        raise SurfaceBuildError("output directory must be empty")
    out_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)

    transient = persistent_work_dir is None
    if transient:
        work = Path(tempfile.mkdtemp(prefix="ordax-independent-surface-"))
    else:
        work = Path(persistent_work_dir).absolute()
        if work.is_symlink():
            raise SurfaceBuildError("persistent Surface workspace cannot be a symlink")
        work = work.resolve(strict=False)
        if work == out_dir or work == cache_dir or out_dir in work.parents or cache_dir in work.parents:
            raise SurfaceBuildError("persistent Surface workspace must be separate from artifacts and cache")
    lock_fd = None
    try:
        if not transient:
            if work.is_symlink() or (work.exists() and not work.is_dir()):
                raise SurfaceBuildError("persistent Surface workspace path is unsafe")
            if work == ROOT or ROOT in work.parents:
                raise SurfaceBuildError("persistent workspace cannot write into the OS source")
            work.mkdir(parents=True, exist_ok=True, mode=0o700)
            lock_file = work / ".ordax-workspace.lock"
            if lock_file.is_symlink():
                raise SurfaceBuildError("persistent workspace lock is unsafe")
            lock_fd = os.open(lock_file, os.O_WRONLY | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise SurfaceBuildError("persistent Surface workspace is already building") from exc
        buildroot = base["buildroot"]
        # The sealed receipt identifies the exact pinned archive and all
        # native build inputs. A verified persistent workspace can resume
        # fully offline; initial extraction still fetches/verifies SHA-256.
        if transient:
            archive = source_archive(base, cache_dir)
            tree = safe_unpack(archive, work, buildroot["version"])
        else:
            receipt = work / ".ordax-surface-workspace.json"
            archive = None if receipt.exists() or receipt.is_symlink() else source_archive(base, cache_dir)
            tree = materialize_surface_workspace(archive, base, work)
        build_dir = work / "build"
        # The SSOT defconfig must stay immutable: resolve kernel headers into
        # a disposable build input, not into the checked-in source or cache key.
        config = CONFIG
        original = CONFIG.read_text(encoding="utf-8")
        if "BR2_KERNEL_HEADERS_VERSION=" not in original:
            config = work / "ordax-surface-resolved.defconfig"
            run([sys.executable, str(HERE / "prepare_config.py"), "materialize",
                 "--out", str(config)])
        resolved_config_sha = prepare_surface_config(
            tree, build_dir, config, work, persistent=not transient
        )
        # Leave 30 minutes before either CI job deadline for graceful
        # shutdown and verified cache/provenance publication. Only an explicit
        # resumable O= workspace permits the longer self-hosted budget.
        make_timeout_minutes = surface_make_timeout_minutes(persistent=not transient)
        print(
            f"ORDAX_SURFACE_MAKE_MODE={'persistent' if not transient else 'hosted'} "
            f"timeout_minutes={make_timeout_minutes}",
            flush=True,
        )
        # GNU timeout supervises the whole process group (no --foreground).
        run(["timeout", "--signal=TERM", "--kill-after=60s", f"{make_timeout_minutes}m",
             "make", "-C", str(tree), f"O={build_dir}", f"-j{jobs}"], bounded=True)
        resolved_config_sha_after = verify_build_config(build_dir)
        if resolved_config_sha_after != resolved_config_sha:
            raise SurfaceBuildError("Buildroot resolved config changed during build")

        rootfs_tar = build_dir / "images/rootfs.tar"
        compatibility_links = ensure_surface_runtime_path_compatibility(rootfs_tar)
        inventory = inspect_rootfs_tar(rootfs_tar, source)
        if inventory["compatibility_links"] != compatibility_links:
            raise SurfaceBuildError("Surface compatibility-link provenance drift")
        rootfs_sha = sha256_file(rootfs_tar)
        image_uuid = str(uuid.uuid5(UUID_NAMESPACE, rootfs_sha))
        image = out_dir / source["artifact"]["name"]
        run([
            "mkfs.erofs", "--tar=f", "-zlz4", "-T", "0",
            "-U", image_uuid, "-L", source["artifact"]["label"],
            "--all-root", str(image), str(rootfs_tar),
        ])
        run(["fsck.erofs", str(image)])
        identity = erofs_identity(image)
        if (
            identity.get("TYPE") != "erofs"
            or identity.get("LABEL") != source["artifact"]["label"]
            or identity.get("UUID", "").lower() != image_uuid
        ):
            raise SurfaceBuildError("generated Surface EROFS identity mismatch")

        provenance = {
            "$schema": "prototype-ordax.surface-runtime-provenance/1",
            "status": "candidate-not-promotable",
            "source_commit": source_commit(),
            "buildroot": {
                "version": buildroot["version"],
                "archive_sha256": buildroot["sha256"],
                "source_contract": source["buildroot_source_contract"],
            },
            "libc": source["libc"],
            "resolved_config_sha256": resolved_config_sha,
            "rootfs_tar_sha256": rootfs_sha,
            "runtime_inventory": inventory,
            "image": {
                "name": image.name,
                "filesystem": "erofs",
                "compression": "lz4",
                "label": source["artifact"]["label"],
                "uuid": image_uuid,
                "sha256": sha256_file(image),
                "size": image.stat().st_size,
            },
            "first_boot_offline_required": True,
            "package_manager_present": False,
            "alpine_present": False,
            "physical_artifact_authorized": False,
            "stable_promotion_authorized": False,
        }
        destination = out_dir / "provenance.json"
        destination.write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return provenance
    finally:
        if lock_fd is not None:
            os.close(lock_fd)
        if transient:
            shutil.rmtree(work, ignore_errors=True)


def verify(out_dir: Path) -> dict:
    source, _ = contracts()
    provenance_path = out_dir / "provenance.json"
    if not provenance_path.is_file():
        raise SurfaceBuildError("provenance.json missing")
    provenance = load_json(provenance_path)
    if provenance.get("$schema") != "prototype-ordax.surface-runtime-provenance/1":
        raise SurfaceBuildError("unexpected provenance schema")
    if provenance.get("status") != "candidate-not-promotable":
        raise SurfaceBuildError("candidate status drift")
    if provenance.get("package_manager_present") is not False or provenance.get("alpine_present") is not False:
        raise SurfaceBuildError("candidate claims forbidden distribution payload")
    if provenance.get("physical_artifact_authorized") is not False or provenance.get("stable_promotion_authorized") is not False:
        raise SurfaceBuildError("candidate authorization drift")
    inventory = provenance.get("runtime_inventory", {})
    if inventory.get("compatibility_links") != SURFACE_COMPAT_LINKS:
        raise SurfaceBuildError("Surface compatibility binding is absent from provenance")
    if inventory.get("apk_runtime_absent") is not True or inventory.get("forbidden_runtime_paths_absent") is not True:
        raise SurfaceBuildError("runtime inventory does not prove Alpine/APK absence")
    image = out_dir / source["artifact"]["name"]
    image_meta = provenance.get("image", {})
    if not image.is_file() or sha256_file(image) != image_meta.get("sha256"):
        raise SurfaceBuildError("Surface runtime image digest mismatch")
    if image.stat().st_size != image_meta.get("size"):
        raise SurfaceBuildError("Surface runtime image size mismatch")
    run(["fsck.erofs", str(image)])
    identity = erofs_identity(image)
    if identity.get("TYPE") != "erofs" or identity.get("LABEL") != source["artifact"]["label"]:
        raise SurfaceBuildError("Surface runtime image identity mismatch")
    return provenance


def check() -> None:
    source, base = contracts()
    text = CONFIG.read_text(encoding="utf-8")
    for forbidden in ("ALPINE", "APK", "BR2_PACKAGE_OPKG", "BR2_PACKAGE_RPM"):
        if forbidden in text.upper():
            raise SurfaceBuildError(f"forbidden distribution/package-manager marker in defconfig: {forbidden}")
    if source["build_profile"] != CONFIG.name:
        raise SurfaceBuildError("Surface Buildroot profile SSOT drift")
    if base["buildroot"]["version"] != "2026.08":
        raise SurfaceBuildError("Buildroot version changed; revalidate graphical profile before build")


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    build_parser = sub.add_parser("build")
    build_parser.add_argument("--out", type=Path, required=True)
    build_parser.add_argument("--cache", type=Path, required=True)
    build_parser.add_argument("--jobs", type=int, default=max(1, min(4, os.cpu_count() or 1)))
    build_parser.add_argument("--work-dir", type=Path, help="Optional trusted persistent native Buildroot O= workspace")
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "check":
            check()
        elif args.command == "build":
            print(json.dumps(build(args.out, args.cache, args.jobs, persistent_work_dir=args.work_dir), sort_keys=True))
        elif args.command == "verify":
            print(json.dumps(verify(args.out), sort_keys=True))
        return 0
    except SurfaceBuildError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
