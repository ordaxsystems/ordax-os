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
OWNER_BUSYBOX_FRAGMENT = HERE / "configs/owner-development.busybox.fragment"
IPROUTE2_PATCH_ROOT = HERE / "patches/iproute2"
IPROUTE2_PATCH_NAME = "0001-ordax-minimal-ip-only.patch"
IPROUTE2_PATCH_CONFIG = 'BR2_GLOBAL_PATCH_DIR="$(BR2_EXTERNAL_ORDAX_MINIMAL_PATH)/patches"'
MINIMAL_BUSYBOX_FRAGMENT_CONFIG = (
    'BR2_PACKAGE_BUSYBOX_CONFIG_FRAGMENT_FILES="$(BR2_EXTERNAL_ORDAX_MINIMAL_PATH)/configs/'
    'portable-handoff.busybox.fragment"'
)
OWNER_BUSYBOX_FRAGMENT_CONFIG = (
    'BR2_PACKAGE_BUSYBOX_CONFIG_FRAGMENT_FILES="$(BR2_EXTERNAL_ORDAX_MINIMAL_PATH)/configs/'
    'portable-handoff.busybox.fragment $(BR2_EXTERNAL_ORDAX_MINIMAL_PATH)/configs/'
    'owner-development.busybox.fragment"'
)
BUSYBOX_HANDOFF_SYMBOLS = ("CONFIG_STAT=y", "CONFIG_FEATURE_STAT_FORMAT=y", "CONFIG_TIMEOUT=y", "CONFIG_FLOCK=y")
OWNER_BUSYBOX_SYMBOLS = ("CONFIG_NTPD=y",)
SUPPORTED_PROFILES = ("minimal", "owner-development")
# Component-private Python must not change the two canonical OS boot profiles.
NATIVE_COMPONENT_PROFILE = "native-product-runtime"
NATIVE_COMPONENT_FRAGMENT = HERE / "configs/native-product-runtime.fragment"
NATIVE_COMPONENT_REQUIRED = (
    "BR2_SHARED_LIBS=y", "BR2_PACKAGE_PYTHON3=y",
    "BR2_PACKAGE_PYTHON3_PYC_ONLY=y", "BR2_PACKAGE_PYTHON3_SSL=y", "BR2_PACKAGE_PYTHON3_ZLIB=y",
    "BR2_PACKAGE_CA_CERTIFICATES=y", "BR2_TARGET_ROOTFS_TAR=y",
)
OWNER_USERSPACE_CONFIG = (
    "BR2_PACKAGE_CA_CERTIFICATES=y",
    "BR2_PACKAGE_GIT=y",
    "BR2_PACKAGE_IW=y",
    "BR2_PACKAGE_WPA_SUPPLICANT=y",
    "BR2_PACKAGE_WPA_SUPPLICANT_PASSPHRASE=y",
    "BR2_PACKAGE_WPA_SUPPLICANT_CLI=y",
)
OWNER_FIRMWARE_CONFIG_PREFIX = "BR2_PACKAGE_LINUX_FIRMWARE"
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


def config_lines(path: Path) -> set[str]:
    return {
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }


def validate_owner_busybox_fragment() -> set[str]:
    if not OWNER_BUSYBOX_FRAGMENT.is_file() or OWNER_BUSYBOX_FRAGMENT.is_symlink():
        raise BaseError("Owner/Development BusyBox config fragment is missing or unsafe")
    lines = config_lines(OWNER_BUSYBOX_FRAGMENT)
    expected = set(OWNER_BUSYBOX_SYMBOLS)
    if lines != expected:
        raise BaseError(
            "Owner/Development BusyBox fragment must contain only required helper applets: "
            + ", ".join(sorted(expected))
        )
    text = OWNER_BUSYBOX_FRAGMENT.read_text(encoding="utf-8").lower()
    if "alpine" in text or "apk" in text:
        raise BaseError("Owner/Development BusyBox fragment reintroduced Alpine/APK")
    return lines


def validate_owner_fragment(path: Path) -> set[str]:
    lines = config_lines(path)
    missing_userspace = sorted(set(OWNER_USERSPACE_CONFIG) - lines)
    if missing_userspace:
        raise BaseError(
            "Owner/Development fragment lost required userspace capabilities: "
            + ", ".join(missing_userspace)
        )
    if OWNER_BUSYBOX_FRAGMENT_CONFIG not in lines:
        raise BaseError("Owner/Development fragment lost its exact BusyBox capability composition")
    firmware = {
        line
        for line in lines
        if line.startswith(OWNER_FIRMWARE_CONFIG_PREFIX) and line.endswith("=y")
    }
    if f"{OWNER_FIRMWARE_CONFIG_PREFIX}=y" not in firmware:
        raise BaseError("Owner/Development fragment must select Buildroot linux-firmware")
    unexpected = sorted(
        lines
        - set(OWNER_USERSPACE_CONFIG)
        - {OWNER_BUSYBOX_FRAGMENT_CONFIG}
        - firmware
    )
    if unexpected:
        raise BaseError(
            "Owner/Development fragment contains unsupported configuration: "
            + ", ".join(unexpected)
        )
    if len(firmware) <= 1:
        raise BaseError("Owner/Development linux-firmware provider has no selected family")
    validate_owner_busybox_fragment()
    text = path.read_text(encoding="utf-8").lower()
    if "alpine" in text or "apk" in text:
        raise BaseError("Owner/Development fragment reintroduced Alpine/APK")
    return lines


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
    expected_component = {
        "native-product-runtime": {
            "base_defconfig": str(BASE_DEFCONFIG.relative_to(ROOT)),
            "fragment": str(NATIVE_COMPONENT_FRAGMENT.relative_to(ROOT)),
            "purpose": "private-python-component-toolchain-not-base",
            "source_owner": "ordaxsystems/ordax-runtime",
            "runtime_service": "ordax-product-agent",
            "base_rootfs_mutation_allowed": False,
            "component_artifact_authorized": False,
            "device_install_authorized": False,
        }
    }
    if source.get("component_profiles") != expected_component:
        raise BaseError("private native Runtime component registry drift")
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

    base_lines = config_lines(defconfig)
    owner_busybox_fragment = None
    owner_busybox_lines: set[str] = set()
    if profile == "minimal":
        leaked_userspace = sorted(set(OWNER_USERSPACE_CONFIG) & base_lines)
        leaked_firmware = sorted(
            line for line in base_lines if line.startswith(OWNER_FIRMWARE_CONFIG_PREFIX)
        )
        leaked = leaked_userspace + leaked_firmware
        if leaked:
            raise BaseError(f"Owner capability leaked into minimal defconfig: {leaked}")
        fragment_lines: set[str] = set()
    else:
        assert fragment is not None
        fragment_lines = validate_owner_fragment(fragment)
        owner_busybox_fragment = OWNER_BUSYBOX_FRAGMENT
        owner_busybox_lines = validate_owner_busybox_fragment()

    return {
        "profile": profile,
        "purpose": spec["purpose"],
        "defconfig": defconfig,
        "fragment": fragment,
        "fragment_config": sorted(fragment_lines),
        "owner_busybox_fragment": owner_busybox_fragment,
        "owner_busybox_fragment_config": sorted(owner_busybox_lines),
    }


def profile_provenance(inputs: dict) -> dict:
    fragment = inputs["fragment"]
    owner_busybox_fragment = inputs["owner_busybox_fragment"]
    return {
        "name": inputs["profile"],
        "purpose": inputs["purpose"],
        "defconfig": str(inputs["defconfig"].relative_to(ROOT)),
        "defconfig_sha256": digest(inputs["defconfig"]),
        "fragment": None if fragment is None else str(fragment.relative_to(ROOT)),
        "fragment_sha256": None if fragment is None else digest(fragment),
        "fragment_config": inputs["fragment_config"],
        "owner_busybox_fragment": (
            None
            if owner_busybox_fragment is None
            else str(owner_busybox_fragment.relative_to(ROOT))
        ),
        "owner_busybox_fragment_sha256": (
            None if owner_busybox_fragment is None else digest(owner_busybox_fragment)
        ),
        "owner_busybox_fragment_config": inputs["owner_busybox_fragment_config"],
    }


def generate_defconfig(source: dict, kernel: dict, profile: str, destination: Path) -> dict:
    inputs = profile_inputs(source, profile)
    base_text = inputs["defconfig"].read_text(encoding="utf-8").rstrip()
    if profile == "owner-development":
        if base_text.count(MINIMAL_BUSYBOX_FRAGMENT_CONFIG) != 1:
            raise BaseError("minimal defconfig lost canonical BusyBox fragment authority")
        base_text = base_text.replace(MINIMAL_BUSYBOX_FRAGMENT_CONFIG, "")
    pieces = [base_text]
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
    busybox_fragment_config = (
        OWNER_BUSYBOX_FRAGMENT_CONFIG
        if profile == "owner-development"
        else MINIMAL_BUSYBOX_FRAGMENT_CONFIG
    )
    required = (
        "BR2_KERNEL_HEADERS_VERSION=y",
        f'BR2_DEFAULT_KERNEL_VERSION="{kernel["version"]}"',
        "BR2_TOOLCHAIN_BUILDROOT_MUSL=y",
        "BR2_STATIC_LIBS=y",
        "BR2_INIT_NONE=y",
        "BR2_PACKAGE_IPROUTE2=y",
        IPROUTE2_PATCH_CONFIG,
        busybox_fragment_config,
        f'BR2_ROOTFS_POST_SCRIPT_ARGS="{profile}"',
    )
    for key in required:
        if key not in config:
            raise BaseError(f"Buildroot rejected required configuration {key}")

    if profile == "owner-development":
        source = json.loads(SOURCE.read_text(encoding="utf-8"))
        owner = profile_inputs(source, profile)
        for key in owner["fragment_config"]:
            if key not in config:
                raise BaseError(f"Buildroot rejected Owner/Development configuration {key}")
        if MINIMAL_BUSYBOX_FRAGMENT_CONFIG in config:
            raise BaseError("Owner/Development lost its dedicated BusyBox capability composition")
        if "BR2_PACKAGE_KMOD=y" in config:
            raise BaseError("Owner/Development duplicated BusyBox modprobe with kmod")
    else:
        config_set = set(config.splitlines())
        leaked_userspace = sorted(set(OWNER_USERSPACE_CONFIG) & config_set)
        leaked_firmware = sorted(
            line
            for line in config_set
            if line.startswith(OWNER_FIRMWARE_CONFIG_PREFIX) and line.endswith("=y")
        )
        leaked = leaked_userspace + leaked_firmware
        if leaked:
            raise BaseError(f"minimal profile resolved Owner capabilities: {leaked}")
        if OWNER_BUSYBOX_FRAGMENT_CONFIG in config:
            raise BaseError("minimal profile resolved Owner/Development BusyBox capabilities")


def generate_native_component_defconfig(source: dict, kernel: dict, destination: Path) -> dict:
    """Derive a PRIVATE Python3 component from the pinned Buildroot owner.

    Static OrdaX base stays unchanged. No rootfs, firmware, boot hooks, second
    Python builder, package manager or duplicate Product command runtime.
    """
    spec = source["component_profiles"][NATIVE_COMPONENT_PROFILE]
    if NATIVE_COMPONENT_FRAGMENT.is_symlink() or not NATIVE_COMPONENT_FRAGMENT.is_file():
        raise BaseError("private native Runtime Buildroot fragment missing or unsafe")
    options = config_lines(NATIVE_COMPONENT_FRAGMENT)
    if options != set(NATIVE_COMPONENT_REQUIRED):
        raise BaseError("private native Runtime component has unsupported Buildroot capabilities")
    if any(word in NATIVE_COMPONENT_FRAGMENT.read_text(encoding="utf-8").lower()
           for word in ("alpine", "apk")):
        raise BaseError("private native Runtime component reintroduced distribution tooling")
    inherited = ("BR2_x86_64=y", "BR2_TOOLCHAIN_BUILDROOT_MUSL=y",
                 "BR2_STATIC_LIBS=y", "BR2_INIT_NONE=y")
    if not set(inherited).issubset(config_lines(BASE_DEFCONFIG)):
        raise BaseError("canonical Independent Base arch/libc identity drift")
    lines = [item for item in inherited if item != "BR2_STATIC_LIBS=y"]
    lines.extend(NATIVE_COMPONENT_REQUIRED)
    lines.extend((
        "BR2_KERNEL_HEADERS_VERSION=y",
        f'BR2_DEFAULT_KERNEL_VERSION="{kernel["version"]}"',
        "BR2_PACKAGE_HOST_LINUX_HEADERS_CUSTOM_6_6=y",
    ))
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {
        "component": NATIVE_COMPONENT_PROFILE,
        "source_owner": spec["source_owner"],
        "base_defconfig_sha256": digest(BASE_DEFCONFIG),
        "fragment_sha256": digest(NATIVE_COMPONENT_FRAGMENT),
        "buildroot_sha256": source["buildroot"]["sha256"],
        "component_artifact_authorized": False,
        "device_install_authorized": False,
    }


def verify_native_component_config(config: str, kernel: dict) -> None:
    settings = set(config.splitlines())
    required = set(NATIVE_COMPONENT_REQUIRED) | {
        "BR2_x86_64=y", "BR2_TOOLCHAIN_BUILDROOT_MUSL=y",
        "BR2_INIT_NONE=y", "BR2_KERNEL_HEADERS_VERSION=y",
        f'BR2_DEFAULT_KERNEL_VERSION="{kernel["version"]}"',
        "BR2_PACKAGE_HOST_LINUX_HEADERS_CUSTOM_6_6=y",
    }
    missing = sorted(required - settings)
    if missing:
        raise BaseError(f"Buildroot rejected private Python3 component: {missing}")
    if "BR2_STATIC_LIBS=y" in settings or "BR2_SHARED_STATIC_LIBS=y" in settings:
        raise BaseError("private Python3 component must not use static-only base")
    for forbidden in (
        "BR2_ROOTFS_OVERLAY=", "BR2_ROOTFS_POST_BUILD_SCRIPT=",
        "BR2_ROOTFS_POST_IMAGE_SCRIPT=", "BR2_GLOBAL_PATCH_DIR=",
    ):
        # Buildroot may serialize an *empty* default value for these options.
        # The private component must never inherit a nonempty OS hook or patch.
        if any(line.startswith(forbidden) and line[len(forbidden):].strip('"')
               for line in settings):
            raise BaseError("private Python3 component inherited OS boot payload: " + forbidden)
    if "BR2_PACKAGE_IPROUTE2=y" in settings:
        raise BaseError("private Python3 component inherited OS boot payload: BR2_PACKAGE_IPROUTE2=y")


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


def configure_buildroot(source: dict, kernel: dict, cache: Path, temp: Path,
                        profile: str) -> tuple[Path, list[str], Path, dict]:
    """Canonical source, defconfig, and Kconfig authority for all build modes."""
    archive = source_archive(source, cache.resolve())
    br = safe_unpack(archive, temp, source["buildroot"]["version"])
    generated = temp / f"ordax_{profile.replace('-', '_')}_defconfig"
    component = profile == NATIVE_COMPONENT_PROFILE
    inputs = (generate_native_component_defconfig(source, kernel, generated)
              if component else generate_defconfig(source, kernel, profile, generated))
    build_dir = temp / "br-output"
    cmd = ["make", "-C", str(br), f"O={build_dir}", f"BR2_EXTERNAL={HERE}",
           f"BR2_DEFCONFIG={generated}"]
    run(*cmd, "defconfig")
    config_path = build_dir / ".config"
    if config_path.is_symlink() or not config_path.is_file():
        raise BaseError("Buildroot did not materialize resolved .config")
    config = config_path.read_text(encoding="utf-8")
    if component:
        verify_native_component_config(config, kernel)
    else:
        verify_resolved_config(config, kernel, profile)
    return build_dir, cmd, archive, inputs


def resolve_profile(cache: Path, profile: str) -> dict:
    source, kernel, stable, network = contracts()
    for prog in ("make", "gcc"):
        if not shutil.which(prog):
            raise BaseError(f"required Buildroot profile-resolution tool is missing: {prog}")
    temp = Path(tempfile.mkdtemp(prefix="ordax-independent-resolve-"))
    try:
        build_dir, cmd, archive, inputs = configure_buildroot(
            source, kernel, cache, temp, profile)
        component = profile == NATIVE_COMPONENT_PROFILE
        return {
            "status": "component-resolution-pass" if component else "profile-resolution-pass",
            "profile": profile,
            "profile_inputs": inputs if component else profile_provenance(inputs),
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


def verify_static_userspace_elf_closure(target: Path) -> dict:
    """Prove the entire Independent Base userspace has no dynamic loader.

    The Buildroot profile sets BR2_STATIC_LIBS=y. Check ACTUAL output files,
    not just Kconfig or /sbin/ip, so future native agents cannot quietly add
    Alpine/glibc/musl dynamic loader requirements. Kernel .ko objects use
    ET_REL and have no userspace process loader; exclude those by ELF type.
    No second ELF implementation: the existing host readelf is the authority.
    """
    root = target.resolve(strict=True)
    checked = []
    for file_path in sorted(target.rglob("*")):
        if file_path.is_symlink() or not file_path.is_file():
            continue
        try:
            with file_path.open("rb") as stream:
                elf = stream.read(20)
        except OSError as exc:
            raise BaseError("Independent Base userspace file unreadable") from exc
        if not elf.startswith(b"\x7fELF"):
            continue
        relative = file_path.relative_to(target).as_posix()
        if len(elf) != 20 or elf[4:7] != b"\x02\x01\x01":
            raise BaseError(f"unsupported Independent Base ELF architecture: {relative}")
        if int.from_bytes(elf[18:20], "little") != 62:
            raise BaseError(f"unexpected Independent Base ELF machine: {relative}")
        elf_type = int.from_bytes(elf[16:18], "little")
        if elf_type == 1:
            # Linux kernel module / .o: not a process with a PT_INTERP ABI.
            continue
        if elf_type not in (2, 3):
            raise BaseError(f"unsupported Independent Base ELF type: {relative}")
        try:
            real = file_path.resolve(strict=True)
            real.relative_to(root)
        except (OSError, ValueError) as exc:
            raise BaseError(f"Independent Base ELF escapes target: {relative}") from exc
        segments = run("readelf", "-l", str(file_path))
        dynamic = run("readelf", "-d", str(file_path))
        if "Requesting program interpreter:" in segments or re.search(
            r"(?m)^\s*INTERP\s", segments
        ):
            raise BaseError(f"dynamic ELF interpreter forbidden in Independent Base: {relative}")
        needed = re.findall(r"\(NEEDED\).*?\[(.+?)\]", dynamic)
        if needed:
            raise BaseError(
                f"dynamic ELF dependencies forbidden in Independent Base: {relative}: {sorted(set(needed))}"
            )
        checked.append((relative, digest(file_path)))
    if not checked:
        raise BaseError("Independent Base static userspace ELF proof has no executables")
    fingerprint = hashlib.sha256(
        "".join(f"{name} {sha}\n" for name, sha in checked).encode("utf-8")
    ).hexdigest()
    return {
        "linkage": "static",
        "userspace_elf_files_examined": len(checked),
        "program_interpreters": [],
        "needed_libraries": [],
        "elf_manifest_sha256": fingerprint,
    }


def verify_owner_target(target: Path) -> None:
    required_exec = {
        "usr/bin/git": None,
        "usr/sbin/iw": None,
        "usr/sbin/wpa_supplicant": None,
        "usr/sbin/wpa_passphrase": None,
        "usr/sbin/wpa_cli": None,
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
    if profile == "owner-development":
        validate_owner_busybox_fragment()
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
    required_applets = {"sh", "mount", "umount", "ifconfig", "route", "udhcpc",
                        "poweroff", "grep", "sync", "modprobe", "timeout",
                        "od", "tr", "stat", "uname", "sleep", "true",
                        "cat", "mkdir", "chmod", "flock"}
    if profile == "owner-development":
        # Runtime closure for the canonical Owner helpers. Keep this list tied
        # to commands those scripts execute directly; built target verification
        # proves the applets exist before a candidate can be emitted.
        required_applets.update({
            "awk", "date", "df", "dirname", "head", "killall", "mv", "ntpd",
            "pivot_root", "reboot", "rm", "sed", "setsid", "stty", "tail",
            "test", "touch", "wc",
        })
    missing = required_applets - applets
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


def private_component_library(target: Path, directory: str, name: str) -> Path | None:
    """Resolve the target root's own absolute/relative symlinks, never host /lib.

    Absolute ELF loader links refer to the private component root, not the
    GitHub runner. Reject links escaping root or cycling. Return only a real
    x86_64 ELF file; merely seeing a SONAME in a directory is insufficient.
    """
    root = target.resolve(strict=True)
    parts = [*Path(directory).parts, name]
    resolved: list[str] = []
    count = 0
    while parts:
        part = parts.pop(0)
        if part in ("", "."):
            continue
        if part == "..":
            if not resolved:
                raise BaseError("private Python dependency symlink escaped target")
            resolved.pop()
            continue
        candidate = root.joinpath(*resolved, part)
        if candidate.is_symlink():
            count += 1
            if count > 32:
                raise BaseError("private Python dependency symlink cycle")
            link = os.readlink(candidate)
            if link.startswith("/"):
                resolved = []
            parts = link.split("/") + parts
        else:
            resolved.append(part)
    resolved_path = root.joinpath(*resolved)
    if not resolved_path.is_file() or resolved_path.is_symlink():
        return None
    if not resolved_path.resolve(strict=True).is_relative_to(root):
        raise BaseError("private Python dependency escaped target root")
    with resolved_path.open("rb") as stream:
        header = stream.read(20)
    if (len(header) != 20 or header[:7] != b"\x7fELF\x02\x01\x01"
            or int.from_bytes(header[18:20], "little") != 62):
        raise BaseError("private Python dependency is not a native x86_64 ELF")
    return resolved_path


def verify_native_python_target(target: Path) -> dict:
    """Audit real Buildroot Python, SSL, zlib, and its dynamic ELF closure.

    A shared-library component is distinct from the immutable static OS base.
    It is not an installed runtime or a replacement Product/MCP dispatcher.
    """
    if not target.is_dir() or target.is_symlink():
        raise BaseError("private component target directory unavailable")
    bin_root = target / "usr/bin"
    python_candidates = sorted(
        p for p in bin_root.glob("python3*")
        if p.is_file() and not p.is_symlink()
    )
    python_binaries = [p for p in python_candidates
                       if re.fullmatch(r"python3\.\d+", p.name)]
    if len(python_binaries) != 1:
        raise BaseError("expected exactly one compiled private CPython executable")
    python_path = python_binaries[0]
    stdlib_dirs = sorted(
        path for path in (target / "usr/lib").glob("python3.*")
        if path.is_dir() and not path.is_symlink()
    )
    if len(stdlib_dirs) != 1:
        raise BaseError("expected exactly one private CPython standard library")
    stdlib = stdlib_dirs[0]
    # Buildroot's canonical PYC_ONLY format deliberately omits .py sources.
    # The actual target must contain compiled modules; checking ssl.py alone
    # incorrectly rejects a complete, compact production Python installation.
    # Do not confuse a filename with a usable .pyc: inspect its PEP 552 header.
    for module in ("ssl", "site", "json/__init__"):
        parent, _, basename = module.rpartition("/")
        folder = stdlib / parent if parent else stdlib
        candidates = sorted({
            *folder.glob(basename + ".pyc"),
            *(folder / "__pycache__").glob(basename + ".cpython-*.pyc"),
        })
        valid = []
        for compiled in candidates:
            if compiled.is_symlink() or not compiled.is_file():
                continue
            with compiled.open("rb") as bytecode_file:
                pyc = bytecode_file.read(17)
            if (len(pyc) == 17 and pyc[2:4] == b"\r\n"
                    and int.from_bytes(pyc[4:8], "little") in (0, 1, 3)):
                valid.append(compiled)
        if len(valid) != 1:
            raise BaseError("private CPython compiled standard library incomplete: " + module)
    for name in ("_ssl", "_hashlib", "zlib"):
        extensions = list(stdlib.glob(f"lib-dynload/{name}*.so"))
        if not extensions or any(p.is_symlink() for p in extensions):
            raise BaseError("private CPython TLS/zlib extension missing: " + name)
    ca = target / "etc/ssl/certs/ca-certificates.crt"
    if not ca.is_file() or ca.stat().st_size == 0:
        raise BaseError("private CPython CA certificate bundle missing")

    elf_files: list[Path] = []
    library_directories = ("lib", "lib64", "usr/lib", "usr/lib64")
    def is_private_elf_library(name: str, *, loader: bool = False) -> bool:
        if not re.fullmatch(r"[A-Za-z0-9_.+-]+", name):
            raise BaseError("private Python dependency has invalid SONAME")
        directories = ("lib",) if loader else library_directories
        return any(private_component_library(target, directory, name) is not None
                   for directory in directories)

    for path in sorted(target.rglob("*")):
        if path.is_symlink() or not path.is_file():
            continue
        with path.open("rb") as handle:
            header = handle.read(20)
        if not header.startswith(b"\x7fELF"):
            continue
        if (len(header) != 20 or header[4:7] != b"\x02\x01\x01"
                or int.from_bytes(header[18:20], "little") != 62):
            raise BaseError("independent native Python component contains non-x86_64 ELF")
        if int.from_bytes(header[16:18], "little") == 1:
            continue  # ET_REL kernel/development object, not runnable userspace
        elf_files.append(path)
    if python_path not in elf_files or not elf_files:
        raise BaseError("independent native Python component has no executable ELF")

    interpreters: set[str] = set()
    needed_names: set[str] = set()
    for path in elf_files:
        relative = path.relative_to(target).as_posix()
        program = run("readelf", "-l", str(path))
        dynamics = run("readelf", "-d", str(path))
        matches = re.findall(r"Requesting program interpreter:\s*([^\]\s]+)", program)
        for name in matches:
            # Loader must be part of the PRIVATE musl component, never host.
            if name != "/lib/ld-musl-x86_64.so.1":
                raise BaseError("unexpected private Python ELF interpreter: " + relative)
            if not is_private_elf_library(Path(name).name, loader=True):
                raise BaseError("private Python musl loader missing from Buildroot target")
            interpreters.add(name)
        for needed in re.findall(r"\(NEEDED\).*?\[([^\]]+)\]", dynamics):
            if not is_private_elf_library(needed):
                raise BaseError(f"private Python shared dependency absent: {relative}: {needed}")
            needed_names.add(needed)
    if "/lib/ld-musl-x86_64.so.1" not in interpreters:
        raise BaseError("private Python ELF interpreter not proven")
    fingerprint = hashlib.sha256(
        "".join(
            f"{path.relative_to(target).as_posix()} {digest(path)}\n"
            for path in elf_files
        ).encode("utf-8")
    ).hexdigest()
    return {
        "python_executable": python_path.relative_to(target).as_posix(),
        "python_sha256": digest(python_path),
        "stdlib": stdlib.relative_to(target).as_posix(),
        "compiled_elf_count": len(elf_files),
        "required_interpreter": "/lib/ld-musl-x86_64.so.1",
        "needed_shared_libraries": sorted(needed_names),
        "elf_manifest_sha256": fingerprint,
        "stdlib_ssl_zlib_verified": True,
        "runtime_agent_packaged": False,
        "component_install_authorized": False,
        "device_execution_proven": False,
    }


def build_native_python_component(out: Path, cache: Path, jobs: int) -> dict:
    """Compile isolated Buildroot Python, emit evidence only, no USB payload."""
    source, kernel, _, _ = contracts()
    out = out.resolve()
    if out == ROOT or ROOT in out.parents or (
        out.exists() and (not out.is_dir() or any(out.iterdir()))
    ):
        raise BaseError("component proof output must be a new or empty external directory")
    for executable in ("make", "gcc", "readelf"):
        if not shutil.which(executable):
            raise BaseError("private Python Buildroot tool missing: " + executable)
    out.mkdir(parents=True, exist_ok=True)
    temp = Path(tempfile.mkdtemp(prefix="ordax-native-python-build-"))
    try:
        build_dir, cmd, archive, inputs = configure_buildroot(
            source, kernel, cache, temp, NATIVE_COMPONENT_PROFILE
        )
        run(*cmd[:-1], f"-j{max(1, jobs)}", bounded_output=True)
        evidence = verify_native_python_target(build_dir / "target")
        receipt = {
            "$schema": "ordax.private-native-python-build-proof/1",
            "status": "build-proof-only",
            "buildroot_sha256": digest(archive),
            "kernel_source_version": kernel["version"],
            "component_inputs": inputs,
            "python_abi": evidence,
            "runtime_agent_packaged": False,
            "component_artifact_authorized": False,
            "device_install_authorized": False,
            "base_rootfs_modified": False,
        }
        (out / "native-python-provenance.json").write_text(
            json.dumps(receipt, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )
        return receipt
    finally:
        shutil.rmtree(temp, ignore_errors=True)


def verify_native_python_receipt(out: Path) -> dict:
    """Validate component ABI evidence; never mistake it for an installable ELF."""
    source, kernel, _, _ = contracts()
    path = out / "native-python-provenance.json"
    if path.is_symlink() or not path.is_file():
        raise BaseError("private Python ABI receipt unavailable")
    receipt = json.loads(path.read_text(encoding="utf-8"))
    expected_inputs = source["component_profiles"][NATIVE_COMPONENT_PROFILE]
    if (receipt.get("$schema") != "ordax.private-native-python-build-proof/1"
            or receipt.get("status") != "build-proof-only"
            or receipt.get("buildroot_sha256") != source["buildroot"]["sha256"]
            or receipt.get("kernel_source_version") != kernel["version"]
            or receipt.get("component_inputs", {}).get("component") != NATIVE_COMPONENT_PROFILE
            or receipt.get("component_inputs", {}).get("source_owner") != expected_inputs["source_owner"]
            or receipt.get("component_inputs", {}).get("base_defconfig_sha256") != digest(BASE_DEFCONFIG)
            or receipt.get("component_inputs", {}).get("fragment_sha256") != digest(NATIVE_COMPONENT_FRAGMENT)):
        raise BaseError("private Python ABI receipt does not match canonical source")
    abi = receipt.get("python_abi")
    if (not isinstance(abi, dict)
            or not re.fullmatch(r"usr/bin/python3\.\d+", abi.get("python_executable", ""))
            or not re.fullmatch(r"usr/lib/python3\.\d+", abi.get("stdlib", ""))
            or not HASH.fullmatch(str(abi.get("python_sha256", "")))
            or not HASH.fullmatch(str(abi.get("elf_manifest_sha256", "")))
            or type(abi.get("compiled_elf_count")) is not int
            or abi["compiled_elf_count"] < 1
            or abi.get("required_interpreter") != "/lib/ld-musl-x86_64.so.1"
            or abi.get("stdlib_ssl_zlib_verified") is not True
            or not isinstance(abi.get("needed_shared_libraries"), list)
            or not all(isinstance(lib, str) and re.fullmatch(r"[A-Za-z0-9_.+-]+", lib)
                       for lib in abi["needed_shared_libraries"])):
        raise BaseError("private Python ABI closure receipt invalid")
    for key in ("runtime_agent_packaged", "component_artifact_authorized",
                "device_install_authorized", "base_rootfs_modified"):
        if receipt.get(key) is not False:
            raise BaseError("private Python build proof has unsafe promotion flag")
    for key in ("runtime_agent_packaged", "component_install_authorized",
                "device_execution_proven"):
        if abi.get(key) is not False:
            raise BaseError("private Python ABI falsely claims executable readiness")
    return receipt


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
        build_dir, cmd, archive, inputs = configure_buildroot(
            source, kernel, cache, temp, profile)
        run(*cmd[:-1], f"-j{max(1, jobs)}", bounded_output=True)
        iproute2_minimal_build = verify_iproute2_minimal_build(build_dir)
        target = build_dir / "target"
        surface_iproute2 = verify_target(target, profile)
        userspace_elf_closure = verify_static_userspace_elf_closure(target)
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
            "independent_userspace_elf_closure": userspace_elf_closure,
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
    elf_closure = report.get("independent_userspace_elf_closure")
    if (not isinstance(elf_closure, dict)
            or set(elf_closure) != {
                "linkage", "userspace_elf_files_examined", "program_interpreters",
                "needed_libraries", "elf_manifest_sha256",
            }
            or elf_closure["linkage"] != "static"
            or type(elf_closure["userspace_elf_files_examined"]) is not int
            or elf_closure["userspace_elf_files_examined"] <= 0
            or elf_closure["program_interpreters"] != []
            or elf_closure["needed_libraries"] != []
            or not HASH.fullmatch(str(elf_closure["elf_manifest_sha256"]))):
        raise BaseError("Independent Base static userspace ELF closure provenance invalid")
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
    parser.add_argument("action", choices=("check", "resolve", "build", "verify", "check-component", "resolve-component", "build-component", "verify-component"))
    parser.add_argument("--profile", choices=SUPPORTED_PROFILES, default="minimal")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--cache", type=Path, default=Path("/tmp/ordax-independent-cache"))
    parser.add_argument("--jobs", type=int, default=2)
    args = parser.parse_args()
    try:
        if args.action == "check-component":
            source, kernel, _, _ = contracts()
            with tempfile.TemporaryDirectory(prefix="ordax-component-defconfig-") as temporary:
                inputs = generate_native_component_defconfig(
                    source, kernel, Path(temporary) / "component_defconfig"
                )
            print(json.dumps({"status": "component-contract-pass", "inputs": inputs}, sort_keys=True))
        elif args.action == "resolve-component":
            print(json.dumps(resolve_profile(args.cache, NATIVE_COMPONENT_PROFILE), sort_keys=True))
        elif args.action == "build-component":
            if args.out is None:
                raise BaseError("--out required for component proof")
            print(json.dumps(build_native_python_component(
                args.out, args.cache, args.jobs), sort_keys=True))
        elif args.action == "verify-component":
            if args.out is None:
                raise BaseError("--out required for component proof")
            print(json.dumps(verify_native_python_receipt(args.out), sort_keys=True))
        elif args.action == "check":
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
