#!/usr/bin/env python3
"""Isolated Buildroot base experiment. It cannot publish or replace Stable."""
from __future__ import annotations

import argparse
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
NETWORK = ROOT / "bootstrap/network/source.json"
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
    if stable["rootfs"]["format"] != "erofs" or stable["rootfs"]["read_only"] is not True:
        raise BaseError("canonical base format changed")
    if stable["rootfs"]["compression"] != "lz4":
        raise BaseError("canonical base compression changed")
    if network.get("$schema") != "prototype-ordax.network-bootstrap-source/1":
        raise BaseError("network contract mismatch")
    if set(network["busybox"]["required_applets"]) != {"udhcpc", "route", "ifconfig"}:
        raise BaseError("network minimum changed")
    if source["kernel_source_contract"] != str(KERNEL.relative_to(ROOT)):
        raise BaseError("kernel SSOT drift")
    if source["stable_base_format_contract"] != str(STABLE.relative_to(ROOT)):
        raise BaseError("EROFS SSOT drift")
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
                # The official Buildroot archive has legitimate relative links
                # with '..'. Resolve them within its named top-level directory.
                import posixpath
                link = member.linkname
                resolved = posixpath.normpath(
                    posixpath.join(posixpath.dirname(member.name), link)
                    if member.issym() else link
                )
                if not (resolved == expected or resolved.startswith(expected + "/")):
                    raise BaseError(f"unsafe Buildroot tar link: {member.name} -> {link}")
        tf.extractall(work, filter="data")
    dest = work / expected
    if not (dest / "Makefile").is_file():
        raise BaseError("Buildroot source tree incomplete")
    return dest


def verify_target(target: Path) -> None:
    for name in ("bin/busybox", "sbin/ordax-independent-probe-init",
                 "etc/ordax/independent-base", "ordax/bootstrap/network/bring-up",
                 "ordax/bootstrap/network/udhcpc.script"):
        if not (target / name).is_file():
            raise BaseError(f"candidate userspace is missing {name}")
    for name in ("etc/alpine-release", "sbin/apk", "lib/apk", "etc/apk"):
        if (target / name).exists():
            raise BaseError(f"Alpine/APK dependency found: {name}")
    # Built for x86_64, BusyBox is static, so inspect its actual applet table.
    applets = set(run(str(target / "bin/busybox"), "--list").splitlines())
    missing = {"sh", "mount", "umount", "ifconfig", "route", "udhcpc",
               "poweroff", "grep", "sync"} - applets
    if missing:
        raise BaseError(f"missing required BusyBox applets: {sorted(missing)}")


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
                    'BR2_TOOLCHAIN_BUILDROOT_MUSL=y', 'BR2_STATIC_LIBS=y', 'BR2_INIT_NONE=y'):
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
