#!/usr/bin/env python3
"""Isolated Buildroot base experiment. It cannot publish or replace Stable."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SOURCE = HERE / "source.json"
KERNEL = ROOT / "bootstrap/kernel/source.json"
STABLE = ROOT / "bootstrap/stable-base/source.json"
BOOT_HANDOFF = ROOT / "docs/contracts/portable-boot-handoff.json"
NETWORK = ROOT / "bootstrap/network/source.json"
CANONICAL_HANDOFF = ROOT / "bootstrap/stable-base/ordax-stable-init"
BASE_DEFCONFIG = HERE / "configs/ordax_minimal_defconfig"
BUSYBOX_FRAGMENT = HERE / "configs/portable-handoff.busybox.fragment"
IPROUTE2_PATCH_ROOT = HERE / "patches/iproute2"
IPROUTE2_PATCH_NAME = "0001-ordax-minimal-ip-only.patch"
IPROUTE2_PATCH_CONFIG = 'BR2_GLOBAL_PATCH_DIR="$(BR2_EXTERNAL_ORDAX_MINIMAL_PATH)/patches"'
BUSYBOX_HANDOFF_SYMBOLS = ("CONFIG_STAT=y", "CONFIG_FEATURE_STAT_FORMAT=y", "CONFIG_TIMEOUT=y", "CONFIG_FLOCK=y")
SUPPORTED_PROFILES = ("minimal", "owner-development")
OWNER_REQUIRED_CONFIG = (
    "BR2_PACKAGE_CA_CERTIFICATES=y",
    "BR2_PACKAGE_GIT=y",
    "BR2_PACKAGE_IW=y",
    "BR2_PACKAGE_WPA_SUPPLICANT=y",
    "BR2_PACKAGE_WPA_SUPPLICANT_PASSPHRASE=y",
)
HASH = re.compile(r"[0-9a-f]{64}\Z")


class BaseError(RuntimeError):
    pass


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def run(*args: str, cwd: Path | None = None, bounded_output: bool = False) -> str:
    argv = list(args)
    if bounded_output:
        # Buildroot can print many MiB of compilation progress. Stream its
        # combined output rather than retaining the entire build log in RAM;
        # preserve the same bounded diagnostic tail on failure.
        with subprocess.Popen(argv, cwd=cwd, stdout=subprocess.PIPE,
                              stderr=subprocess.STDOUT) as process:
            assert process.stdout is not None
            tail = b""
            for chunk in iter(lambda: process.stdout.read(65536), b""):
                tail = (tail + chunk)[-10000:]
            code = process.wait()
        output = tail.decode("utf-8", errors="replace")
    else:
        result = subprocess.run(argv, cwd=cwd, text=True, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, check=False)
        code = result.returncode
        output = result.stdout
    if code:
        raise BaseError(f"{' '.join(argv)} failed ({code}):\n" + output[-10000:])
    return output


def contracts() -> tuple[dict, dict, dict, dict]:
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    kernel = json.loads(KERNEL.read_text(encoding="utf-8"))
    stable = json.loads(STABLE.read_text(encoding="utf-8"))
    handoff = json.loads(BOOT_HANDOFF.read_text(encoding="utf-8"))
    network = json.loads(NETWORK.read_text(encoding="utf-8"))
    if source.get("$schema") != "prototype-ordax.independent-base-experiment/1":
        raise BaseError("unrecognized independent base source")
    if source.get("status") != "experimental-not-promotable":
        raise BaseError("experiment cannot be promoted")
    if source.get("physical_artifact_authorized") is not False or source.get("stable_channel_authorized") is not False:
        raise BaseError("physical or Stable promotion forbidden")
    if source.get("build_profile") != "ordax_minimal_defconfig":
        raise BaseError("canonical Independent Base defconfig identity drift")
    profiles = source.get("profiles")
    if not isinstance(profiles, dict) or set(profiles) != set(SUPPORTED_PROFILES):
        raise BaseError("Independent Base profile registry drift")
    expected_defconfig = str(BASE_DEFCONFIG.relative_to(ROOT))
    minimal = profiles.get("minimal")
    owner = profiles.get("owner-development")
    if minimal != {
        "defconfig": expected_defconfig,
        "fragment": None,
        "purpose": "portable-minimal-base-proof",
    }:
        raise BaseError("minimal profile contract drift")
    if owner != {
        "defconfig": expected_defconfig,
        "fragment": "bootstrap/independent-base/configs/owner-development.fragment",
        "purpose": "owner-development-parity-without-alpine",
    }:
        raise BaseError("Owner/Development profile contract drift")
    if kernel.get("$schema") != "prototype-ordax.kernel-source/1":
        raise BaseError("kernel contract mismatch")
    if not re.fullmatch(r"\d+\.\d+\.\d+", kernel.get("version", "")):
        raise BaseError("invalid canonical kernel version")
    if stable.get("$schema") != "prototype-ordax.stable-base-source/1":
        raise BaseError("stable format contract mismatch")
    if handoff.get("$schema") != "prototype-ordax.portable-boot-handoff/1":
        raise BaseError("canonical boot handoff schema mismatch")
    mount = handoff.get("proof", {}).get("release_mount", {})
    if mount.get("filesystem") != "erofs" or mount.get("read_only") is not True:
        raise BaseError("canonical immutable EROFS boot handoff changed")
    if stable["rootfs"]["format"] != mount["filesystem"] or stable["rootfs"]["read_only"] is not True:
        raise BaseError("Stable Base format incompatible with existing EROFS handoff")
    if stable["rootfs"]["compression"] != "lz4":
        raise BaseError("canonical base compression changed")
    if network.get("$schema") != "prototype-ordax.network-bootstrap-source/1":
        raise BaseError("network contract mismatch")
    if set(network["busybox"]["required_applets"]) != {"udhcpc", "route", "ifconfig"}:
        raise BaseError("network minimum changed")
    if source["kernel_source_contract"] != str(KERNEL.relative_to(ROOT)):
        raise BaseError("kernel SSOT drift")
    if source["erofs_format_contract"] != str(BOOT_HANDOFF.relative_to(ROOT)):
        raise BaseError("immutable EROFS handoff SSOT drift")
    if source["stable_base_layout_compatibility_contract"] != str(STABLE.relative_to(ROOT)):
        raise BaseError("Stable Base layout compatibility path drift")
    if source["network_source_contract"] != str(NETWORK.relative_to(ROOT)):
        raise BaseError("network SSOT drift")
    archive = source["buildroot"]
    if archive["url"] != "https://buildroot.org/downloads/buildroot-" + archive["version"] + ".tar.xz":
        raise BaseError("unexpected Buildroot upstream")
    if not HASH.fullmatch(archive["sha256"]):
        raise BaseError("unverified Buildroot digest")
    for key, name in (("bring_up_sha256", "bring-up"), ("dhcp_script_sha256", "udhcpc.script")):
        if digest(ROOT / "bootstrap/network" / name) != network["runtime"][key]:
            raise BaseError(f"canonical network script changed: {name}")
    return source, kernel, stable, network


def profile_inputs(source: dict, profile: str) -> dict:
    if profile not in SUPPORTED_PROFILES:
        raise BaseError(f"unsupported Independent Base profile: {profile}")
    spec = source["profiles"][profile]
    defconfig = ROOT / spec["defconfig"]
    if defconfig.is_symlink() or not defconfig.is_file():
        raise BaseError(f"profile defconfig is missing or unsafe: {spec['defconfig']}")
    fragment_value = spec["fragment"]
    fragment = None if fragment_value is None else ROOT / fragment_value
    if fragment is not None and (fragment.is_symlink() or not fragment.is_file()):
        raise BaseError(f"profile fragment is missing or unsafe: {fragment_value}")

    base_text = defconfig.read_text(encoding="utf-8")
    if profile == "minimal":
        leaked = [symbol for symbol in OWNER_REQUIRED_CONFIG if symbol in base_text]
        if leaked:
            raise BaseError(f"Owner capability leaked into minimal defconfig: {leaked}")
    else:
        assert fragment is not None
        fragment_lines = {
            line.strip()
            for line in fragment.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        }
        if fragment_lines != set(OWNER_REQUIRED_CONFIG):
            raise BaseError("Owner/Development fragment capability set drift")
        fragment_text = fragment.read_text(encoding="utf-8").lower()
        if "alpine" in fragment_text or "apk" in fragment_text:
            raise BaseError("Owner/Development fragment reintroduced Alpine/APK")

    return {
        "profile": profile,
        "purpose": spec["purpose"],
        "defconfig": defconfig,
        "fragment": fragment,
    }


def profile_provenance(inputs: dict) -> dict:
    fragment = inputs["fragment"]
    return {
        "name": inputs["profile"],
        "purpose": inputs["purpose"],
        "defconfig": str(inputs["defconfig"].relative_to(ROOT)),
        "defconfig_sha256": digest(inputs["defconfig"]),
        "fragment": None if fragment is None else str(fragment.relative_to(ROOT)),
        "fragment_sha256": None if fragment is None else digest(fragment),
    }


def generate_defconfig(source: dict, kernel: dict, profile: str, destination: Path) -> dict:
    inputs = profile_inputs(source, profile)
    pieces = [inputs["defconfig"].read_text(encoding="utf-8").rstrip()]
    if inputs["fragment"] is not None:
        pieces.append(inputs["fragment"].read_text(encoding="utf-8").rstrip())
    pieces.extend([
        "BR2_KERNEL_HEADERS_VERSION=y",
        f'BR2_DEFAULT_KERNEL_VERSION="{kernel["version"]}"',
        "BR2_PACKAGE_HOST_LINUX_HEADERS_CUSTOM_6_6=y",
        f'BR2_ROOTFS_POST_SCRIPT_ARGS="{profile}"',
    ])
    destination.write_text("\n".join(pieces) + "\n", encoding="utf-8")
    return inputs


def verify_resolved_config(config: str, kernel: dict, profile: str) -> None:
    required = (
        "BR2_KERNEL_HEADERS_VERSION=y",
        f'BR2_DEFAULT_KERNEL_VERSION="{kernel["version"]}"',
        "BR2_TOOLCHAIN_BUILDROOT_MUSL=y",
        "BR2_STATIC_LIBS=y",
        "BR2_INIT_NONE=y",
        "BR2_PACKAGE_IPROUTE2=y",
        IPROUTE2_PATCH_CONFIG,
        'BR2_PACKAGE_BUSYBOX_CONFIG_FRAGMENT_FILES="$(BR2_EXTERNAL_ORDAX_MINIMAL_PATH)/configs/portable-handoff.busybox.fragment"',
        f'BR2_ROOTFS_POST_SCRIPT_ARGS="{profile}"',
    )
    for key in required:
        if key not in config:
            raise BaseError(f"Buildroot rejected required configuration {key}")

    if profile == "owner-development":
        for key in OWNER_REQUIRED_CONFIG:
            if key not in config:
                raise BaseError(f"Buildroot rejected Owner/Development capability {key}")
        if "BR2_PACKAGE_KMOD=y" in config:
            raise BaseError("Owner/Development duplicated BusyBox modprobe with kmod")
    else:
        leaked = [key for key in OWNER_REQUIRED_CONFIG if key in config]
        if leaked:
            raise BaseError(f"minimal profile resolved Owner capabilities: {leaked}")


def source_archive(source: dict, cache: Path) -> Path:
    cache.mkdir(parents=True, exist_ok=True)
    version = source["buildroot"]["version"]
    target = cache / f"buildroot-{version}.tar.xz"
    expected = source["buildroot"]["sha256"]
    if target.exists() and digest(target) == expected:
        return target
    part = target.with_suffix(".part")
    part.unlink(missing_ok=True)
    try:
        with urllib.request.urlopen(source["buildroot"]["url"], timeout=120) as response:
            with part.open("wb") as stream:
                shutil.copyfileobj(response, stream)
        if digest(part) != expected:
            raise BaseError("Buildroot downloaded archive SHA-256 mismatch")
        part.replace(target)
        return target
    finally:
        part.unlink(missing_ok=True)


def safe_unpack(archive: Path, work: Path, version: str) -> Path:
    expected = f"buildroot-{version}"
    with tarfile.open(archive, "r:xz") as tf:
        for member in tf:
            parts = Path(member.name).parts
            if not parts or parts[0] != expected or ".." in parts or member.name.startswith("/"):
                raise BaseError("unsafe Buildroot tar path")
            if member.issym() or member.islnk():
                # Buildroot's upstream source ships absolute symlinks inside
                # filesystem *templates*. Their link text must be preserved as
                # data; applying Python's data-filter would corrupt this source.
                import posixpath
                link = member.linkname
                if member.islnk():
                    resolved = posixpath.normpath(link)
                    if not (resolved == expected or resolved.startswith(expected + "/")):
                        raise BaseError(f"unsafe Buildroot hardlink: {member.name} -> {link}")
                elif not link.startswith("/"):
                    resolved = posixpath.normpath(posixpath.join(
                        posixpath.dirname(member.name), link))
                    if not (resolved == expected or resolved.startswith(expected + "/")):
                        raise BaseError(f"unsafe Buildroot relative symlink: {member.name} -> {link}")
        # Archive content is authenticated against source.json before unpacking.
        # Reject all extraction of child entries below symlink member names, so
        # upstream template links cannot redirect writes outside this worktree.
        symlinks = {m.name for m in tf.getmembers() if m.issym()}
        for member in tf.getmembers():
            if any(member.name.startswith(link + "/") for link in symlinks):
                raise BaseError(f"tar traversal via symlink: {member.name}")
        tf.extractall(work, filter="fully_trusted")
    dest = work / expected
    if not (dest / "Makefile").is_file():
        raise BaseError("Buildroot source tree incomplete")
    return dest


def resolve_profile(cache: Path, profile: str) -> dict:
    source, kernel, stable, network = contracts()
    for prog in ("make", "gcc"):
        if not shutil.which(prog):
            raise BaseError(f"required Buildroot profile-resolution tool is missing: {prog}")
    temp = Path(tempfile.mkdtemp(prefix="ordax-independent-resolve-"))
    try:
        archive = source_archive(source, cache.resolve())
        br = safe_unpack(archive, temp, source["buildroot"]["version"])
        generated = temp / f"ordax_{profile.replace('-', '_')}_defconfig"
        inputs = generate_defconfig(source, kernel, profile, generated)
        build_dir = temp / "br-output"
        cmd = [
            "make", "-C", str(br), f"O={build_dir}",
            f"BR2_EXTERNAL={HERE}", f"BR2_DEFCONFIG={generated}",
        ]
        run(*cmd, "defconfig")
        config_path = build_dir / ".config"
        if config_path.is_symlink() or not config_path.is_file():
            raise BaseError("Buildroot did not materialize resolved .config")
        config = config_path.read_text(encoding="utf-8")
        verify_resolved_config(config, kernel, profile)
        return {
            "status": "profile-resolution-pass",
            "profile": profile,
            "profile_inputs": profile_provenance(inputs),
            "buildroot_sha256": digest(archive),
            "kernel": kernel["version"],
            "erofs": stable["rootfs"]["format"],
            "network": network["prototype_scope"],
            "rootfs_compiled": False,
            "kernel_compiled": False,
        }
    finally:
        shutil.rmtree(temp, ignore_errors=True)


def verify_iproute2_minimal_build(build_dir: Path) -> dict:
    """Bind the version-scoped minimal patch to the source Buildroot actually built."""
    package_root = build_dir / "build"
    sources = sorted(path for path in package_root.glob("iproute2-*") if path.is_dir())
    if len(sources) != 1:
        raise BaseError(f"expected exactly one built iproute2 source tree, found {len(sources)}")
    source = sources[0]
    version = source.name.removeprefix("iproute2-")
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise BaseError("built iproute2 source has unexpected version identity")
    patch = IPROUTE2_PATCH_ROOT / version / IPROUTE2_PATCH_NAME
    if not patch.is_file() or patch.is_symlink():
        raise BaseError(f"version-scoped iproute2 minimal patch missing for {version}")

    top_makefile = (source / "Makefile").read_text(encoding="utf-8")
    ip_makefile = (source / "ip/Makefile").read_text(encoding="utf-8")
    if top_makefile.splitlines().count("SUBDIRS=lib ip") != 1:
        raise BaseError("iproute2 minimal patch did not restrict top-level build scope")
    if any(line.startswith("SUBDIRS +=") for line in top_makefile.splitlines()):
        raise BaseError("iproute2 minimal patch left conditional utility subdirectories enabled")
    if ip_makefile.splitlines().count("TARGETS=ip") != 1 or ip_makefile.splitlines().count("all: $(TARGETS)") != 1:
        raise BaseError("iproute2 minimal patch did not restrict ip build targets")
    if any(line.startswith("SCRIPTS=") for line in ip_makefile.splitlines()) or "$(SCRIPTS)" in ip_makefile:
        raise BaseError("iproute2 minimal patch left script build/install targets enabled")
    try:
        install_section = top_makefile.split("install: all", 1)[1].split("\nversion:", 1)[0]
    except IndexError as exc:
        raise BaseError("iproute2 install section shape changed") from exc
    for forbidden in ("$(DESTDIR)$(CONF_USR_DIR)", "$(DESTDIR)$(HDRDIR)", "$(DESTDIR)$(BASH_COMPDIR)"):
        if forbidden in install_section:
            raise BaseError(f"iproute2 minimal patch left unconsumed install payload: {forbidden}")

    return {
        "upstream_version": version,
        "patch": str(patch.relative_to(ROOT)),
        "patch_sha256": digest(patch),
        "build_scope": ["lib", "ip"],
        "installed_runtime_entrypoints": ["/sbin/ip"],
    }


def verify_surface_ip_identity(target: Path) -> dict:
    """Authenticate the built /sbin/ip without mutating host networking.

    Functional compatibility is proven later by the disposable QEMU guest.
    This host-side step only binds identity, executable provenance and linkage.
    """
    target_root = target.resolve()
    ip_entry = target / "sbin/ip"
    if not ip_entry.is_file() or not os.access(ip_entry, os.X_OK):
        raise BaseError("Surface requires executable /sbin/ip")
    try:
        resolved = ip_entry.resolve(strict=True)
        relative = resolved.relative_to(target_root).as_posix()
    except (OSError, ValueError) as exc:
        raise BaseError("Surface IP tool resolves outside verified target root") from exc
    try:
        version = subprocess.run(
            [str(ip_entry), "-V"], capture_output=True, text=True,
            check=False, timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise BaseError("Surface IP tool is not runnable on the build host") from exc
    version_text = (version.stdout + version.stderr).strip()
    if version.returncode != 0 or not version_text.startswith("ip utility, iproute2-"):
        raise BaseError("Surface requires iproute2, not BusyBox ip")

    file_identity = run("file", "-b", str(resolved)).strip()
    if "ELF 64-bit LSB" not in file_identity or "x86-64" not in file_identity:
        raise BaseError("Surface iproute2 binary has unexpected ELF identity")
    dynamic = run("readelf", "-d", str(resolved))
    needed = sorted(set(re.findall(r"\(NEEDED\).*?\[(.+?)\]", dynamic)))
    if needed:
        raise BaseError(f"Surface iproute2 unexpectedly has dynamic dependencies: {needed}")
    if "statically linked" not in file_identity:
        raise BaseError("Surface iproute2 must follow the static Independent Base linkage contract")
    return {
        "entrypoint": "/sbin/ip",
        "resolved_target_path": "/" + relative,
        "sha256": digest(resolved),
        "version": version_text,
        "elf_identity": file_identity,
        "linkage": "static",
        "dynamic_dependencies": needed,
        "buildroot_symbol": "BR2_PACKAGE_IPROUTE2=y",
    }


def verify_owner_target(target: Path) -> None:
    required_exec = {
        "usr/bin/git": None,
        "usr/sbin/iw": None,
        "usr/sbin/wpa_supplicant": None,
        "usr/bin/wpa_passphrase": None,
        "sbin/ordax-dev-init": ROOT / "bootstrap/dev-base/ordax-dev-init",
        "usr/local/bin/ordax-network": ROOT / "bootstrap/dev-base/ordax-network",
        "usr/local/bin/ordax-pull": ROOT / "bootstrap/dev-base/ordax-pull",
        "usr/local/bin/ordax-rollback": ROOT / "bootstrap/dev-base/ordax-rollback",
        "usr/local/bin/ordax-run": ROOT / "bootstrap/dev-base/ordax-run",
        "usr/local/bin/ordax-diagnose": ROOT / "bootstrap/dev-base/ordax-diagnose",
        "ordax/bootstrap/recovery/entrypoint": ROOT / "bootstrap/recovery/entrypoint",
    }
    for relative, canonical in required_exec.items():
        path = target / relative
        if not path.is_file() or not os.access(path, os.X_OK):
            raise BaseError(f"Owner/Development executable missing: /{relative}")
        if canonical is not None and digest(path) != digest(canonical):
            raise BaseError(f"Owner/Development helper differs from canonical source: /{relative}")
    ca_store = target / "etc/ssl/certs/ca-certificates.crt"
    if not ca_store.is_file() or ca_store.stat().st_size == 0:
        raise BaseError("Owner/Development CA trust store is missing")
    marker = target / "etc/ordax/owner-development"
    if marker.read_text(encoding="utf-8") != "ORDAX_OWNER_DEVELOPMENT_PROFILE=YES\n":
        raise BaseError("Owner/Development profile marker is invalid")


def verify_target(target: Path, profile: str) -> dict:
    if not BUSYBOX_FRAGMENT.is_file() or BUSYBOX_FRAGMENT.is_symlink():
        raise BaseError("canonical BusyBox handoff config fragment is missing or unsafe")
    fragment_lines = BUSYBOX_FRAGMENT.read_text(encoding="utf-8").splitlines()
    for symbol in BUSYBOX_HANDOFF_SYMBOLS:
        if fragment_lines.count(symbol) != 1:
            raise BaseError(f"canonical BusyBox fragment lacks exact symbol: {symbol}")
    for name in ("bin/busybox", "sbin/ordax-stable-init", "sbin/modprobe",
                 "sbin/ordax-independent-probe-init",
                 "etc/ordax/independent-base", "ordax/bootstrap/network/bring-up",
                 "ordax/bootstrap/network/udhcpc.script"):
        if not (target / name).is_file():
            raise BaseError(f"candidate userspace is missing {name}")
    if digest(target / "sbin/ordax-stable-init") != digest(CANONICAL_HANDOFF):
        raise BaseError("portable handoff entrypoint differs from canonical source")
    for name in (
        "etc/alpine-release", "sbin/apk", "lib/apk", "etc/apk",
        "usr/bin/opkg", "bin/opkg", "usr/bin/dpkg", "usr/bin/apt",
        "usr/bin/apt-get", "usr/bin/rpm",
    ):
        if (target / name).exists():
            raise BaseError(f"runtime package manager or Alpine dependency found: {name}")
    surface_iproute2 = verify_surface_ip_identity(target)
    # Built for x86_64, BusyBox is static, so inspect its actual applet table.
    applets = set(run(str(target / "bin/busybox"), "--list").splitlines())
    missing = {"sh", "mount", "umount", "ifconfig", "route", "udhcpc",
               "poweroff", "grep", "sync", "modprobe", "timeout",
               "od", "tr", "stat", "uname", "sleep", "true",
               "cat", "mkdir", "chmod"} - applets
    if missing:
        raise BaseError(f"missing required BusyBox applets: {sorted(missing)}")
    if "ip" in applets:
        raise BaseError("redundant BusyBox ip applet conflicts with iproute2 SSOT")
    # Presence in the applet list is not enough: the official handoff uses
    # stat -c and timeout -k, so exercise those exact feature interfaces.
    busybox = str(target / "bin/busybox")
    with tempfile.TemporaryDirectory(prefix="ordax-busybox-handoff-") as temp_dir:
        marker = Path(temp_dir) / "local-ai-key-mode"
        marker.write_text("test\n", encoding="ascii")
        marker.chmod(0o600)
        if run(busybox, "stat", "-c", "%a", str(marker)).strip() != "600":
            raise BaseError("BusyBox stat -c cannot enforce canonical key permission")
    if run(busybox, "timeout", "-k", "1", "2", busybox, "true").strip():
        raise BaseError("BusyBox timeout emitted unexpected output")
    # The Supervisor must distinguish a dead Surface launcher from a still
    # live Native host. Verify both successful and contended flock operations
    # on the ACTUAL target BusyBox, not just its compiled configuration.
    with tempfile.TemporaryDirectory() as lock_dir:
        lock_path = Path(lock_dir) / "native-host-instance.lock"
        lock_path.write_bytes(b"")
        lock_path.chmod(0o600)
        run(busybox, "flock", "-n", str(lock_path), busybox, "true")
        with lock_path.open("rb") as locked:
            fcntl.flock(locked, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                contender = subprocess.run(
                    [str(busybox), "flock", "-n", str(lock_path), str(busybox), "true"],
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, check=False, timeout=4,
                )
                if contender.returncode == 0:
                    raise BaseError("BusyBox flock granted a lock already owned by another process")
            finally:
                fcntl.flock(locked, fcntl.LOCK_UN)
    if profile == "owner-development":
        verify_owner_target(target)
    elif (target / "etc/ordax/owner-development").exists():
        raise BaseError("minimal target unexpectedly contains Owner/Development marker")
    return surface_iproute2


def build(out: Path, cache: Path, jobs: int, profile: str) -> dict:
    source, kernel, stable, network = contracts()
    out = out.resolve()
    if out == ROOT or ROOT in out.parents:
        raise BaseError("output must be outside the source repository")
    if out.exists() and any(out.iterdir()):
        raise BaseError("output directory must be new or empty")
    for prog in ("make", "mkfs.erofs", "fsck.erofs", "blkid", "file", "readelf"):
        if not shutil.which(prog):
            raise BaseError(f"required host build/proof tool is missing: {prog}")
    out.mkdir(parents=True, exist_ok=True)
    temp = Path(tempfile.mkdtemp(prefix="ordax-independent-build-"))
    try:
        archive = source_archive(source, cache)
        br = safe_unpack(archive, temp, source["buildroot"]["version"])
        generated = temp / f"ordax_{profile.replace('-', '_')}_defconfig"
        inputs = generate_defconfig(source, kernel, profile, generated)
        build_dir = temp / "br-output"
        cmd = ["make", "-C", str(br), f"O={build_dir}",
               f"BR2_EXTERNAL={HERE}", f"BR2_DEFCONFIG={generated}"]
        run(*cmd, "defconfig")
        config = (build_dir / ".config").read_text(encoding="utf-8")
        verify_resolved_config(config, kernel, profile)
        run(*cmd[:-1], f"-j{max(1, jobs)}", bounded_output=True)
        iproute2_minimal_build = verify_iproute2_minimal_build(build_dir)
        target = build_dir / "target"
        surface_iproute2 = verify_target(target, profile)
        expected_version_prefix = f'ip utility, iproute2-{iproute2_minimal_build["upstream_version"]}'
        if not surface_iproute2["version"].startswith(expected_version_prefix):
            raise BaseError("built /sbin/ip version differs from patched iproute2 source identity")
        images = build_dir / "images"
        for name in ("rootfs.cpio.gz", "rootfs.tar"):
            if not (images / name).is_file():
                raise BaseError(f"Buildroot did not generate {name}")
            shutil.copyfile(images / name, out / name)
        base = out / "independent-base.erofs"
        run("mkfs.erofs", "-T", "0", "-z", stable["rootfs"]["compression"],
            "-L", stable["rootfs"]["volume_label"], str(base), str(target))
        run("fsck.erofs", str(base))
        identity = run("blkid", "-p", "-o", "export", str(base))
        if "TYPE=erofs" not in identity or f'LABEL={stable["rootfs"]["volume_label"]}' not in identity:
            raise BaseError("candidate EROFS format differs from canonical format")
        try:
            source_commit = run("git", "-C", str(ROOT), "rev-parse", "HEAD").strip()
        except BaseError:
            source_commit = None
        report = {
            "$schema": "prototype-ordax.independent-base-provenance/1",
            "status": "candidate-build-only",
            "source_commit": source_commit,
            "profile": profile,
            "profile_inputs": profile_provenance(inputs),
            "kernel_source_version": kernel["version"],
            "buildroot_sha256": digest(archive),
            "rootfs_format": "erofs",
            "erofs_label": stable["rootfs"]["volume_label"],
            "network_contract_applied": True,
            "owner_development_capabilities_verified": profile == "owner-development",
            "surface_iproute2_identity_verified": True,
            "surface_iproute2": surface_iproute2,
            "surface_iproute2_minimal_build": iproute2_minimal_build,
            "busybox_handoff_config_fragment": str(BUSYBOX_FRAGMENT.relative_to(ROOT)),
            "busybox_handoff_config_sha256": digest(BUSYBOX_FRAGMENT),
            "busybox_handoff_runtime_features_verified": True,
            "canonical_portable_handoff_source": str(CANONICAL_HANDOFF.relative_to(ROOT)),
            "canonical_portable_handoff_sha256": digest(CANONICAL_HANDOFF),
            "canonical_portable_pid1_unchanged": True,
            "artifacts": {name: digest(out / name) for name in
                          ("rootfs.cpio.gz", "rootfs.tar", "independent-base.erofs")},
            "physical_artifact_authorized": False,
            "qemu_boot_proven": False,
            "signed_release_equivalence_proven": False,
        }
        (out / "provenance.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
        return report
    finally:
        shutil.rmtree(temp, ignore_errors=True)


def verify(out: Path, profile: str) -> dict:
    source, _, _, _ = contracts()
    expected_profile_inputs = profile_provenance(profile_inputs(source, profile))
    report = json.loads((out / "provenance.json").read_text(encoding="utf-8"))
    if report.get("$schema") != "prototype-ordax.independent-base-provenance/1":
        raise BaseError("invalid provenance schema")
    if report.get("profile") != profile:
        raise BaseError("artifact profile differs from requested verification profile")
    if report.get("profile_inputs") != expected_profile_inputs:
        raise BaseError("artifact profile inputs differ from current source authority")
    if report.get("owner_development_capabilities_verified") is not (profile == "owner-development"):
        raise BaseError("Owner/Development capability provenance drift")
    if report.get("physical_artifact_authorized") is not False:
        raise BaseError("unsafe artifact promotion flag")
    if report.get("busybox_handoff_config_fragment") != str(BUSYBOX_FRAGMENT.relative_to(ROOT)):
        raise BaseError("BusyBox handoff config fragment provenance drift")
    if report.get("busybox_handoff_config_sha256") != digest(BUSYBOX_FRAGMENT):
        raise BaseError("BusyBox handoff config fragment SHA-256 drift")
    if report.get("surface_iproute2_identity_verified") is not True:
        raise BaseError("Surface iproute2 identity proof missing")
    surface_iproute2 = report.get("surface_iproute2")
    if not isinstance(surface_iproute2, dict):
        raise BaseError("Surface iproute2 provenance missing")
    if surface_iproute2.get("entrypoint") != "/sbin/ip":
        raise BaseError("Surface iproute2 entrypoint provenance drift")
    if surface_iproute2.get("buildroot_symbol") != "BR2_PACKAGE_IPROUTE2=y":
        raise BaseError("Surface iproute2 Buildroot provenance drift")
    if surface_iproute2.get("linkage") != "static" or surface_iproute2.get("dynamic_dependencies") != []:
        raise BaseError("Surface iproute2 dependency provenance drift")
    if not HASH.fullmatch(str(surface_iproute2.get("sha256", ""))):
        raise BaseError("Surface iproute2 binary digest invalid")
    if not str(surface_iproute2.get("version", "")).startswith("ip utility, iproute2-"):
        raise BaseError("Surface iproute2 version provenance invalid")
    minimal_build = report.get("surface_iproute2_minimal_build")
    if not isinstance(minimal_build, dict):
        raise BaseError("Surface iproute2 minimal-build provenance missing")
    version = str(minimal_build.get("upstream_version", ""))
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise BaseError("Surface iproute2 minimal-build version invalid")
    expected_patch = IPROUTE2_PATCH_ROOT / version / IPROUTE2_PATCH_NAME
    if minimal_build.get("patch") != str(expected_patch.relative_to(ROOT)):
        raise BaseError("Surface iproute2 minimal patch path drift")
    if not expected_patch.is_file() or expected_patch.is_symlink():
        raise BaseError("Surface iproute2 minimal patch unavailable")
    if minimal_build.get("patch_sha256") != digest(expected_patch):
        raise BaseError("Surface iproute2 minimal patch SHA-256 drift")
    if minimal_build.get("build_scope") != ["lib", "ip"]:
        raise BaseError("Surface iproute2 minimal build scope drift")
    if minimal_build.get("installed_runtime_entrypoints") != ["/sbin/ip"]:
        raise BaseError("Surface iproute2 minimal runtime payload drift")
    if not surface_iproute2["version"].startswith(f"ip utility, iproute2-{version}"):
        raise BaseError("Surface iproute2 binary/source version mismatch")
    if report.get("busybox_handoff_runtime_features_verified") is not True:
        raise BaseError("BusyBox applet feature proof absent from provenance")
    if report.get("canonical_portable_handoff_source") != str(CANONICAL_HANDOFF.relative_to(ROOT)):
        raise BaseError("canonical handoff source path drift")
    if report.get("canonical_portable_handoff_sha256") != digest(CANONICAL_HANDOFF):
        raise BaseError("canonical handoff source hash drift")
    if report.get("canonical_portable_pid1_unchanged") is not True:
        raise BaseError("candidate has no canonical PID1 provenance")
    for name, expected in report["artifacts"].items():
        if not HASH.fullmatch(expected) or digest(out / name) != expected:
            raise BaseError(f"artifact hash mismatch: {name}")
    run("fsck.erofs", str(out / "independent-base.erofs"))
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("check", "resolve", "build", "verify"))
    parser.add_argument("--profile", choices=SUPPORTED_PROFILES, default="minimal")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--cache", type=Path, default=Path("/tmp/ordax-independent-cache"))
    parser.add_argument("--jobs", type=int, default=2)
    args = parser.parse_args()
    try:
        if args.action == "check":
            source, kernel, stable, network = contracts()
            inputs = profile_inputs(source, args.profile)
            print(json.dumps({
                "status": "contract-check-pass",
                "profile": args.profile,
                "profile_inputs": profile_provenance(inputs),
                "kernel": kernel["version"],
                "erofs": stable["rootfs"]["format"],
                "network": network["prototype_scope"],
            }))
        elif args.action == "resolve":
            print(json.dumps(resolve_profile(args.cache, args.profile), sort_keys=True))
        else:
            if args.out is None:
                raise BaseError("--out required")
            print(json.dumps(
                build(args.out, args.cache, args.jobs, args.profile)
                if args.action == "build"
                else verify(args.out, args.profile),
                sort_keys=True,
            ))
        return 0
    except (BaseError, OSError, ValueError, KeyError, tarfile.TarError) as exc:
        print(f"ordax-independent-base: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
