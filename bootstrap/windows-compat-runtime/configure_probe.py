#!/usr/bin/env python3
"""Prove that the pinned Wine source configures on the pinned OrdaX Alpine substrate.

This is a discovery gate. It installs build dependencies only inside a temporary
Alpine rootfs, runs Wine configure, and records the exact installed APK closure
plus toolchain versions. It does not compile, package, install, activate, or
execute Wine.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
ENVIRONMENT = HERE / "build-environment.json"
SOURCE_BUILDER = HERE / "build.py"
ALPINE_CORE = ROOT / "bootstrap/base/alpine_core.py"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SAFE_PACKAGE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9+._-]{0,127}$")
SAFE_VERSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9+._~:-]{0,255}$")
MAX_ALPINE_ROOTFS_BYTES = 32 * 1024 * 1024


class ConfigureProofError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ConfigureProofError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SOURCE = load_module("ordax_windows_compat_source_builder", SOURCE_BUILDER)
ALPINE = load_module("ordax_alpine_base_core_for_windows_compat", ALPINE_CORE)


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ConfigureProofError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise ConfigureProofError(f"{label} must be an object")
    return value


def validate_environment(value: dict) -> dict:
    if value.get("$schema") != "prototype-ordax.windows-compat-build-environment/1":
        raise ConfigureProofError("unexpected build environment schema")
    if value.get("status") != "configure-proof-discovery-not-promotable":
        raise ConfigureProofError("build environment status drifted")

    host = value.get("host")
    expected_host = {
        "distribution": "alpine",
        "version": "3.22.5",
        "branch": "v3.22",
        "arch": "x86_64",
        "libc": "musl",
        "rootfs_url": "https://dl-cdn.alpinelinux.org/alpine/v3.22/releases/x86_64/alpine-minirootfs-3.22.5-x86_64.tar.gz",
        "rootfs_sha256": "4b4daa9fe2fc696c4919c4412a4c3d3e770d8fb70292a004a2c72f5096175282",
    }
    if host != expected_host:
        raise ConfigureProofError("pinned Alpine host identity drifted")
    if (
        ALPINE.ALPINE_VERSION != host["version"]
        or ALPINE.ALPINE_BRANCH != host["branch"]
        or ALPINE.ARCH != host["arch"]
        or ALPINE.ARCHIVE_URL != host["rootfs_url"]
    ):
        raise ConfigureProofError("configure proof Alpine identity diverged from canonical OrdaX base core")

    reference = value.get("packaging_reference")
    expected_reference = {
        "repository": "https://github.com/alpinelinux/aports",
        "commit": "78e9baad1fc91415c7617dc91bd930e21ed068de",
        "path": "community/wine/APKBUILD",
        "wine_version": "11.0",
        "role": "dependency-and-configure-reference-only",
    }
    if reference != expected_reference:
        raise ConfigureProofError("Alpine packaging reference drifted")

    base_packages = value.get("base_build_packages")
    wine_packages = value.get("wine_build_packages")
    if not isinstance(base_packages, list) or not isinstance(wine_packages, list):
        raise ConfigureProofError("build package lists are missing")
    if len(set(base_packages + wine_packages)) != len(base_packages + wine_packages):
        raise ConfigureProofError("build package lists contain duplicates")
    for package in base_packages + wine_packages:
        if not isinstance(package, str) or not SAFE_PACKAGE_RE.fullmatch(package):
            raise ConfigureProofError(f"unsafe build package name: {package!r}")
    for required in ("build-base", "i686-mingw-w64-gcc", "mingw-w64-gcc"):
        if required not in base_packages + wine_packages:
            raise ConfigureProofError(f"required build package missing: {required}")

    configure = value.get("configure")
    expected_flags = [
        "--with-dbus",
        "--with-mingw",
        "--with-x",
        "--with-vulkan",
        "--enable-tools",
        "--enable-win64",
        "--enable-archs=x86_64,i386",
    ]
    if not isinstance(configure, dict) or configure != {
        "prefix": "/usr",
        "libdir": "/usr/lib",
        "sysconfdir": "/etc",
        "localstatedir": "/var",
        "flags": expected_flags,
        "opencl_header_compat_edit_required": True,
    }:
        raise ConfigureProofError("configure intent drifted")

    proof = value.get("proof")
    expected_proof = {
        "package_versions_pinned": False,
        "configure_proof_passed": False,
        "full_build_proof_passed": False,
        "runtime_dependency_inventory_complete": False,
        "binary_artifact_pinned": False,
        "activation_authorized": False,
        "execution_authorized": False,
    }
    if proof != expected_proof:
        raise ConfigureProofError("unproven configure environment claims readiness")
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_exact(url: str, destination: Path, expected_sha256: str, max_bytes: int) -> Path:
    if not SHA256_RE.fullmatch(expected_sha256):
        raise ConfigureProofError("invalid pinned SHA-256")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file() and sha256_file(destination) == expected_sha256:
        return destination
    destination.unlink(missing_ok=True)
    part = destination.with_name(destination.name + ".part")
    part.unlink(missing_ok=True)
    digest = hashlib.sha256()
    total = 0
    request = urllib.request.Request(url, headers={"User-Agent": "OrdaX-wine-configure-proof/1"})
    try:
        with urllib.request.urlopen(request, timeout=180) as response, part.open("wb") as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise ConfigureProofError("download exceeded configured bound")
                digest.update(chunk)
                output.write(chunk)
    except Exception as exc:
        part.unlink(missing_ok=True)
        if isinstance(exc, ConfigureProofError):
            raise
        raise ConfigureProofError(f"download failed: {exc}") from exc
    actual = digest.hexdigest()
    if actual != expected_sha256:
        part.unlink(missing_ok=True)
        raise ConfigureProofError(f"download digest mismatch: expected={expected_sha256} actual={actual}")
    part.replace(destination)
    return destination


def safe_extract_foreign_source(archive: Path, destination: Path, expected_root: str) -> None:
    """Strict extractor for untrusted foreign source bytes."""
    destination.mkdir(parents=True, exist_ok=True)
    try:
        with tarfile.open(archive, "r:xz") as tar:
            members = []
            for member in tar.getmembers():
                name = member.name
                while name.startswith("./"):
                    name = name[2:]
                path = PurePosixPath(name)
                if not name or path.is_absolute() or ".." in path.parts:
                    raise ConfigureProofError(f"unsafe foreign source archive path: {member.name}")
                if not path.parts or path.parts[0] != expected_root:
                    raise ConfigureProofError(f"foreign source member outside expected root: {member.name}")
                if member.isdev() or member.isfifo():
                    raise ConfigureProofError(f"unsupported foreign source archive object: {member.name}")
                if member.issym() and os.path.isabs(member.linkname):
                    raise ConfigureProofError(f"absolute foreign source symlink forbidden: {member.name}")
                if member.islnk() and os.path.isabs(member.linkname):
                    raise ConfigureProofError(f"absolute foreign source hardlink forbidden: {member.name}")
                members.append(member)
            tar.extractall(destination, members=members, filter="data")
    except (tarfile.TarError, OSError) as exc:
        raise ConfigureProofError(f"foreign source extraction failed: {exc}") from exc


def run(argv: list[str], *, cwd: Path | None = None, capture: bool = False) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(argv, cwd=cwd, check=True, text=True, capture_output=capture)
    except (OSError, subprocess.CalledProcessError) as exc:
        command = " ".join(argv)
        if isinstance(exc, subprocess.CalledProcessError):
            detail = (exc.stderr or exc.stdout or "").strip()
            if detail:
                detail = f": {detail[-4000:]}"
        else:
            detail = f": {exc}"
        raise ConfigureProofError(f"command failed: {command}{detail}") from exc


def proot(rootfs: Path, command: str, *, capture: bool = False) -> subprocess.CompletedProcess:
    binary = shutil.which("proot")
    if not binary:
        raise ConfigureProofError("proot is required for configure proof")
    return run([
        binary,
        "-S",
        str(rootfs),
        "-w",
        "/",
        "/bin/sh",
        "-ec",
        command,
    ], capture=capture)


def shell_quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


def installed_package_versions(rootfs: Path) -> dict[str, str]:
    """Read exact package identities from apk's installed database.

    `apk info -v <name>` is intentionally not used: on Alpine it emits verbose
    package descriptions, which is not an artifact identity. The installed DB
    is the local authority for the exact name/version closure materialized in
    this proof rootfs.
    """
    database = rootfs / "lib/apk/db/installed"
    try:
        text = database.read_text(encoding="utf-8")
    except OSError as exc:
        raise ConfigureProofError(f"cannot read installed APK database: {exc}") from exc

    result: dict[str, str] = {}
    for record in text.split("\n\n"):
        fields: dict[str, str] = {}
        for line in record.splitlines():
            if len(line) >= 3 and line[1] == ":":
                fields[line[0]] = line[2:]
        name = fields.get("P")
        version = fields.get("V")
        if name is None and version is None:
            continue
        if not name or not SAFE_PACKAGE_RE.fullmatch(name):
            raise ConfigureProofError(f"invalid installed APK package name: {name!r}")
        if not version or not SAFE_VERSION_RE.fullmatch(version):
            raise ConfigureProofError(f"invalid installed APK package version for {name}: {version!r}")
        if name in result:
            raise ConfigureProofError(f"duplicate installed APK package identity: {name}")
        result[name] = version

    if not result:
        raise ConfigureProofError("installed APK package closure is empty")
    return dict(sorted(result.items()))


def tool_version(rootfs: Path, command: str) -> str:
    completed = proot(rootfs, f"{command} --version | head -n 1", capture=True)
    value = completed.stdout.strip()
    if not value:
        raise ConfigureProofError(f"cannot resolve tool version: {command}")
    return value


def perform_configure_proof(environment: dict, work_dir: Path) -> dict:
    source_contract = SOURCE.validate_source(SOURCE.load_source())
    host = environment["host"]
    cache = work_dir / "cache"
    rootfs_archive = download_exact(
        host["rootfs_url"],
        cache / Path(host["rootfs_url"]).name,
        host["rootfs_sha256"],
        MAX_ALPINE_ROOTFS_BYTES,
    )
    rootfs = work_dir / "rootfs"
    try:
        ALPINE.safe_extract(rootfs_archive, rootfs)
    except ALPINE.BuildError as exc:
        raise ConfigureProofError(f"canonical Alpine rootfs extraction failed: {exc}") from exc

    repositories = rootfs / "etc/apk/repositories"
    repositories.write_text(
        "https://dl-cdn.alpinelinux.org/alpine/v3.22/main\n"
        "https://dl-cdn.alpinelinux.org/alpine/v3.22/community\n",
        encoding="utf-8",
    )
    host_resolv = Path("/etc/resolv.conf")
    if host_resolv.is_file():
        (rootfs / "etc/resolv.conf").write_bytes(host_resolv.read_bytes())

    packages = environment["base_build_packages"] + environment["wine_build_packages"]
    install_command = "apk add --no-cache " + " ".join(shell_quote(package) for package in packages)
    proot(rootfs, install_command)

    installed_closure = installed_package_versions(rootfs)
    missing_requested = [package for package in packages if package not in installed_closure]
    if missing_requested:
        raise ConfigureProofError(f"requested build packages missing from installed closure: {missing_requested}")
    requested_versions = {package: installed_closure[package] for package in packages}

    wine_archive = SOURCE.download_exact(source_contract, cache / "wine")
    source_root = rootfs / "build/source"
    safe_extract_foreign_source(
        wine_archive,
        source_root,
        source_contract["upstream"]["archive_root"],
    )
    wine_source = "/build/source/" + source_contract["upstream"]["archive_root"]
    build_dir = rootfs / "build/output"
    build_dir.mkdir(parents=True, exist_ok=True)

    triplet = proot(rootfs, "gcc -dumpmachine", capture=True).stdout.strip()
    if not triplet or any(ch.isspace() for ch in triplet):
        raise ConfigureProofError(f"invalid native compiler triplet: {triplet!r}")

    proot(rootfs, f"cd {shell_quote(wine_source)} && sed -i 's|OpenCL/opencl.h|CL/opencl.h|g' configure*")
    configure = environment["configure"]
    args = [
        f"{wine_source}/configure",
        f"--build={triplet}",
        f"--host={triplet}",
        f"--prefix={configure['prefix']}",
        f"--libdir={configure['libdir']}",
        f"--sysconfdir={configure['sysconfdir']}",
        f"--localstatedir={configure['localstatedir']}",
        *configure["flags"],
    ]
    configure_command = " ".join(shell_quote(arg) for arg in args)
    env_prefix = (
        "CFLAGS='-O2 -Wno-error=format-security' "
        "CXXFLAGS='-O2 -Wno-error=format-security' "
        "CPPFLAGS='-O2 -Wno-error=format-security' "
    )
    proot(
        rootfs,
        f"cd /build/output && {env_prefix}{configure_command} > configure.log 2>&1 || "
        "{ rc=$?; tail -n 200 configure.log >&2; exit $rc; }",
    )

    config_header = rootfs / "build/output/include/config.h"
    makefile = rootfs / "build/output/Makefile"
    if not config_header.is_file() or not makefile.is_file():
        raise ConfigureProofError("Wine configure did not create expected build outputs")

    return {
        "$schema": "prototype-ordax.windows-compat-configure-proof/1",
        "runtime_id": source_contract["runtime_id"],
        "wine_version": source_contract["version"],
        "host": host,
        "native_compiler_triplet": triplet,
        "toolchain": {
            "gcc": tool_version(rootfs, "gcc"),
            "x86_64_mingw_gcc": tool_version(rootfs, "x86_64-w64-mingw32-gcc"),
            "i686_mingw_gcc": tool_version(rootfs, "i686-w64-mingw32-gcc"),
        },
        "resolved_build_packages": requested_versions,
        "resolved_package_closure": installed_closure,
        "resolved_package_closure_count": len(installed_closure),
        "configure_flags": args[3:],
        "configure_proof_passed": True,
        "package_versions_pinned": False,
        "full_build_proof_passed": False,
        "binary_artifact_pinned": False,
        "activation_authorized": False,
        "execution_authorized": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check", "probe"])
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--proof-out", type=Path)
    args = parser.parse_args()

    environment = validate_environment(load_json(ENVIRONMENT, "build environment"))
    if args.command == "check":
        print("windows compatibility configure environment: PASS")
        return 0
    if args.work_dir is None:
        raise ConfigureProofError("--work-dir is required for probe")

    proof = perform_configure_proof(environment, args.work_dir.resolve())
    encoded = json.dumps(proof, indent=2, sort_keys=True) + "\n"
    if args.proof_out:
        args.proof_out.parent.mkdir(parents=True, exist_ok=True)
        args.proof_out.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ConfigureProofError as exc:
        print(f"windows-compat-configure: {exc}", file=__import__("sys").stderr)
        raise SystemExit(2)