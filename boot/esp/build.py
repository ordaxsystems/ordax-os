#!/usr/bin/env python3
"""Build the pinned systemd-boot EFI candidate for the minimal OrdaX ESP."""

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

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / "boot" / "esp"
CONTRACT = HERE / "source.json"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")


class BuildError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_contract() -> dict:
    try:
        value = json.loads(CONTRACT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BuildError(f"cannot read ESP source contract: {exc}") from exc
    if value.get("$schema") != "prototype-ordax.esp-source/1":
        raise BuildError("unexpected ESP source contract schema")
    bootloader = value.get("bootloader", {})
    if bootloader.get("project") != "systemd-boot":
        raise BuildError("unexpected ESP bootloader project")
    if not COMMIT_RE.fullmatch(str(bootloader.get("source_commit", ""))):
        raise BuildError("invalid pinned systemd source commit")
    if bootloader.get("upstream_tag_signature_verified") is not True:
        raise BuildError("upstream bootloader tag must be signature-verified")
    return value


def check_contract() -> dict:
    value = load_contract()
    config = value.get("configuration", {})
    checked = {}
    for path_key, hash_key in (
        ("loader_conf", "loader_conf_sha256"),
        ("normal_entry", "normal_entry_sha256"),
        ("recovery_entry", "recovery_entry_sha256"),
    ):
        relative = config.get(path_key)
        expected = config.get(hash_key)
        if not isinstance(relative, str) or not SHA256_RE.fullmatch(str(expected or "")):
            raise BuildError(f"missing ESP config source/hash: {path_key}")
        path = (ROOT / relative).resolve()
        if ROOT.resolve() not in path.parents or not path.is_file() or path.is_symlink():
            raise BuildError(f"unsafe ESP config path: {relative}")
        actual = sha256_file(path)
        if actual != expected:
            raise BuildError(f"ESP config digest mismatch: {relative}")
        checked[path_key] = {"path": relative, "sha256": actual}
    expected_layout = [
        "EFI/BOOT/BOOTX64.EFI",
        "loader/loader.conf",
        "loader/entries/ordax.conf",
        "loader/entries/ordax-recovery.conf",
        "ordax/vmlinuz",
        "ordax/initrd.gz",
    ]
    if value.get("target_layout") != expected_layout:
        raise BuildError("ESP target layout is no longer minimal/canonical")
    proof = value.get("boot_counting_proof")
    expected_proof = {
        "parser": "bootctl-built-from-pinned-systemd-source",
        "candidate_filename": "ordax-candidate+01-00.conf",
        "canonical_entry_id": "ordax-candidate.conf",
        "tries_left": 1,
        "tries_done": 0,
        "default_entry": "ordax.conf",
        "disposable_parser_proof_only": True,
        "actual_boot_attempt_proven": False,
        "failed_candidate_fallback_proven": False,
    }
    if proof != expected_proof:
        raise BuildError("ESP boot-counting proof contract is not canonical")
    return {
        "systemd_version": value["bootloader"]["version"],
        "systemd_source_commit": value["bootloader"]["source_commit"],
        "configuration": checked,
        "target_layout": expected_layout,
        "boot_counting_proof": proof,
    }


def resolve(name: str) -> str:
    value = shutil.which(name)
    if not value:
        raise BuildError(f"required build program not found: {name}")
    return value


def run(argv: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
    print("+", " ".join(argv), flush=True)
    try:
        subprocess.run(argv, cwd=cwd, env=env, check=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        raise BuildError(f"command failed: {' '.join(argv)}") from exc


def capture(argv: list[str], *, cwd: Path | None = None) -> str:
    try:
        return subprocess.run(argv, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise BuildError(f"command failed: {' '.join(argv)}") from exc


def acquire_source(contract: dict, source: Path) -> None:
    source_commit = contract["bootloader"]["source_commit"]
    repository = contract["bootloader"]["upstream_repository"]
    shutil.rmtree(source, ignore_errors=True)
    source.mkdir(parents=True)
    run([resolve("git"), "init", "-q"], cwd=source)
    run([resolve("git"), "remote", "add", "origin", repository], cwd=source)
    run([resolve("git"), "fetch", "--depth=1", "origin", source_commit], cwd=source)
    run([resolve("git"), "checkout", "--detach", "-q", "FETCH_HEAD"], cwd=source)
    actual = capture([resolve("git"), "rev-parse", "HEAD"], cwd=source)
    if actual != source_commit:
        raise BuildError(f"systemd source commit mismatch: expected={source_commit} actual={actual}")


def locate_bootloader(build_dir: Path) -> Path:
    candidates = [
        path
        for path in build_dir.rglob("systemd-bootx64.efi")
        if path.is_file() and not path.is_symlink()
    ]
    if len(candidates) != 1:
        rendered = [str(path.relative_to(build_dir)) for path in candidates]
        raise BuildError(f"expected exactly one x64 systemd-boot EFI output, found: {rendered}")
    return candidates[0]


def build(work_dir: Path, out_dir: Path) -> dict:
    contract = load_contract()
    check_contract()
    for program in ("git", "meson", "ninja", "objdump"):
        resolve(program)

    work_dir = work_dir.resolve()
    out_dir = out_dir.resolve()
    source = work_dir / "systemd-source"
    build_dir = work_dir / "systemd-build"
    shutil.rmtree(work_dir, ignore_errors=True)
    shutil.rmtree(out_dir, ignore_errors=True)
    work_dir.mkdir(parents=True)
    out_dir.mkdir(parents=True)

    acquire_source(contract, source)

    env = dict(os.environ)
    env.update({
        "SOURCE_DATE_EPOCH": "0",
        "TZ": "UTC",
        "LC_ALL": "C.UTF-8",
        "LANG": "C.UTF-8",
    })
    meson_args = [
        resolve("meson"), "setup", str(build_dir), str(source),
        "--buildtype=release",
        "-Dauto_features=disabled",
        "-Dbootloader=enabled",
        "-Defi=true",
        "-Dtests=false",
        "-Dman=disabled",
        "-Dhtml=disabled",
        "-Dtranslations=false",
        "-Dukify=disabled",
        "-Dtpm=false",
        "-Dsbat-distro=ordax",
        "-Dsbat-distro-generation=1",
        "-Dsbat-distro-summary=OrdaX",
        "-Dsbat-distro-pkgname=ordax-boot",
        f"-Dsbat-distro-version={contract['bootloader']['version']}",
        "-Dsbat-distro-url=https://github.com/ordaxsystems/ordax-os",
    ]
    run(meson_args, env=env)

    # systemd v261 exposes a canonical `systemd-boot` Meson/Ninja alias.
    # Build that public target, then locate the uniquely generated x64 EFI
    # output instead of depending on an internal build-directory layout.
    run([resolve("ninja"), "-C", str(build_dir), "systemd-boot"], env=env)
    built = locate_bootloader(build_dir)

    objdump = capture([resolve("objdump"), "-f", str(built)])
    if "pei-x86-64" not in objdump and "pei-x86-64" not in capture([resolve("objdump"), "-p", str(built)]):
        raise BuildError("systemd-boot output is not an x86_64 PE/EFI image")

    output = out_dir / "systemd-bootx64.efi"
    shutil.copy2(built, output)
    provenance = {
        "$schema": "prototype-ordax.esp-bootloader-provenance/1",
        "status": "candidate",
        "physical_artifact_authorized": False,
        "upstream_project": "systemd",
        "upstream_version": contract["bootloader"]["version"],
        "upstream_tag": contract["bootloader"]["tag"],
        "upstream_tag_object_sha": contract["bootloader"]["tag_object_sha"],
        "upstream_source_commit": contract["bootloader"]["source_commit"],
        "upstream_tag_signature_verified": True,
        "meson_target": "systemd-boot",
        "artifact": {
            "name": output.name,
            "sha256": sha256_file(output),
            "size": output.stat().st_size,
        },
    }
    prov_path = out_dir / "bootloader-provenance.json"
    prov_path.write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (out_dir / "SHA256SUMS").write_text(
        f"{sha256_file(output)}  {output.name}\n{sha256_file(prov_path)}  {prov_path.name}\n",
        encoding="utf-8",
    )
    return provenance


def verify(out_dir: Path) -> dict:
    contract = load_contract()
    out_dir = out_dir.resolve()
    sums = out_dir / "SHA256SUMS"
    prov = out_dir / "bootloader-provenance.json"
    if not sums.is_file() or sums.is_symlink() or not prov.is_file() or prov.is_symlink():
        raise BuildError("ESP candidate checksum/provenance missing or unsafe")
    provenance = json.loads(prov.read_text(encoding="utf-8"))

    expected_provenance_fields = {
        "$schema",
        "status",
        "physical_artifact_authorized",
        "upstream_project",
        "upstream_version",
        "upstream_tag",
        "upstream_tag_object_sha",
        "upstream_source_commit",
        "upstream_tag_signature_verified",
        "meson_target",
        "artifact",
    }
    if not isinstance(provenance, dict) or set(provenance) != expected_provenance_fields:
        raise BuildError("ESP bootloader provenance fields are not canonical")
    if provenance["$schema"] != "prototype-ordax.esp-bootloader-provenance/1":
        raise BuildError("unexpected ESP bootloader provenance schema")
    if provenance["status"] != "candidate":
        raise BuildError("ESP bootloader provenance status is invalid")
    if provenance["physical_artifact_authorized"] is not False:
        raise BuildError("ESP candidate must not authorize physical media")
    if provenance["meson_target"] != "systemd-boot":
        raise BuildError("ESP provenance does not identify canonical systemd-boot target")

    bootloader = contract["bootloader"]
    expected_identity = {
        "upstream_project": bootloader["project"].removesuffix("-boot"),
        "upstream_version": bootloader["version"],
        "upstream_tag": bootloader["tag"],
        "upstream_tag_object_sha": bootloader["tag_object_sha"],
        "upstream_source_commit": bootloader["source_commit"],
        "upstream_tag_signature_verified": True,
    }
    for field, expected_value in expected_identity.items():
        if provenance[field] != expected_value:
            raise BuildError(f"ESP bootloader provenance does not match pinned contract: {field}")

    artifact = provenance["artifact"]
    if not isinstance(artifact, dict) or set(artifact) != {"name", "sha256", "size"}:
        raise BuildError("ESP bootloader artifact provenance is malformed")
    if artifact["name"] != "systemd-bootx64.efi":
        raise BuildError("ESP bootloader artifact name is not canonical")
    if not isinstance(artifact["sha256"], str) or not SHA256_RE.fullmatch(artifact["sha256"]):
        raise BuildError("ESP bootloader artifact digest is invalid")
    if not isinstance(artifact["size"], int) or isinstance(artifact["size"], bool) or artifact["size"] <= 0:
        raise BuildError("ESP bootloader artifact size is invalid")

    entries = {}
    for line in sums.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._+-]*)", line)
        if not match or match.group(2) in entries:
            raise BuildError("malformed ESP checksum manifest")
        entries[match.group(2)] = match.group(1)
    expected = {"systemd-bootx64.efi", "bootloader-provenance.json"}
    if set(entries) != expected:
        raise BuildError("ESP checksum manifest has unexpected files")
    for name, digest in entries.items():
        path = out_dir / name
        if path.is_symlink() or not path.is_file() or sha256_file(path) != digest:
            raise BuildError(f"ESP artifact verification failed: {name}")
    artifact_path = out_dir / artifact["name"]
    if artifact["sha256"] != entries["systemd-bootx64.efi"]:
        raise BuildError("ESP provenance disagrees with bootloader digest")
    if artifact_path.stat().st_size != artifact["size"]:
        raise BuildError("ESP provenance disagrees with bootloader size")
    return {
        "status": "verified",
        "artifact_count": len(entries),
        "upstream_version": provenance["upstream_version"],
        "source_commit": provenance["upstream_source_commit"],
        "artifact_sha256": artifact["sha256"],
        "physical_artifact_authorized": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    b = sub.add_parser("build")
    b.add_argument("--work-dir", type=Path, default=ROOT / "out" / "esp-work")
    b.add_argument("--out-dir", type=Path, default=ROOT / "out" / "esp")
    v = sub.add_parser("verify")
    v.add_argument("--out-dir", type=Path, default=ROOT / "out" / "esp")
    args = parser.parse_args()
    try:
        if args.command == "check":
            result = check_contract()
        elif args.command == "build":
            result = build(args.work_dir, args.out_dir)
        else:
            result = verify(args.out_dir)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (BuildError, OSError, json.JSONDecodeError, KeyError) as exc:
        print(f"esp-build: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
