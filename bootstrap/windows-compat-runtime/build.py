#!/usr/bin/env python3
"""Build the immutable Wine compatibility runtime candidate for OrdaX.

The build environment and runtime environment are separate Alpine roots. Wine
is compiled from exact upstream bytes inside the pinned build closure, then only
the installed prefix is copied into a clean runtime closure. The resulting
EROFS is Owner/Development-only, non-activating, and has no physical-write or
application-launch authority.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[2]
DISCOVERY_PATH = ROOT / "bootstrap/windows-compat-runtime/discover_lock.py"
UUID_NAMESPACE = uuid.UUID("de9db54d-b64b-5e0b-b07d-3a06deff2864")
VOLUME_LABEL = "ORDAX-WINCOMP"
RUNTIME_PREFIX = Path("opt/ordax/windows-compat/wine")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")


class RuntimeBuildError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeBuildError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


DISCOVERY = load_module("ordax_windows_compat_discovery", DISCOVERY_PATH)
CORE = DISCOVERY.CORE


def run(argv: list[str], *, cwd: Path | None = None, capture: bool = False, env=None):
    try:
        return subprocess.run(
            argv,
            cwd=cwd,
            check=True,
            text=True,
            capture_output=capture,
            env=env,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise RuntimeBuildError("command failed: " + " ".join(map(str, argv))) from exc


def source_commit() -> str:
    value = os.environ.get("ORDAX_SOURCE_COMMIT", "").strip().lower()
    if not value:
        value = run(
            ["git", "-C", str(ROOT), "rev-parse", "HEAD"],
            capture=True,
        ).stdout.strip().lower()
    if COMMIT_RE.fullmatch(value) is None:
        raise RuntimeBuildError("source commit must be lowercase 40-hex")
    return value


def exact_specs(lock: dict[str, str]) -> list[str]:
    return [f"{name}={version}" for name, version in sorted(lock.items())]


def prepare_alpine_root(rootfs: Path, contract: dict, cache_dir: Path, lock: dict[str, str], label: str) -> None:
    archive, actual_sha = CORE.download_verified(cache_dir)
    if actual_sha != contract["alpine"]["archive_sha256"]:
        raise RuntimeBuildError(
            f"{label} Alpine digest mismatch: expected={contract['alpine']['archive_sha256']} actual={actual_sha}"
        )
    rootfs.mkdir(parents=True, exist_ok=False)
    CORE.safe_extract(archive, rootfs)
    (rootfs / "etc/apk").mkdir(parents=True, exist_ok=True)
    (rootfs / "etc/apk/repositories").write_text(
        f"https://dl-cdn.alpinelinux.org/alpine/{CORE.ALPINE_BRANCH}/main\n"
        f"https://dl-cdn.alpinelinux.org/alpine/{CORE.ALPINE_BRANCH}/community\n",
        encoding="utf-8",
    )
    host_resolv = Path("/etc/resolv.conf")
    if host_resolv.is_file():
        shutil.copy2(host_resolv, rootfs / "etc/resolv.conf", follow_symlinks=True)

    CORE.proot_rootfs(
        rootfs,
        "apk add --no-cache " + " ".join(shlex.quote(item) for item in exact_specs(lock)),
    )
    installed = DISCOVERY.installed_lock(rootfs)
    expected = dict(sorted(lock.items()))
    if installed != expected:
        missing = sorted(set(expected) - set(installed))
        extra = sorted(set(installed) - set(expected))
        changed = sorted(
            name
            for name in set(expected) & set(installed)
            if expected[name] != installed[name]
        )
        raise RuntimeBuildError(
            f"{label} installed APK lock mismatch: "
            f"missing={missing[:12]} extra={extra[:12]} changed={changed[:12]}"
        )


def safe_extract_wine(archive: Path, destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=False)
    try:
        with tarfile.open(archive, "r:xz") as source:
            members = []
            for member in source.getmembers():
                name = member.name
                while name.startswith("./"):
                    name = name[2:]
                if not name or name.startswith("/") or ".." in Path(name).parts:
                    raise RuntimeBuildError(f"unsafe Wine source archive path: {member.name}")
                if member.isdev() or member.isfifo():
                    raise RuntimeBuildError(
                        f"unsupported Wine source archive object: {member.name}"
                    )
                if (member.issym() or member.islnk()) and (
                    os.path.isabs(member.linkname)
                    or ".." in Path(member.linkname).parts
                ):
                    raise RuntimeBuildError(
                        f"unsafe Wine source archive link: {member.name} -> {member.linkname}"
                    )
                members.append(member)
            source.extractall(destination, members=members, filter="data")
    except (tarfile.TarError, OSError) as exc:
        raise RuntimeBuildError(f"cannot extract Wine source: {exc}") from exc

    entries = list(destination.iterdir())
    if len(entries) != 1 or not entries[0].is_dir() or entries[0].name != "wine-11.0":
        raise RuntimeBuildError("Wine source archive did not contain exactly wine-11.0/")
    source_root = destination / "wine-11.0"
    if not (source_root / "configure").is_file() or not (source_root / "LICENSE").is_file():
        raise RuntimeBuildError("Wine source archive is incomplete")
    return source_root


def compile_wine(build_root: Path, contract: dict, source_archive: Path, jobs: int) -> Path:
    fixed = build_root / "build"
    source_parent = fixed / "source"
    build_dir = fixed / "wine-build"
    stage_dir = fixed / "wine-stage"
    fixed.mkdir(parents=True, exist_ok=True)
    source_root = safe_extract_wine(source_archive, source_parent)
    canonical_source = fixed / "wine-source"
    source_root.rename(canonical_source)
    source_parent.rmdir()
    build_dir.mkdir()
    stage_dir.mkdir()

    configure_args = " ".join(shlex.quote(item) for item in contract["engine"]["configure_args"])
    command = (
        "export SOURCE_DATE_EPOCH=0 TZ=UTC LC_ALL=C LANG=C ZERO_AR_DATE=1; "
        "cd /build/wine-build; "
        f"/build/wine-source/configure {configure_args}; "
        f"make -j{jobs}; "
        "make DESTDIR=/build/wine-stage install"
    )
    CORE.proot_rootfs(build_root, command)

    staged_prefix = stage_dir / RUNTIME_PREFIX
    if not staged_prefix.is_dir():
        raise RuntimeBuildError("Wine install did not create the expected staged prefix")
    return staged_prefix


def clear_transient_runtime_state(rootfs: Path) -> None:
    for relative in (
        "etc/resolv.conf",
        "etc/machine-id",
        "var/lib/dbus/machine-id",
    ):
        path = rootfs / relative
        if path.exists() or path.is_symlink():
            path.unlink()

    apk_cache = rootfs / "var/cache/apk"
    if apk_cache.exists():
        if apk_cache.is_symlink() or not apk_cache.is_dir():
            raise RuntimeBuildError("APK cache path is unsafe")
        shutil.rmtree(apk_cache)
    apk_cache.mkdir(parents=True, exist_ok=True)
    apk_cache.chmod(0o755)

    font_cache = rootfs / "var/cache/fontconfig"
    if font_cache.exists():
        if font_cache.is_symlink() or not font_cache.is_dir():
            raise RuntimeBuildError("fontconfig cache path is unsafe")
        shutil.rmtree(font_cache)
    font_cache.mkdir(parents=True, exist_ok=True)
    font_cache.chmod(0o755)


def copy_wine_runtime(staged_prefix: Path, runtime_root: Path) -> None:
    destination = runtime_root / RUNTIME_PREFIX
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(staged_prefix, destination, symlinks=True)


def verify_wine_runtime_tree(rootfs: Path) -> dict[str, object]:
    prefix = rootfs / RUNTIME_PREFIX
    required_exec = (
        "bin/wine",
        "bin/wineboot",
        "bin/wineserver",
        "bin/msiexec",
    )
    for relative in required_exec:
        path = prefix / relative
        if path.is_symlink():
            resolved = path.resolve(strict=False)
            try:
                resolved.relative_to(prefix)
            except ValueError as exc:
                raise RuntimeBuildError(f"Wine executable symlink escaped prefix: {relative}") from exc
        if not path.exists() or not path.is_file():
            raise RuntimeBuildError(f"required Wine runtime executable missing: {relative}")
        if not os.access(path, os.X_OK):
            raise RuntimeBuildError(f"required Wine runtime executable is not executable: {relative}")

    architecture_dirs = (
        "lib/wine/i386-windows",
        "lib/wine/x86_64-windows",
        "lib/wine/x86_64-unix",
    )
    for relative in architecture_dirs:
        path = prefix / relative
        if not path.is_dir():
            raise RuntimeBuildError(f"required Wine architecture tree missing: {relative}")

    for relative in (
        "lib/wine/i386-windows/ntdll.dll",
        "lib/wine/x86_64-windows/ntdll.dll",
    ):
        if not (prefix / relative).is_file():
            raise RuntimeBuildError(f"required Wine PE module missing: {relative}")

    CORE.proot_rootfs(
        rootfs,
        "HOME=/tmp WINEPREFIX=/tmp/ordax-wine-version-check "
        "/opt/ordax/windows-compat/wine/bin/wine --version "
        "> /tmp/ordax-wine-version.txt",
    )
    version_file = rootfs / "tmp/ordax-wine-version.txt"
    if not version_file.is_file():
        raise RuntimeBuildError("Wine version proof was not produced")
    version_text = version_file.read_text(encoding="utf-8").strip()
    if version_text != "wine-11.0":
        raise RuntimeBuildError(f"unexpected Wine version: {version_text!r}")
    version_file.unlink()
    prefix_dir = rootfs / "tmp/ordax-wine-version-check"
    if prefix_dir.exists():
        shutil.rmtree(prefix_dir)

    forbidden_unix_patterns = (
        "winewayland.drv.so",
        "winepulse.drv.so",
    )
    unix_root = prefix / "lib/wine/x86_64-unix"
    forbidden_found = [
        path.name
        for path in unix_root.rglob("*")
        if path.is_file() and path.name in forbidden_unix_patterns
    ]
    if forbidden_found:
        raise RuntimeBuildError(
            f"disabled Wine Unix drivers were unexpectedly built: {sorted(forbidden_found)}"
        )

    return {
        "version": version_text,
        "required_executables": list(required_exec),
        "architecture_trees": list(architecture_dirs),
        "forbidden_unix_drivers_present": False,
    }


def normalize_tree(rootfs: Path) -> None:
    for path in rootfs.rglob("*"):
        if path.is_symlink():
            continue
        try:
            os.utime(path, (0, 0), follow_symlinks=False)
        except OSError as exc:
            raise RuntimeBuildError(f"cannot normalize timestamp: {path}") from exc


def sha256_file(path: Path) -> str:
    return DISCOVERY.sha256_file(path)


def write_tree_manifest(rootfs: Path, destination: Path) -> str:
    entries: list[dict[str, object]] = []
    for path in sorted(rootfs.rglob("*"), key=lambda p: p.relative_to(rootfs).as_posix()):
        relative = path.relative_to(rootfs).as_posix()
        info = path.lstat()
        mode = stat.S_IMODE(info.st_mode)
        if path.is_dir():
            entries.append({"path": relative, "type": "dir", "mode": mode})
        elif path.is_file():
            entries.append(
                {
                    "path": relative,
                    "type": "file",
                    "mode": mode,
                    "size": info.st_size,
                    "sha256": sha256_file(path),
                }
            )
        elif path.is_symlink():
            target = os.readlink(path)
            if os.path.isabs(target) or ".." in Path(target).parts:
                raise RuntimeBuildError(f"unsafe runtime symlink: {relative} -> {target}")
            entries.append(
                {"path": relative, "type": "symlink", "mode": mode, "target": target}
            )
        else:
            raise RuntimeBuildError(f"unsupported object reached runtime manifest: {relative}")
    payload = {
        "$schema": "prototype-ordax.windows-compat-runtime-tree/1",
        "entry_count": len(entries),
        "entries": entries,
    }
    destination.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return sha256_file(destination)


def normalized_tar(rootfs: Path, destination: Path) -> None:
    entries = [rootfs] + sorted(
        rootfs.rglob("*"), key=lambda p: p.relative_to(rootfs).as_posix()
    )
    with tarfile.open(
        destination, "w", format=tarfile.PAX_FORMAT, dereference=False
    ) as archive:
        for path in entries:
            relative = "." if path == rootfs else path.relative_to(rootfs).as_posix()
            info = archive.gettarinfo(str(path), arcname=relative)
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            info.mtime = 0
            info.pax_headers = {}
            if info.isfile():
                with path.open("rb") as handle:
                    archive.addfile(info, handle)
            elif info.isdir() or info.issym():
                archive.addfile(info)
            else:
                raise RuntimeBuildError(
                    f"unsupported object reached normalized runtime tar: {relative}"
                )


def erofs_identity(path: Path) -> dict[str, str]:
    result = run(
        ["blkid", "-p", "-o", "export", str(path)],
        capture=True,
    )
    values: dict[str, str] = {}
    for line in result.stdout.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    return values


def build(out_dir: Path, cache_dir: Path, jobs: int) -> dict:
    contract = DISCOVERY.load_contract()
    if platform.system() != "Linux" or platform.machine() not in {"x86_64", "amd64"}:
        raise RuntimeBuildError("Windows compatibility runtime build requires x86_64 Linux")
    if not isinstance(jobs, int) or jobs < 1 or jobs > 8:
        raise RuntimeBuildError("build jobs must be between 1 and 8")
    for program in ("proot", "mkfs.erofs", "fsck.erofs", "blkid"):
        if shutil.which(program) is None:
            raise RuntimeBuildError(f"required runtime build tool missing: {program}")

    out_dir = out_dir.resolve()
    cache_dir = cache_dir.resolve()
    if out_dir.exists() and any(out_dir.iterdir()):
        raise RuntimeBuildError("output directory must be empty")
    out_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)

    source_name = Path(contract["engine"]["source_url"]).name
    source_archive = DISCOVERY.download_exact(
        contract["engine"]["source_url"],
        cache_dir / source_name,
        contract["engine"]["source_sha256"],
        contract["engine"]["source_size_bytes"],
    )

    work = Path(tempfile.mkdtemp(prefix="ordax-windows-compat-build-"))
    try:
        build_root = work / "build-rootfs"
        runtime_root = work / "runtime-rootfs"
        prepare_alpine_root(
            build_root,
            contract,
            cache_dir,
            contract["build_apk_package_lock"],
            "build",
        )
        staged_prefix = compile_wine(build_root, contract, source_archive, jobs)

        prepare_alpine_root(
            runtime_root,
            contract,
            cache_dir,
            contract["runtime_apk_package_lock"],
            "runtime",
        )
        clear_transient_runtime_state(runtime_root)
        copy_wine_runtime(staged_prefix, runtime_root)
        CORE.flatten_symlinks(runtime_root)
        runtime_proof = verify_wine_runtime_tree(runtime_root)
        normalize_tree(runtime_root)

        tree_manifest = out_dir / "windows-compat-runtime-tree.json"
        tree_manifest_sha = write_tree_manifest(runtime_root, tree_manifest)

        tar_path = work / "windows-compat-runtime.tar"
        normalized_tar(runtime_root, tar_path)
        tar_sha = sha256_file(tar_path)
        image_uuid = str(uuid.uuid5(UUID_NAMESPACE, tar_sha))
        image = out_dir / contract["artifact"]["name"]
        run(
            [
                "mkfs.erofs",
                "--tar=f",
                "-zlz4",
                "-T",
                "0",
                "-U",
                image_uuid,
                "-L",
                VOLUME_LABEL,
                "--all-root",
                str(image),
                str(tar_path),
            ]
        )
        run(["fsck.erofs", str(image)])
        identity = erofs_identity(image)
        if (
            identity.get("TYPE") != "erofs"
            or identity.get("LABEL") != VOLUME_LABEL
            or identity.get("UUID", "").lower() != image_uuid
        ):
            raise RuntimeBuildError("Windows compatibility runtime EROFS identity mismatch")

        result = {
            "$schema": "prototype-ordax.windows-compat-runtime-provenance/1",
            "status": "owner-development-candidate-not-executable",
            "source_commit": source_commit(),
            "runtime_id": contract["runtime_id"],
            "product_scope": contract["product_scope"],
            "wine_source_sha256": contract["engine"]["source_sha256"],
            "wine_source_size_bytes": contract["engine"]["source_size_bytes"],
            "alpine_archive_sha256": contract["alpine"]["archive_sha256"],
            "build_apk_package_lock_count": contract["build_apk_package_lock_count"],
            "runtime_apk_package_lock_count": contract["runtime_apk_package_lock_count"],
            "wine_runtime": runtime_proof,
            "tree_manifest_sha256": tree_manifest_sha,
            "normalized_tar_sha256": tar_sha,
            "image": {
                "name": image.name,
                "filesystem": "erofs",
                "label": VOLUME_LABEL,
                "uuid": image_uuid,
                "sha256": sha256_file(image),
                "size": image.stat().st_size,
            },
            "execution_adapter_connected": False,
            "installation_adapter_connected": False,
            "stable_mvp_enabled": False,
            "public_availability": False,
            "release_manifest_connected": False,
            "component_slot_connected": False,
            "physical_artifact_authorized": False,
        }
        (out_dir / "windows-compat-runtime-provenance.json").write_text(
            json.dumps(result, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return result
    finally:
        shutil.rmtree(work, ignore_errors=True)


def verify(out_dir: Path) -> dict:
    contract = DISCOVERY.load_contract()
    out_dir = out_dir.resolve()
    image = out_dir / contract["artifact"]["name"]
    provenance_path = out_dir / "windows-compat-runtime-provenance.json"
    tree_path = out_dir / "windows-compat-runtime-tree.json"
    for path, label in (
        (image, "EROFS candidate"),
        (provenance_path, "provenance"),
        (tree_path, "tree manifest"),
    ):
        if path.is_symlink() or not path.is_file():
            raise RuntimeBuildError(f"Windows compatibility runtime {label} is missing")
    try:
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeBuildError(f"cannot read runtime provenance: {exc}") from exc
    if provenance.get("$schema") != "prototype-ordax.windows-compat-runtime-provenance/1":
        raise RuntimeBuildError("unexpected Windows compatibility runtime provenance schema")
    if provenance.get("status") != "owner-development-candidate-not-executable":
        raise RuntimeBuildError("Windows compatibility runtime crossed execution/promotion boundary")
    if provenance.get("runtime_id") != contract["runtime_id"]:
        raise RuntimeBuildError("Windows compatibility runtime id differs from contract")
    if provenance.get("wine_source_sha256") != contract["engine"]["source_sha256"]:
        raise RuntimeBuildError("Wine source identity differs from contract")
    if provenance.get("tree_manifest_sha256") != sha256_file(tree_path):
        raise RuntimeBuildError("runtime tree manifest digest differs from provenance")
    if provenance.get("image", {}).get("sha256") != sha256_file(image):
        raise RuntimeBuildError("runtime image digest differs from provenance")
    for field in (
        "execution_adapter_connected",
        "installation_adapter_connected",
        "stable_mvp_enabled",
        "public_availability",
        "release_manifest_connected",
        "component_slot_connected",
        "physical_artifact_authorized",
    ):
        if provenance.get(field) is not False:
            raise RuntimeBuildError(f"runtime provenance unexpectedly enables {field}")
    identity = erofs_identity(image)
    if (
        identity.get("TYPE") != "erofs"
        or identity.get("LABEL") != VOLUME_LABEL
        or identity.get("UUID", "").lower() != provenance.get("image", {}).get("uuid")
    ):
        raise RuntimeBuildError("runtime EROFS filesystem identity mismatch")
    return provenance


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    build_parser = sub.add_parser("build")
    build_parser.add_argument("--out-dir", type=Path, required=True)
    build_parser.add_argument("--cache-dir", type=Path, required=True)
    build_parser.add_argument("--jobs", type=int, default=2)
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = (
            build(args.out_dir, args.cache_dir, args.jobs)
            if args.command == "build"
            else verify(args.out_dir)
        )
    except (
        RuntimeBuildError,
        DISCOVERY.DiscoveryError,
        CORE.BuildError,
        OSError,
        json.JSONDecodeError,
        tarfile.TarError,
    ) as exc:
        print(f"windows-compat-runtime-build: ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
