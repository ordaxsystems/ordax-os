#!/usr/bin/env python3
"""Build and verify compatibility-bound runtime component release/2 descriptors.

This tool deliberately leaves runtime-component-release/1 untouched. It produces a
new release/2 descriptor whose signed payload can bind an external, deterministic
compatibility sidecar. Signing/staging support is a separate gate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import build as package_builder  # noqa: E402

RELEASE_SCHEMA_V2 = "prototype-ordax.runtime-component-release/2"
COMPATIBILITY_SCHEMA = "ordax.component-compatibility/1"
MAX_COMPATIBILITY_BYTES = 64 * 1024
MAX_COMPATIBILITY_ENTRIES = 128
MAX_CONTRACT_MAJOR = 10_000
MAX_STATE_VERSION = 1_000_000
MAX_COMPATIBILITY_ID_LEN = 160
COMPATIBILITY_ID_RE = re.compile(r"^[a-z0-9]+(?:[.-][a-z0-9]+)*$")


class ReleaseV2Error(RuntimeError):
    pass


def canonical_json_bytes(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode(
        "utf-8"
    )


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def positive_int(value: object, label: str, *, maximum: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ReleaseV2Error(f"{label} must be a positive integer")
    if value > maximum:
        raise ReleaseV2Error(f"{label} is outside the supported bound")
    return value


def validate_compatibility_id(value: object, label: str) -> str:
    if (
        not isinstance(value, str)
        or len(value) < 1
        or len(value) > MAX_COMPATIBILITY_ID_LEN
        or value != value.strip()
        or "\x00" in value
        or not COMPATIBILITY_ID_RE.fullmatch(value)
    ):
        raise ReleaseV2Error(f"{label} is invalid")
    return value


def validate_compatibility_descriptor(
    value: object,
    *,
    component_id: str | None = None,
    component_version: str | None = None,
) -> dict:
    if not isinstance(value, dict):
        raise ReleaseV2Error("compatibility descriptor must be an object")
    expected = {
        "schema",
        "componentId",
        "componentVersion",
        "provides",
        "requires",
        "state",
        "authority",
    }
    if set(value) != expected:
        raise ReleaseV2Error("compatibility descriptor fields are not canonical")
    if value["schema"] != COMPATIBILITY_SCHEMA:
        raise ReleaseV2Error("unsupported compatibility descriptor schema")
    if value["authority"] != "none":
        raise ReleaseV2Error("compatibility descriptor must remain authority:none")

    actual_component_id = str(value["componentId"])
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,63}", actual_component_id):
        raise ReleaseV2Error("compatibility component id is invalid")
    actual_version = str(value["componentVersion"])
    if not package_builder.SEMVER_RE.fullmatch(actual_version):
        raise ReleaseV2Error("compatibility component version is invalid")
    if component_id is not None and actual_component_id != component_id:
        raise ReleaseV2Error("compatibility component id does not match package")
    if component_version is not None and actual_version != component_version:
        raise ReleaseV2Error("compatibility component version does not match package")

    provides = value["provides"]
    if not isinstance(provides, list) or len(provides) > MAX_COMPATIBILITY_ENTRIES:
        raise ReleaseV2Error("compatibility provides list is invalid")
    seen_provides: set[tuple[str, int]] = set()
    for entry in provides:
        if not isinstance(entry, dict) or set(entry) != {"id", "major"}:
            raise ReleaseV2Error("compatibility provided contract is malformed")
        contract_id = validate_compatibility_id(entry["id"], "provided contract id")
        major = positive_int(
            entry["major"],
            "provided contract major",
            maximum=MAX_CONTRACT_MAJOR,
        )
        key = (contract_id, major)
        if key in seen_provides:
            raise ReleaseV2Error("compatibility provided contracts must be unique")
        seen_provides.add(key)

    requires = value["requires"]
    if not isinstance(requires, list) or len(requires) > MAX_COMPATIBILITY_ENTRIES:
        raise ReleaseV2Error("compatibility requires list is invalid")
    seen_requires: set[str] = set()
    for entry in requires:
        if not isinstance(entry, dict) or set(entry) != {
            "id",
            "minMajor",
            "maxMajor",
            "optional",
        }:
            raise ReleaseV2Error("compatibility required contract is malformed")
        contract_id = validate_compatibility_id(entry["id"], "required contract id")
        if contract_id in seen_requires:
            raise ReleaseV2Error("compatibility required contracts must be unique by id")
        seen_requires.add(contract_id)
        minimum = positive_int(
            entry["minMajor"],
            "required contract minMajor",
            maximum=MAX_CONTRACT_MAJOR,
        )
        maximum = positive_int(
            entry["maxMajor"],
            "required contract maxMajor",
            maximum=MAX_CONTRACT_MAJOR,
        )
        if maximum < minimum:
            raise ReleaseV2Error("required contract major range is invalid")
        if not isinstance(entry["optional"], bool):
            raise ReleaseV2Error("required contract optional must be boolean")

    state = value["state"]
    if state is not None:
        if not isinstance(state, dict) or set(state) != {
            "id",
            "writeVersion",
            "readableFrom",
            "readableThrough",
        }:
            raise ReleaseV2Error("compatibility state descriptor is malformed")
        validate_compatibility_id(state["id"], "compatibility state id")
        write_version = positive_int(
            state["writeVersion"],
            "state writeVersion",
            maximum=MAX_STATE_VERSION,
        )
        readable_from = positive_int(
            state["readableFrom"],
            "state readableFrom",
            maximum=MAX_STATE_VERSION,
        )
        readable_through = positive_int(
            state["readableThrough"],
            "state readableThrough",
            maximum=MAX_STATE_VERSION,
        )
        if readable_from > write_version or readable_through < write_version:
            raise ReleaseV2Error("compatibility state readable range excludes writeVersion")

    return value


def load_canonical_compatibility(component_id: str, *, root: Path = ROOT) -> dict:
    helper = root / "tools" / "component-package" / "compatibility.mjs"
    if not helper.is_file():
        raise ReleaseV2Error("canonical compatibility helper is missing")
    try:
        result = subprocess.run(
            ["node", str(helper), component_id],
            cwd=root,
            check=True,
            capture_output=True,
            timeout=15,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        raise ReleaseV2Error(
            f"could not resolve canonical component compatibility: {exc}"
        ) from exc
    if len(result.stdout) <= 0 or len(result.stdout) > MAX_COMPATIBILITY_BYTES:
        raise ReleaseV2Error("canonical compatibility output size is invalid")
    try:
        value = json.loads(result.stdout.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeError) as exc:
        raise ReleaseV2Error("canonical compatibility helper returned invalid JSON") from exc
    return validate_compatibility_descriptor(value, component_id=component_id)


def render_release_v2(package: Path, compatibility: dict) -> tuple[dict, bytes]:
    base = package_builder.render_release_descriptor(package)
    component = base["component"]
    validated = validate_compatibility_descriptor(
        compatibility,
        component_id=component["id"],
        component_version=component["version"],
    )
    compatibility_bytes = canonical_json_bytes(validated)
    if len(compatibility_bytes) > MAX_COMPATIBILITY_BYTES:
        raise ReleaseV2Error("compatibility descriptor exceeds size bound")
    compatibility_name = f"{component['id']}.compatibility.json"
    release = dict(base)
    release["$schema"] = RELEASE_SCHEMA_V2
    release["compatibility"] = {
        "name": compatibility_name,
        "schema": COMPATIBILITY_SCHEMA,
        "sha256": sha256_bytes(compatibility_bytes),
        "size": len(compatibility_bytes),
    }
    return release, compatibility_bytes


def write_exclusive(path: Path, payload: bytes) -> None:
    if path.exists():
        raise ReleaseV2Error(f"refusing to overwrite existing output: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(path, flags, 0o644)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
    except Exception:
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        raise


def build_release_v2(
    package: Path,
    release_out: Path,
    compatibility_out: Path,
    *,
    root: Path = ROOT,
) -> dict:
    if release_out.resolve() == compatibility_out.resolve():
        raise ReleaseV2Error("release and compatibility outputs must be different")
    base_manifest = package_builder.verify_package(package)
    compatibility = load_canonical_compatibility(
        base_manifest["component"]["id"], root=root
    )
    release, compatibility_bytes = render_release_v2(package, compatibility)
    if compatibility_out.name != release["compatibility"]["name"]:
        raise ReleaseV2Error(
            "compatibility output filename must match signed release binding"
        )
    write_exclusive(compatibility_out, compatibility_bytes)
    try:
        write_exclusive(release_out, canonical_json_bytes(release))
    except Exception:
        try:
            compatibility_out.unlink()
        except FileNotFoundError:
            pass
        raise
    return release


def load_regular(path: Path, max_bytes: int, label: str) -> bytes:
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise ReleaseV2Error(f"{label} must be a regular non-symlink file")
    if info.st_size <= 0 or info.st_size > max_bytes:
        raise ReleaseV2Error(f"{label} size is invalid")
    return path.read_bytes()


def verify_release_v2(
    release_path: Path,
    compatibility_path: Path,
    package: Path,
) -> dict:
    release_bytes = load_regular(
        release_path, package_builder.MAX_FILE_BYTES, "release descriptor"
    )
    compatibility_bytes = load_regular(
        compatibility_path, MAX_COMPATIBILITY_BYTES, "compatibility descriptor"
    )
    try:
        release = json.loads(release_bytes.decode("utf-8"))
        compatibility = json.loads(compatibility_bytes.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeError) as exc:
        raise ReleaseV2Error("release/compatibility JSON cannot be decoded") from exc

    base = package_builder.render_release_descriptor(package)
    expected_release_fields = set(base) | {"compatibility"}
    if not isinstance(release, dict) or set(release) != expected_release_fields:
        raise ReleaseV2Error("runtime component release/2 fields are not canonical")
    if release.get("$schema") != RELEASE_SCHEMA_V2:
        raise ReleaseV2Error("unsupported runtime component release/2 schema")

    validated = validate_compatibility_descriptor(
        compatibility,
        component_id=base["component"]["id"],
        component_version=base["component"]["version"],
    )
    canonical_compatibility = canonical_json_bytes(validated)
    if compatibility_bytes != canonical_compatibility:
        raise ReleaseV2Error("compatibility sidecar is not canonical deterministic JSON")

    binding = release["compatibility"]
    if not isinstance(binding, dict) or set(binding) != {
        "name",
        "schema",
        "sha256",
        "size",
    }:
        raise ReleaseV2Error("release/2 compatibility binding is malformed")
    if binding["name"] != compatibility_path.name:
        raise ReleaseV2Error("release/2 compatibility filename binding mismatch")
    if binding["schema"] != COMPATIBILITY_SCHEMA:
        raise ReleaseV2Error("release/2 compatibility schema binding mismatch")
    if binding["size"] != len(compatibility_bytes):
        raise ReleaseV2Error("release/2 compatibility size binding mismatch")
    if binding["sha256"] != sha256_bytes(compatibility_bytes):
        raise ReleaseV2Error("release/2 compatibility digest binding mismatch")

    expected_release = dict(base)
    expected_release["$schema"] = RELEASE_SCHEMA_V2
    expected_release["compatibility"] = binding
    if release != expected_release:
        raise ReleaseV2Error("release/2 does not exactly match package identity")
    if release_bytes != canonical_json_bytes(release):
        raise ReleaseV2Error("release/2 is not canonical deterministic JSON")
    return release


def command_build(args: argparse.Namespace) -> int:
    release = build_release_v2(
        Path(args.package),
        Path(args.out),
        Path(args.compatibility_out),
    )
    print("RUNTIME_COMPONENT_RELEASE_V2_BUILD=PASS")
    print(f"RUNTIME_COMPONENT_ID={release['component']['id']}")
    print(f"RUNTIME_COMPONENT_VERSION={release['component']['version']}")
    print(f"RUNTIME_COMPONENT_COMPATIBILITY_SHA256={release['compatibility']['sha256']}")
    print("RUNTIME_COMPONENT_DIRECT_ACTIVATION_ALLOWED=NO")
    return 0


def command_verify(args: argparse.Namespace) -> int:
    release = verify_release_v2(
        Path(args.release),
        Path(args.compatibility),
        Path(args.package),
    )
    print("RUNTIME_COMPONENT_RELEASE_V2_VERIFY=PASS")
    print(f"RUNTIME_COMPONENT_ID={release['component']['id']}")
    print(f"RUNTIME_COMPONENT_VERSION={release['component']['version']}")
    print("RUNTIME_COMPONENT_DIRECT_ACTIVATION_ALLOWED=NO")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    build_parser = sub.add_parser("build")
    build_parser.add_argument("--package", required=True)
    build_parser.add_argument("--compatibility-out", required=True)
    build_parser.add_argument("--out", required=True)

    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--package", required=True)
    verify_parser.add_argument("--compatibility", required=True)
    verify_parser.add_argument("--release", required=True)

    args = parser.parse_args(argv)
    try:
        if args.command == "build":
            return command_build(args)
        return command_verify(args)
    except (
        ReleaseV2Error,
        package_builder.ComponentPackageError,
        OSError,
        ValueError,
    ) as exc:
        print(f"RUNTIME_COMPONENT_RELEASE_V2_ERROR={exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
