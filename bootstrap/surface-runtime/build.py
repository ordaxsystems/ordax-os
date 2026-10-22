#!/usr/bin/env python3
"""Build the immutable offline graphical runtime for Stable/MVP USB.

The builder is intentionally fail-closed: it only runs after the complete
transitive APK lock has been committed to source.json. The output is a
candidate EROFS image; it does not alter boot configuration, physical media or
public promotion state.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "bootstrap/surface-runtime/source.json"
UUID_NAMESPACE = uuid.UUID("573341c4-050f-5ab8-b5af-021b59721ec6")
VOLUME_LABEL = "ORDAX-SURFACE"


class RuntimeBuildError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeBuildError(f"cannot load shared module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CORE = load_module("ordax_surface_runtime_build_core", ROOT / "bootstrap/base/alpine_core.py")


PACKAGE_CONFIG = load_module("ordax_surface_package_config", ROOT / "bootstrap/surface-runtime/package_config.py")

def load_contract() -> dict:
    try:
        value = json.loads(CONTRACT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeBuildError(f"cannot load Surface runtime contract: {exc}") from exc
    if value.get("$schema") != "prototype-ordax.surface-runtime-source/1":
        raise RuntimeBuildError("unexpected Surface runtime contract schema")
    if value.get("status") != "candidate-not-promotable":
        raise RuntimeBuildError("Surface runtime cannot build before reviewed APK lock is committed")
    if value.get("first_boot_offline_required") is not True:
        raise RuntimeBuildError("Stable/MVP first Surface boot must remain offline-capable")
    if value.get("network_package_install_during_stable_boot_allowed") is not False:
        raise RuntimeBuildError("Stable/MVP boot-time package downloads are forbidden")
    if value.get("apk_package_versions_pinned") is not True:
        raise RuntimeBuildError("Surface runtime APK versions are not pinned")
    lock = value.get("apk_package_lock")
    if not isinstance(lock, dict) or not lock:
        raise RuntimeBuildError("Surface runtime full transitive APK lock is missing")
    if value.get("apk_package_lock_count") != len(lock):
        raise RuntimeBuildError("Surface runtime APK lock count disagrees with lock")
    if value.get("apk_package_lock_sha256") != CORE.canonical_apk_lock_sha256(lock):
        raise RuntimeBuildError("Surface runtime APK lock digest differs from canonical version map")
    for name, version in lock.items():
        if (
            not isinstance(name, str)
            or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9+_.-]*", name) is None
            or not isinstance(version, str)
            or not version
            or any(ch.isspace() for ch in version)
        ):
            raise RuntimeBuildError("Surface runtime APK lock contains unsafe entry")
    requested = PACKAGE_CONFIG.requested_packages(value, ROOT)
    if not isinstance(requested, list) or not set(requested).issubset(lock):
        raise RuntimeBuildError("Surface runtime requested packages are not all locked")
    artifact = value.get("artifact", {})
    if artifact.get("physical_artifact_authorized") is not False:
        raise RuntimeBuildError("Surface runtime candidate may not authorize physical use")
    if artifact.get("portable_v3_boot_handoff_candidate_connected") is not True:
        raise RuntimeBuildError("Surface runtime candidate must be bound to the portable v3 boot handoff")
    if artifact.get("physical_boot_connected") is not False:
        raise RuntimeBuildError("Surface runtime candidate may not claim physical boot integration")
    return value


def installed_lock(rootfs: Path) -> dict[str, str]:
    database = rootfs / "lib/apk/db/installed"
    if database.is_symlink() or not database.is_file():
        raise RuntimeBuildError("Alpine installed package database is missing")
    packages: dict[str, str] = {}
    name = ""
    version = ""
    for line in database.read_text(encoding="utf-8", errors="strict").splitlines() + [""]:
        if line.startswith("P:"):
            name = line[2:].strip()
        elif line.startswith("V:"):
            version = line[2:].strip()
        elif line == "":
            if name or version:
                if not name or not version or name in packages:
                    raise RuntimeBuildError("Alpine installed package database is malformed")
                packages[name] = version
            name = ""
            version = ""
    if not packages:
        raise RuntimeBuildError("Alpine installed package lock is empty")
    return dict(sorted(packages.items()))


def exact_specs(contract: dict) -> list[str]:
    return [f"{name}={version}" for name, version in sorted(contract["apk_package_lock"].items())]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_commit() -> str:
    value = os.environ.get("ORDAX_SOURCE_COMMIT", "").strip().lower()
    if not value:
        try:
            value = subprocess.check_output(
                ["git", "-C", str(ROOT), "rev-parse", "HEAD"],
                text=True,
            ).strip().lower()
        except (OSError, subprocess.CalledProcessError) as exc:
            raise RuntimeBuildError("source commit is unavailable") from exc
    if re.fullmatch(r"[0-9a-f]{40}", value) is None:
        raise RuntimeBuildError("source commit must be lowercase 40-hex")
    return value


def prune_generated_runtime_state(rootfs: Path) -> None:
    # A release image must never bake one machine identity into every device.
    # The eventual writable runtime overlay owns device/session identity.
    for relative in ("etc/machine-id", "var/lib/dbus/machine-id"):
        path = rootfs / relative
        if path.exists() or path.is_symlink():
            path.unlink()

    # Fontconfig caches encode host/build-tree details and are purely derived
    # from the immutable fonts/configuration. Rebuild them in the writable
    # runtime layer instead of signing nondeterministic cache bytes.
    cache = rootfs / "var/cache/fontconfig"
    if cache.exists():
        if cache.is_symlink() or not cache.is_dir():
            raise RuntimeBuildError("fontconfig cache path is not a real directory")
        shutil.rmtree(cache)
    cache.mkdir(parents=True, exist_ok=True)
    cache.chmod(0o755)


def normalize_tree(rootfs: Path) -> None:
    for path in rootfs.rglob("*"):
        if path.is_symlink():
            continue
        try:
            os.utime(path, (0, 0), follow_symlinks=False)
        except OSError as exc:
            raise RuntimeBuildError(f"cannot normalize timestamp: {path}") from exc


def write_tree_manifest(rootfs: Path, destination: Path) -> str:
    entries: list[dict[str, object]] = []
    for path in sorted(rootfs.rglob("*"), key=lambda p: p.relative_to(rootfs).as_posix()):
        relative = path.relative_to(rootfs).as_posix()
        info = path.lstat()
        mode = stat.S_IMODE(info.st_mode)
        if path.is_dir():
            entries.append({"path": relative, "type": "dir", "mode": mode})
        elif path.is_file():
            entries.append({
                "path": relative,
                "type": "file",
                "mode": mode,
                "size": info.st_size,
                "sha256": sha256_file(path),
            })
        else:
            raise RuntimeBuildError(f"non-regular object reached runtime tree manifest: {relative}")
    payload = {
        "$schema": "prototype-ordax.surface-runtime-tree/1",
        "entry_count": len(entries),
        "entries": entries,
    }
    data = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    destination.write_text(data, encoding="utf-8")
    return sha256_file(destination)


def normalized_tar(rootfs: Path, destination: Path) -> None:
    entries = [rootfs] + sorted(rootfs.rglob("*"), key=lambda p: p.relative_to(rootfs).as_posix())
    with tarfile.open(destination, "w", format=tarfile.USTAR_FORMAT, dereference=True) as archive:
        for path in entries:
            relative = "." if path == rootfs else path.relative_to(rootfs).as_posix()
            info = archive.gettarinfo(str(path), arcname=relative)
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            info.mtime = 0
            if info.isfile():
                with path.open("rb") as handle:
                    archive.addfile(info, handle)
            elif info.isdir():
                archive.addfile(info)
            else:
                raise RuntimeBuildError(f"non-regular object reached normalized runtime tar: {relative}")


def verify_runtime_tree(rootfs: Path) -> None:
    required_exec = (
        "usr/bin/cage",
        "usr/bin/python3",
        "usr/bin/Xwayland",
        "usr/bin/seatd-launch",
        "sbin/udevd",
        "bin/udevadm",
        "bin/busybox",
    )
    for relative in required_exec:
        path = rootfs / relative
        if not path.is_file() or not os.access(path, os.X_OK):
            raise RuntimeBuildError(f"required graphical runtime executable missing: /{relative}")
    required_files = (
        "usr/lib/girepository-1.0/Gtk-3.0.typelib",
        "usr/lib/girepository-1.0/WebKit2-4.1.typelib",
        "usr/lib/udev/rules.d/60-input-id.rules",
    )
    for relative in required_files:
        if not (rootfs / relative).is_file():
            raise RuntimeBuildError(f"required graphical runtime file missing: /{relative}")


def erofs_identity(path: Path) -> dict[str, str]:
    result = subprocess.run(
        ["blkid", "-p", "-o", "export", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    values: dict[str, str] = {}
    for line in result.stdout.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    return values


def run(argv: list[str]) -> None:
    try:
        subprocess.run(argv, check=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        raise RuntimeBuildError(f"command failed: {' '.join(argv)}") from exc


def probe_runtime_media(rootfs: Path) -> None:
    # proot -S binds the host /tmp over guest /tmp; place the build-only
    # script at the guest root so that it is visible in the actual build.
    probe_path = rootfs / "ordax-media-runtime-probe.py"
    shutil.copyfile(ROOT / "system/surface/runtime/media_runtime_probe.py", probe_path)
    try:
        CORE.proot_rootfs(rootfs, "python3 /ordax-media-runtime-probe.py")
    finally:
        probe_path.unlink(missing_ok=True)


def probe_runtime_audio_session(rootfs: Path) -> None:
    # Start the same session owner used by Surface in a device-less guest. A
    # live Pulse-compatible socket proves the software route without opening
    # an ALSA device or claiming physical playback.
    script_path = rootfs / "ordax-audio-session.sh"
    shutil.copyfile(ROOT / "system/surface/runtime/audio-session.sh", script_path)
    try:
        CORE.proot_rootfs(
            rootfs,
            "XDG_RUNTIME_DIR=/run/ordax-media-probe "
            "/bin/busybox sh /ordax-audio-session.sh "
            "--runtime-dir /run/ordax-media-probe -- /usr/bin/pactl info",
        )
    except Exception as exc:
        raise RuntimeBuildError("PipeWire audio session failed its device-less startup probe") from exc
    finally:
        script_path.unlink(missing_ok=True)


def build(out_dir: Path, cache_dir: Path) -> dict:
    contract = load_contract()
    if platform.system() != "Linux" or platform.machine() not in {"x86_64", "amd64"}:
        raise RuntimeBuildError("Surface runtime build requires x86_64 Linux")
    for program in ("proot", "mkfs.erofs", "fsck.erofs", "blkid"):
        if shutil.which(program) is None:
            raise RuntimeBuildError(f"required runtime build tool missing: {program}")

    out_dir = out_dir.resolve()
    cache_dir = cache_dir.resolve()
    if out_dir.exists() and any(out_dir.iterdir()):
        raise RuntimeBuildError("output directory must be empty")
    out_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)

    work = Path(tempfile.mkdtemp(prefix="ordax-surface-runtime-build-"))
    try:
        archive, actual_sha = CORE.download_verified(cache_dir)
        expected_sha = contract["alpine"]["archive_sha256"]
        if actual_sha != expected_sha:
            raise RuntimeBuildError(
                f"pinned Alpine archive mismatch: expected={expected_sha} actual={actual_sha}"
            )
        rootfs = work / "rootfs"
        rootfs.mkdir()
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

        CORE.proot_rootfs(rootfs, "apk add --no-cache " + " ".join(exact_specs(contract)))
        installed = installed_lock(rootfs)
        expected_lock = dict(sorted(contract["apk_package_lock"].items()))
        if installed != expected_lock:
            missing = sorted(set(expected_lock) - set(installed))
            extra = sorted(set(installed) - set(expected_lock))
            changed = sorted(
                name for name in set(expected_lock) & set(installed)
                if expected_lock[name] != installed[name]
            )
            raise RuntimeBuildError(
                f"Surface runtime APK lock mismatch: missing={missing[:8]} extra={extra[:8]} changed={changed[:8]}"
            )

        # Test the installed codec pipeline before packaging immutable bytes.
        # The probe creates only disposable fixtures and never accesses devices.
        probe_runtime_media(rootfs)
        probe_runtime_audio_session(rootfs)

        for transient in ("etc/resolv.conf",):
            path = rootfs / transient
            if path.exists() or path.is_symlink():
                path.unlink()
        cache = rootfs / "var/cache/apk"
        if cache.is_dir():
            shutil.rmtree(cache)
            cache.mkdir(parents=True)

        CORE.flatten_symlinks(rootfs)
        verify_runtime_tree(rootfs)
        prune_generated_runtime_state(rootfs)
        normalize_tree(rootfs)

        tree_manifest_path = out_dir / "surface-runtime-tree.json"
        tree_manifest_sha = write_tree_manifest(rootfs, tree_manifest_path)

        tar_path = work / "native-surface-runtime.tar"
        normalized_tar(rootfs, tar_path)
        tar_sha = sha256_file(tar_path)
        image_uuid = str(uuid.uuid5(UUID_NAMESPACE, tar_sha))
        image = out_dir / contract["artifact"]["name"]
        run([
            "mkfs.erofs",
            "--tar=f",
            "-zlz4",
            "-T", "0",
            "-U", image_uuid,
            "-L", VOLUME_LABEL,
            "--all-root",
            str(image),
            str(tar_path),
        ])
        run(["fsck.erofs", str(image)])
        identity = erofs_identity(image)
        if (
            identity.get("TYPE") != "erofs"
            or identity.get("LABEL") != VOLUME_LABEL
            or identity.get("UUID", "").lower() != image_uuid
        ):
            raise RuntimeBuildError("Surface runtime EROFS identity mismatch")

        result = {
            "$schema": "prototype-ordax.surface-runtime-provenance/1",
            "status": "candidate-not-promotable",
            "source_commit": source_commit(),
            "runtime_id": contract["runtime_id"],
            "alpine_archive_sha256": actual_sha,
            "apk_package_lock_count": len(installed),
            "apk_package_lock_sha256": CORE.canonical_apk_lock_sha256(installed),
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
            "first_boot_offline_required": True,
            "network_package_install_during_stable_boot_allowed": False,
            "machine_identity_baked_into_image": False,
            "fontconfig_cache_baked_into_image": False,
            "physical_artifact_authorized": False,
            "portable_v3_boot_handoff_candidate_connected": True,
            "physical_boot_connected": False,
        }
        (out_dir / "surface-runtime-provenance.json").write_text(
            json.dumps(result, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return result
    finally:
        shutil.rmtree(work, ignore_errors=True)


def verify(out_dir: Path) -> dict:
    contract = load_contract()
    image = out_dir.resolve() / contract["artifact"]["name"]
    provenance_path = out_dir.resolve() / "surface-runtime-provenance.json"
    tree_manifest_path = out_dir.resolve() / "surface-runtime-tree.json"
    if image.is_symlink() or not image.is_file():
        raise RuntimeBuildError("Surface runtime EROFS candidate is missing")
    if provenance_path.is_symlink() or not provenance_path.is_file():
        raise RuntimeBuildError("Surface runtime provenance is missing")
    if tree_manifest_path.is_symlink() or not tree_manifest_path.is_file():
        raise RuntimeBuildError("Surface runtime tree manifest is missing")
    try:
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeBuildError(f"cannot read runtime provenance: {exc}") from exc
    if provenance.get("$schema") != "prototype-ordax.surface-runtime-provenance/1":
        raise RuntimeBuildError("unexpected Surface runtime provenance schema")
    if provenance.get("status") != "candidate-not-promotable":
        raise RuntimeBuildError("Surface runtime provenance crossed promotion boundary")
    if provenance.get("runtime_id") != contract["runtime_id"]:
        raise RuntimeBuildError("Surface runtime id differs from contract")
    if provenance.get("apk_package_lock_sha256") != contract["apk_package_lock_sha256"]:
        raise RuntimeBuildError("Surface runtime installed APK versions differ from source lock")
    if provenance.get("image", {}).get("sha256") != sha256_file(image):
        raise RuntimeBuildError("Surface runtime image SHA-256 differs from provenance")
    if provenance.get("tree_manifest_sha256") != sha256_file(tree_manifest_path):
        raise RuntimeBuildError("Surface runtime tree manifest SHA-256 differs from provenance")
    if provenance.get("physical_artifact_authorized") is not False:
        raise RuntimeBuildError("Surface runtime provenance unexpectedly authorizes physical use")
    if provenance.get("portable_v3_boot_handoff_candidate_connected") is not True:
        raise RuntimeBuildError("Surface runtime provenance lost portable v3 handoff binding")
    if provenance.get("physical_boot_connected") is not False:
        raise RuntimeBuildError("Surface runtime provenance unexpectedly claims physical boot integration")
    identity = erofs_identity(image)
    if identity.get("TYPE") != "erofs" or identity.get("LABEL") != VOLUME_LABEL:
        raise RuntimeBuildError("Surface runtime EROFS filesystem identity mismatch")
    return provenance


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    build_parser = sub.add_parser("build")
    build_parser.add_argument("--out-dir", type=Path, required=True)
    build_parser.add_argument("--cache-dir", type=Path, required=True)
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = (
            build(args.out_dir, args.cache_dir)
            if args.command == "build"
            else verify(args.out_dir)
        )
    except (RuntimeBuildError, OSError, json.JSONDecodeError, CORE.BuildError) as exc:
        print(f"surface-runtime-build: ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
