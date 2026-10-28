#!/usr/bin/env python3
"""Single direct Owner/Development image command using canonical producers.

Consumes PREPARED, VERIFIED outputs; no GitHub Actions, build duplication,
release signing, disk selection or physical-media writes. Does not seed rootfs.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]


def run(cmd: list[str], *, env: dict[str, str] | None = None) -> None:
    subprocess.run(cmd, cwd=ROOT, env=env, check=True)


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def preflight(out: Path, cli: Path, surface: Path, rootfs: Path, kernel: Path,
              initramfs: Path) -> None:
    if out == ROOT or ROOT in out.parents:
        raise ValueError("output directory must be outside repository")
    if out.exists() and (out.is_symlink() or not out.is_dir() or any(out.iterdir())):
        raise ValueError("output directory must be a real empty directory or absent")
    for item in (kernel, initramfs):
        if not item.is_file() or item.is_symlink() or item.stat().st_size == 0:
            raise ValueError(f"missing or unsafe boot artifact: {item}")
    for item in (surface, rootfs):
        if not item.is_dir() or item.is_symlink():
            raise ValueError(f"missing or unsafe component directory: {item}")
    if not (rootfs / "usr/bin/git").is_file():
        raise ValueError("Owner/Dev rootfs lacks Git; prepare canonical seeded base first")
    if not (rootfs / "workspace/ordax/.git").exists():
        raise ValueError("Owner/Dev rootfs has no seeded OrdaX checkout; follow canonical owner preseed")
    if not cli.is_file() or cli.is_symlink() or not os.access(cli, os.X_OK):
        raise ValueError("verified Creator Core executable required")
    run([sys.executable, "bootstrap/kernel/verify.py", str(kernel.parent)])
    run([sys.executable, "bootstrap/initramfs/build.py", "verify"])
    run([sys.executable, "bootstrap/surface-runtime/build.py", "verify", "--out", str(surface)])


def build(out: Path, cli: Path, surface: Path, rootfs: Path,
          kernel: Path, initramfs: Path) -> dict:
    preflight(out, cli, surface, rootfs, kernel, initramfs)
    out.mkdir(parents=True, exist_ok=True)
    manifest = out / "manifest.json"
    payload = out / "payload"
    stage = out / "stage"
    geometry = out / "geometry.json"
    media = out / "media"
    kernel_version = json.loads((ROOT / "bootstrap/kernel/source.json").read_text())["version"]
    env = os.environ.copy()
    env["ORDAX_KERNEL_VERSION"] = kernel_version
    env["ORDAX_DEV_GEOMETRY_OUT"] = str(geometry)
    # The manifest producer binds exactly out/kernel and out/initramfs.
    canonical_kernel = ROOT / "out/kernel" / ("vmlinuz-" + kernel_version)
    canonical_initramfs = ROOT / "out/initramfs/initramfs.cpio.gz"
    if kernel.resolve() != canonical_kernel.resolve() or initramfs.resolve() != canonical_initramfs.resolve():
        raise ValueError("manifest requires canonical kernel/initramfs output paths")
    run([sys.executable, "tools/creator/owner_dev_manifest.py", str(manifest)], env=env)
    run(["bash", "tools/creator/owner_dev_stage.sh",
         str(manifest), str(payload), str(stage), str(cli),
         str(rootfs), str(surface)], env=env)
    # The canonical disposable-media producer creates FAT32/ext4 filesystem
    # images and requires elevated mount/loop privileges on the Linux host.
    # This is NOT authorization to select or write a physical USB device.
    run(["sudo", sys.executable, "tools/creator/owner_dev_raw.py",
         "--contract", str(geometry), "--stage-root", str(stage),
         "--output-root", str(media)], env=env)
    proof_path = media / "proof.json"
    proof = json.loads(proof_path.read_text(encoding="utf-8"))
    image = media / "ordax-disposable.raw"
    if (proof.get("status") != "pass" or proof.get("physical_write_authorized") is not False
            or not isinstance(proof.get("checks"), dict)
            or not proof["checks"] or not all(v is True for v in proof["checks"].values())
            or not image.is_file() or image.is_symlink()
            or digest(image) != proof.get("image_sha256")):
        raise ValueError("unverified disposable image: no USB candidate accepted")
    result = {"status": "verified-disposable-raw", "image": str(image),
              "sha256": digest(image), "physical_write_authorized": False,
              "boot_proven": False, "source": "direct-owner-development"}
    (out / "direct-owner-dev-result.json").write_text(
        json.dumps(result, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--creator-cli", type=Path, required=True)
    parser.add_argument("--surface-out", type=Path, required=True)
    parser.add_argument("--rootfs", type=Path, default=ROOT / "out/dev-base/rootfs")
    kernel_version = json.loads((ROOT / "bootstrap/kernel/source.json").read_text())["version"]
    parser.add_argument("--kernel", type=Path, default=ROOT / "out/kernel" / ("vmlinuz-" + kernel_version))
    parser.add_argument("--initramfs", type=Path, default=ROOT / "out/initramfs/initramfs.cpio.gz")
    args = parser.parse_args()
    try:
        result = build(*[getattr(args, name).expanduser().resolve() for name in
                         ("out", "creator_cli", "surface_out", "rootfs", "kernel", "initramfs")])
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (OSError, ValueError, subprocess.CalledProcessError, KeyError) as e:
        print("direct Owner USB: " + str(e), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
