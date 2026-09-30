#!/usr/bin/env python3
"""Apply and prove the deterministic Wine Unixlib $ORIGIN RUNPATH build policy.

The locked Wine archive is validated before this policy is applied. This helper
then performs one bounded transformation of the extracted generated `configure`
script, proves that the upstream `configure.ac` anchor still matches Wine 11.0,
checks the generated Makefile value, and verifies both build-tree and installed
ELF dynamic metadata without executing Wine or a Windows payload.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
CONTRACT_PATH = HERE / "unixlib-link-policy.json"
RUNTIME_DEPENDENCY_PATH = HERE / "runtime_dependency_probe.py"
PROOF_SCHEMA = "prototype-ordax.windows-compat-unixlib-link-policy-proof/1"
PROOF_STATUS = "origin-runpath-build-policy-proven-not-runtime-pinned"

CONFIGURE_ASSIGNMENT = 'UNIXLDFLAGS="-shared -Wl,-Bsymbolic -Wl,-soname,\\$(UNIXLIB)"'
CONFIGURE_AC_ASSIGNMENT = 'AC_SUBST(UNIXLDFLAGS,["-shared -Wl,-Bsymbolic -Wl,-soname,\\$(UNIXLIB)"])'
PATCHED_CONFIGURE_ASSIGNMENT = (
    'UNIXLDFLAGS="-shared -Wl,-Bsymbolic -Wl,-soname,\\$(UNIXLIB) '
    "-Wl,-rpath,'\\$\\$ORIGIN'\""
)
GENERATED_RUNPATH_TOKEN = "-Wl,-rpath,'$$ORIGIN'"


class UnixlibLinkPolicyError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise UnixlibLinkPolicyError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


RUNTIME = load_module("ordax_windows_compat_runtime_dependency_for_unixlib_policy", RUNTIME_DEPENDENCY_PATH)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical_sha256(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return sha256_bytes(payload)


def load_contract() -> dict:
    try:
        value = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise UnixlibLinkPolicyError(f"cannot load Unixlib link policy contract: {exc}") from exc
    if value.get("$schema") != "prototype-ordax.windows-compat-unixlib-link-policy/1":
        raise UnixlibLinkPolicyError("unexpected Unixlib link policy schema")
    if value.get("status") != "deterministic-origin-runpath-build-policy-not-runtime-pinned":
        raise UnixlibLinkPolicyError("Unixlib link policy status drifted")
    if value.get("runtime_id") != "wine-11.0-wow64-x86_64-candidate" or value.get("wine_version") != "11.0":
        raise UnixlibLinkPolicyError("Unixlib link policy runtime identity drifted")
    if value.get("source_archive_sha256") != "c07a6857933c1fc60dff5448d79f39c92481c1e9db5aa628db9d0358446e0701":
        raise UnixlibLinkPolicyError("Unixlib link policy source archive identity drifted")
    authority = value.get("source_authority")
    expected_authority = {
        "configure_path": "configure",
        "configure_ac_path": "configure.ac",
        "configure_assignment_sha256": sha256_bytes(CONFIGURE_ASSIGNMENT.encode("utf-8")),
        "configure_assignment_count": 2,
        "configure_ac_assignment_sha256": sha256_bytes(CONFIGURE_AC_ASSIGNMENT.encode("utf-8")),
        "configure_ac_assignment_count": 1,
    }
    if authority != expected_authority:
        raise UnixlibLinkPolicyError("Unixlib link policy source authority drifted")
    policy = value.get("policy")
    expected_policy = {
        "link_variable": "UNIXLDFLAGS",
        "runpath": "$ORIGIN",
        "dt_rpath_forbidden": True,
        "ambient_ld_library_path_allowed": False,
        "global_wine_library_path_allowed": False,
        "preflight_target": "dlls/winevulkan/winevulkan.so",
        "staged_target": "usr/lib/wine/x86_64-unix/winevulkan.so",
        "required_dt_needed": "win32u.so",
        "expected_elf": {"class": 64, "machine": 62, "endianness": "little"},
    }
    if policy != expected_policy:
        raise UnixlibLinkPolicyError("Unixlib link policy semantics drifted")
    promotion = value.get("promotion")
    if not isinstance(promotion, dict) or not promotion or any(item is not False for item in promotion.values()):
        raise UnixlibLinkPolicyError("Unixlib link policy claims promotion or execution")
    return value


def _read_utf8(path: Path, label: str) -> tuple[str, bytes]:
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise UnixlibLinkPolicyError(f"cannot read {label}: {exc}") from exc
    if not raw or len(raw) > 16 * 1024 * 1024:
        raise UnixlibLinkPolicyError(f"invalid {label} size")
    try:
        return raw.decode("utf-8", errors="strict"), raw
    except UnicodeDecodeError as exc:
        raise UnixlibLinkPolicyError(f"{label} is not UTF-8") from exc


def apply_source_policy(wine_source: Path) -> dict:
    contract = load_contract()
    authority = contract["source_authority"]
    wine_source = wine_source.resolve()
    configure = wine_source / authority["configure_path"]
    configure_ac = wine_source / authority["configure_ac_path"]
    configure_text, configure_raw = _read_utf8(configure, "Wine configure")
    configure_ac_text, configure_ac_raw = _read_utf8(configure_ac, "Wine configure.ac")

    configure_count = configure_text.count(CONFIGURE_ASSIGNMENT)
    configure_ac_count = configure_ac_text.count(CONFIGURE_AC_ASSIGNMENT)
    if configure_count != authority["configure_assignment_count"]:
        raise UnixlibLinkPolicyError(
            f"Wine configure UNIXLDFLAGS anchor count drifted: {configure_count}"
        )
    if PATCHED_CONFIGURE_ASSIGNMENT in configure_text:
        raise UnixlibLinkPolicyError("Wine configure Unixlib link policy was already applied")
    if configure_ac_count != authority["configure_ac_assignment_count"]:
        raise UnixlibLinkPolicyError(
            f"Wine configure.ac UNIXLDFLAGS authority count drifted: {configure_ac_count}"
        )
    if "LD_LIBRARY_PATH" in PATCHED_CONFIGURE_ASSIGNMENT:
        raise UnixlibLinkPolicyError("Unixlib link policy must not use LD_LIBRARY_PATH")

    patched_text = configure_text.replace(CONFIGURE_ASSIGNMENT, PATCHED_CONFIGURE_ASSIGNMENT)
    if patched_text.count(PATCHED_CONFIGURE_ASSIGNMENT) != configure_count or CONFIGURE_ASSIGNMENT in patched_text:
        raise UnixlibLinkPolicyError("Wine configure Unixlib link policy replacement did not bind exactly")
    try:
        configure.write_text(patched_text, encoding="utf-8")
    except OSError as exc:
        raise UnixlibLinkPolicyError(f"cannot apply Wine configure Unixlib link policy: {exc}") from exc

    patched_raw = patched_text.encode("utf-8")
    return {
        "configure_original_sha256": sha256_bytes(configure_raw),
        "configure_patched_sha256": sha256_bytes(patched_raw),
        "configure_ac_sha256": sha256_bytes(configure_ac_raw),
        "configure_assignment_sha256": sha256_bytes(CONFIGURE_ASSIGNMENT.encode("utf-8")),
        "patched_assignment_sha256": sha256_bytes(PATCHED_CONFIGURE_ASSIGNMENT.encode("utf-8")),
        "replacement_count": configure_count,
    }


def verify_generated_makefile(makefile: Path) -> dict:
    text, raw = _read_utf8(makefile, "generated Wine Makefile")
    lines = [line for line in text.splitlines() if line.startswith("UNIXLDFLAGS =")]
    if len(lines) != 1:
        raise UnixlibLinkPolicyError("generated Wine Makefile UNIXLDFLAGS is missing or ambiguous")
    value = lines[0].split("=", 1)[1].strip()
    if value.count(GENERATED_RUNPATH_TOKEN) != 1:
        raise UnixlibLinkPolicyError("generated Wine Makefile lacks exact $ORIGIN RUNPATH token")
    rpath_tokens = [item for item in value.split() if "-rpath" in item]
    if rpath_tokens != [GENERATED_RUNPATH_TOKEN]:
        raise UnixlibLinkPolicyError("generated Wine Makefile contains an unexpected rpath policy")
    if "LD_LIBRARY_PATH" in value:
        raise UnixlibLinkPolicyError("generated Wine UNIXLDFLAGS unexpectedly references LD_LIBRARY_PATH")
    return {
        "makefile_sha256": sha256_bytes(raw),
        "unixldflags": value,
        "runpath_token": GENERATED_RUNPATH_TOKEN,
    }


def _verify_policy_elf(path: Path, target: str) -> dict:
    contract = load_contract()
    try:
        info = RUNTIME.parse_elf_dynamic(path)
    except (OSError, RUNTIME.RuntimeDependencyError) as exc:
        raise UnixlibLinkPolicyError(f"cannot inspect Unixlib policy ELF {target}: {exc}") from exc
    if info is None:
        raise UnixlibLinkPolicyError(f"Unixlib policy target is not ELF: {target}")
    identity = {key: info.get(key) for key in ("class", "machine", "endianness")}
    if identity != contract["policy"]["expected_elf"]:
        raise UnixlibLinkPolicyError(f"Unixlib policy ELF identity drifted for {target}: {identity}")
    if info.get("rpath") is not None:
        raise UnixlibLinkPolicyError(f"Unixlib policy ELF carries forbidden DT_RPATH: {target}")
    if info.get("runpath") != contract["policy"]["runpath"]:
        raise UnixlibLinkPolicyError(f"Unixlib policy ELF DT_RUNPATH drifted for {target}: {info.get('runpath')!r}")
    required = contract["policy"]["required_dt_needed"]
    if required not in info.get("dt_needed", []):
        raise UnixlibLinkPolicyError(f"Unixlib policy ELF {target} no longer requires {required}")
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise UnixlibLinkPolicyError(f"cannot bind Unixlib policy ELF bytes {target}: {exc}") from exc
    return {
        "target": target,
        "size": len(raw),
        "sha256": sha256_bytes(raw),
        "elf": identity,
        "dt_needed": info["dt_needed"],
        "dt_rpath": info["rpath"],
        "dt_runpath": info["runpath"],
    }


def verify_preflight_elf(path: Path) -> dict:
    contract = load_contract()
    return _verify_policy_elf(path, contract["policy"]["preflight_target"])


def verify_staged_elf(path: Path) -> dict:
    contract = load_contract()
    return _verify_policy_elf(path, contract["policy"]["staged_target"])


def finalize_evidence(source_patch: dict, generated_makefile: dict, preflight: dict, staged: dict) -> dict:
    contract = load_contract()
    core = {
        "runtime_id": contract["runtime_id"],
        "wine_version": contract["wine_version"],
        "source_archive_sha256": contract["source_archive_sha256"],
        "source_patch": source_patch,
        "generated_makefile": generated_makefile,
        "preflight": preflight,
        "staged": staged,
    }
    return {
        "$schema": PROOF_SCHEMA,
        "status": PROOF_STATUS,
        **core,
        "evidence_sha256": canonical_sha256(core),
        "gates": {
            "source_archive_identity_bound": True,
            "configure_anchor_verified": True,
            "generated_makefile_unixldflags_verified": True,
            "preflight_elf_verified": True,
            "staged_elf_verified": True,
            "dt_runpath_origin_verified": True,
            "dt_rpath_absent": True,
            "ambient_ld_library_path_used": False,
            "global_wine_library_path_fallback_used": False,
            "runtime_dependency_inventory_complete": False,
            "runtime_package_content_hashes_pinned": False,
            "binary_artifact_pinned": False,
            "activation_authorized": False,
            "execution_authorized": False,
            "wine_executed": False,
            "windows_payload_executed": False,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check", "verify-elf"])
    parser.add_argument("--elf", type=Path)
    args = parser.parse_args()
    load_contract()
    if args.command == "check":
        print("windows compatibility Unixlib $ORIGIN RUNPATH policy: PASS")
        return 0
    if args.elf is None:
        raise UnixlibLinkPolicyError("--elf is required for verify-elf")
    print(json.dumps(verify_preflight_elf(args.elf), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except UnixlibLinkPolicyError as exc:
        print(f"windows-compat-unixlib-link-policy: {exc}", file=sys.stderr)
        raise SystemExit(2)
