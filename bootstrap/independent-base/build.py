#!/usr/bin/env python3
"""Isolated Buildroot base experiment. It cannot publish or replace Stable."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
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
BUSYBOX_FRAGMENT = HERE / "configs/portable-handoff.busybox.fragment"
BUSYBOX_HANDOFF_SYMBOLS = ("CONFIG_STAT=y", "CONFIG_FEATURE_STAT_FORMAT=y", "CONFIG_TIMEOUT=y",
                           "CONFIG_DATE=y", "CONFIG_MV=y", "CONFIG_READLINK=y",
                           "CONFIG_SHA256SUM=y", "CONFIG_OD=y", "CONFIG_TR=y", "CONFIG_SLEEP=y")
HASH = re.compile(r"[0-9a-f]{64}\Z")


class BaseError(RuntimeError):
    pass


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def run(*args: str, cwd: Path | None = None) -> str:
    argv = list(args)
    result = subprocess.run(argv, cwd=cwd, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, check=False)
    if result.returncode:
        raise BaseError(f"{' '.join(argv)} failed ({result.returncode}):\n"
                        + result.stdout[-10000:])
    return result.stdout


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



PROBE_INIT = "sbin/ordax-independent-probe-init"


def verify_executable_mode(archive: Path, kind: str) -> None:
    """Check the *published* initramfs or tar mode, not only the overlay source."""
    if not archive.is_file() or archive.is_symlink():
        raise BaseError(f"{kind} archive is missing or unsafe")

    if kind == "tar":
        with tarfile.open(archive, "r:") as container:
            matches = [
                item for item in container
                if item.name.removeprefix("./") == PROBE_INIT
            ]
            if len(matches) != 1 or not matches[0].isreg() or matches[0].mode != 0o755:
                raise BaseError("rootfs.tar: independent probe-init must be a unique regular 0755 executable")
        return

    if kind != "cpio":
        raise BaseError("unsupported initramfs archive format")

    # Buildroot emits gzip-compressed SVR4 newc. Read the actual cpio headers
    # without extracting potentially privileged entries onto the build host.
    found = 0
    with gzip.open(archive, "rb") as stream:
        while True:
            header = stream.read(110)
            if len(header) != 110 or header[:6] not in (b"070701", b"070702"):
                raise BaseError("rootfs.cpio.gz: invalid/truncated newc header")
            try:
                fields = [int(header[6 + offset * 8:14 + offset * 8], 16)
                          for offset in range(13)]
            except ValueError as exc:
                raise BaseError("rootfs.cpio.gz: invalid newc metadata") from exc
            mode, file_size, name_size = fields[1], fields[6], fields[11]
            if not 1 <= name_size <= 4096:
                raise BaseError("rootfs.cpio.gz: invalid cpio pathname length")
            name_raw = stream.read(name_size)
            if len(name_raw) != name_size or not name_raw.endswith(b"\0"):
                raise BaseError("rootfs.cpio.gz: invalid/truncated cpio filename")
            name = name_raw[:-1].decode("utf-8", "strict").removeprefix("./")
            pad = (-(110 + name_size)) % 4
            if len(stream.read(pad)) != pad:
                raise BaseError("rootfs.cpio.gz: truncated header padding")
            if name == "TRAILER!!!":
                if found != 1:
                    raise BaseError("rootfs.cpio.gz: executable probe-init missing or duplicated")
                return
            if name == PROBE_INIT:
                found += 1
                if (found != 1 or stat.S_IFMT(mode) != stat.S_IFREG
                        or stat.S_IMODE(mode) != 0o755):
                    raise BaseError(
                        f"rootfs.cpio.gz: independent probe-init mode must be regular 0755, got {mode:o}"
                    )
            remaining = file_size + (-file_size % 4)
            while remaining:
                block = stream.read(min(65536, remaining))
                if not block:
                    raise BaseError("rootfs.cpio.gz: truncated file content")
                remaining -= len(block)


def verify_target(target: Path) -> None:
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
    probe = target / PROBE_INIT
    if probe.is_symlink() or not probe.is_file() or stat.S_IMODE(probe.stat().st_mode) != 0o755:
        raise BaseError("Buildroot target probe-init must be a regular 0755 executable")
    if digest(target / "sbin/ordax-stable-init") != digest(CANONICAL_HANDOFF):
        raise BaseError("portable handoff entrypoint differs from canonical source")
    for name in ("etc/alpine-release", "sbin/apk", "lib/apk", "etc/apk"):
        if (target / name).exists():
            raise BaseError(f"Alpine/APK dependency found: {name}")
    # Buildroot native networking/trust primitives are mandatory for Phase 3.
    # These do not replace the canonical OrdaX DHCP policy or release verifier.
    ip = target / "sbin/ip"
    if not ip.is_file():
        ip = target / "usr/sbin/ip"
    if not ip.is_file():
        raise BaseError("candidate missing native iproute2 networking diagnostics")
    ip_version = run(str(ip), "-V")
    if "ip utility" not in ip_version.lower():
        raise BaseError("iproute2 executable cannot report its version")
    trust = target / "etc/ssl/certs/ca-certificates.crt"
    if not trust.is_file() or trust.stat().st_size == 0:
        raise BaseError("candidate missing non-empty standard CA trust bundle")
    # Built for x86_64, BusyBox is static, so inspect its actual applet table.
    applets = set(run(str(target / "bin/busybox"), "--list").splitlines())
    missing = {"sh", "mount", "umount", "ifconfig", "route", "udhcpc",
               "poweroff", "grep", "sync", "modprobe", "timeout",
               "od", "tr", "stat", "uname", "sleep", "true",
               "cat", "mkdir", "chmod", "date", "mv", "readlink",
               "sha256sum", "kill", "ps"} - applets
    if missing:
        raise BaseError(f"missing required BusyBox applets: {sorted(missing)}")
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
    guardian_epoch = run(busybox, "date", "+%s").strip()
    if not guardian_epoch.isdecimal():
        raise BaseError("canonical guardian date +%s unsupported")


def build(out: Path, cache: Path, jobs: int) -> dict:
    source, kernel, stable, network = contracts()
    out = out.resolve()
    if out == ROOT or ROOT in out.parents:
        raise BaseError("output must be outside the source repository")
    if out.exists() and any(out.iterdir()):
        raise BaseError("output directory must be new or empty")
    for prog in ("make", "mkfs.erofs", "fsck.erofs", "blkid"):
        if not shutil.which(prog):
            raise BaseError(f"required host build/proof tool is missing: {prog}")
    out.mkdir(parents=True, exist_ok=True)
    temp = Path(tempfile.mkdtemp(prefix="ordax-independent-build-"))
    try:
        archive = source_archive(source, cache)
        br = safe_unpack(archive, temp, source["buildroot"]["version"])
        generated = temp / "ordax_minimal_defconfig"
        generated.write_text(
            (HERE / "configs/ordax_minimal_defconfig").read_text(encoding="utf-8")
            + "\nBR2_KERNEL_HEADERS_VERSION=y\n"
            + f'BR2_DEFAULT_KERNEL_VERSION="{kernel["version"]}"\n'
            + "BR2_PACKAGE_HOST_LINUX_HEADERS_CUSTOM_6_6=y\n",
            encoding="utf-8",
        )
        build_dir = temp / "br-output"
        cmd = ["make", "-C", str(br), f"O={build_dir}",
               f"BR2_EXTERNAL={HERE}", f"BR2_DEFCONFIG={generated}"]
        run(*cmd, "defconfig")
        config = (build_dir / ".config").read_text(encoding="utf-8")
        for key in ('BR2_KERNEL_HEADERS_VERSION=y', f'BR2_DEFAULT_KERNEL_VERSION="{kernel["version"]}"',
                    'BR2_TOOLCHAIN_BUILDROOT_MUSL=y', 'BR2_STATIC_LIBS=y', 'BR2_INIT_NONE=y',
                    'BR2_PACKAGE_IPROUTE2=y', 'BR2_PACKAGE_CA_CERTIFICATES=y',
                    'BR2_PACKAGE_BUSYBOX_CONFIG_FRAGMENT_FILES="$(BR2_EXTERNAL_ORDAX_MINIMAL_PATH)/configs/portable-handoff.busybox.fragment"'):
            if key not in config:
                raise BaseError(f"Buildroot rejected required configuration {key}")
        run(*cmd[:-1], f"-j{max(1, jobs)}")
        target = build_dir / "target"
        verify_target(target)
        images = build_dir / "images"
        for name in ("rootfs.cpio.gz", "rootfs.tar"):
            if not (images / name).is_file():
                raise BaseError(f"Buildroot did not generate {name}")
            shutil.copyfile(images / name, out / name)
        verify_executable_mode(out / "rootfs.cpio.gz", "cpio")
        verify_executable_mode(out / "rootfs.tar", "tar")
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
            "kernel_source_version": kernel["version"],
            "buildroot_sha256": digest(archive),
            "rootfs_format": "erofs",
            "erofs_label": stable["rootfs"]["volume_label"],
            "network_contract_applied": True,
            "busybox_handoff_config_fragment": str(BUSYBOX_FRAGMENT.relative_to(ROOT)),
            "busybox_handoff_config_sha256": digest(BUSYBOX_FRAGMENT),
            "busybox_handoff_runtime_features_verified": True,
            "probe_initramfs_executable_mode_verified": True,
            "phase3_service_primitives_verified": True,
            "phase3_iproute2_verified": True,
            "phase3_ca_trust_verified": True,
            "phase3_wifi_hardware_proven": False,
            "phase3_graphical_runtime_proven": False,
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


def verify(out: Path) -> dict:
    contracts()
    report = json.loads((out / "provenance.json").read_text(encoding="utf-8"))
    if report.get("$schema") != "prototype-ordax.independent-base-provenance/1":
        raise BaseError("invalid provenance schema")
    if report.get("physical_artifact_authorized") is not False:
        raise BaseError("unsafe artifact promotion flag")
    if report.get("busybox_handoff_config_fragment") != str(BUSYBOX_FRAGMENT.relative_to(ROOT)):
        raise BaseError("BusyBox handoff config fragment provenance drift")
    if report.get("busybox_handoff_config_sha256") != digest(BUSYBOX_FRAGMENT):
        raise BaseError("BusyBox handoff config fragment SHA-256 drift")
    if report.get("busybox_handoff_runtime_features_verified") is not True:
        raise BaseError("BusyBox applet feature proof absent from provenance")
    if report.get("probe_initramfs_executable_mode_verified") is not True:
        raise BaseError("initramfs executable mode evidence absent from provenance")
    verify_executable_mode(out / "rootfs.cpio.gz", "cpio")
    verify_executable_mode(out / "rootfs.tar", "tar")
    for key in ("phase3_service_primitives_verified", "phase3_iproute2_verified", "phase3_ca_trust_verified"):
        if report.get(key) is not True:
            raise BaseError(f"Phase 3 build validation evidence missing: {key}")
    for key in ("phase3_wifi_hardware_proven", "phase3_graphical_runtime_proven"):
        if report.get(key) is not False:
            raise BaseError(f"Phase 3 must not assert unproven equivalence: {key}")
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
    parser.add_argument("action", choices=("check", "build", "verify"))
    parser.add_argument("--out", type=Path)
    parser.add_argument("--cache", type=Path, default=Path("/tmp/ordax-independent-cache"))
    parser.add_argument("--jobs", type=int, default=2)
    args = parser.parse_args()
    try:
        if args.action == "check":
            _, kernel, stable, network = contracts()
            print(json.dumps({"status": "contract-check-pass", "kernel": kernel["version"],
                              "erofs": stable["rootfs"]["format"], "network": network["prototype_scope"]}))
        else:
            if args.out is None:
                raise BaseError("--out required")
            print(json.dumps(build(args.out, args.cache, args.jobs) if args.action == "build"
                             else verify(args.out), sort_keys=True))
        return 0
    except (BaseError, OSError, ValueError, KeyError, tarfile.TarError) as exc:
        print(f"ordax-independent-base: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
