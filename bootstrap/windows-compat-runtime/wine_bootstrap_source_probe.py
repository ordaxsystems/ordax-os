#!/usr/bin/env python3
"""Prove Wine bootstrap shortname behavior from the exact locked source archive.

This proof never executes Wine. It reuses the existing source lock validator,
verifies the exact archive bytes, reads only the bounded tools/wine/wine.c member,
and proves the source anchors that justify treating ntdll.so as preloaded before
normal DT_NEEDED loader-path resolution.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import re
import tarfile
import sys

HERE = Path(__file__).resolve().parent
SOURCE_HELPER_PATH = HERE / "build.py"
RUNTIME_CONTRACT = HERE / "runtime-dependency-discovery.json"
PROOF_SCHEMA = "prototype-ordax.windows-compat-wine-bootstrap-source-proof/1"
MAX_BOOTSTRAP_SOURCE_BYTES = 256 * 1024
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class WineBootstrapSourceProofError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise WineBootstrapSourceProofError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SOURCE = load_module("ordax_windows_compat_source_for_bootstrap_proof", SOURCE_HELPER_PATH)


def canonical_sha256(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def load_runtime_contract() -> dict:
    try:
        contract = json.loads(RUNTIME_CONTRACT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise WineBootstrapSourceProofError(f"cannot load runtime dependency contract: {exc}") from exc
    if contract.get("$schema") != "prototype-ordax.windows-compat-runtime-dependency-discovery/1":
        raise WineBootstrapSourceProofError("unexpected runtime dependency contract schema")
    bootstrap = contract.get("loader_bootstrap")
    if not isinstance(bootstrap, dict) or bootstrap.get("model") != "wine-explicit-ntdll-dlopen-before-main":
        raise WineBootstrapSourceProofError("Wine bootstrap model is missing or drifted")
    authority = bootstrap.get("source_authority")
    if not isinstance(authority, dict):
        raise WineBootstrapSourceProofError("Wine bootstrap source authority is missing")
    records = bootstrap.get("preloaded_shortnames")
    if not isinstance(records, list) or len(records) != 1:
        raise WineBootstrapSourceProofError("Wine bootstrap proof requires exactly one declared preloaded shortname")
    record = records[0]
    if record.get("soname") != "ntdll.so" or record.get("path") != "usr/lib/wine/x86_64-unix/ntdll.so":
        raise WineBootstrapSourceProofError("Wine bootstrap shortname/path drifted")
    return contract


def validate_contract_binding(source: dict, contract: dict) -> tuple[dict, dict]:
    source = SOURCE.validate_source(source)
    authority = contract["loader_bootstrap"]["source_authority"]
    upstream = source["upstream"]
    expected = {
        "source_lock": "source.json",
        "source_schema": source["$schema"],
        "runtime_id": source["runtime_id"],
        "engine": source["engine"],
        "wine_version": source["version"],
        "archive_sha256": upstream["archive_sha256"],
        "source_path": "tools/wine/wine.c",
    }
    for key, value in expected.items():
        if authority.get(key) != value:
            raise WineBootstrapSourceProofError(f"Wine bootstrap source authority mismatch: {key}")
    if not SHA256_RE.fullmatch(str(authority.get("source_file_sha256", ""))):
        raise WineBootstrapSourceProofError("Wine bootstrap source file digest is missing or invalid")
    return source, authority


def _without_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    text = re.sub(r"//[^\n]*", " ", text)
    return text


def prove_source_text(text: str) -> dict:
    """Prove only the Wine 11.0 semantics required by the bootstrap model."""
    normalized = re.sub(r"\s+", " ", _without_comments(text)).strip()
    anchors = {
        "load_ntdll_function": r"static\s+void\s*\*\s*load_ntdll\s*\(\s*void\s*\)",
        "installed_arch_ntdll_rtld_now": (
            r'dlopen\s*\(\s*strmake\s*\(\s*"%s/wine%s/ntdll\.so"\s*,\s*libdir\s*,\s*arch_dir\s*\)'
            r"\s*,\s*RTLD_NOW\s*\)"
        ),
        "main_resolves_from_load_ntdll": r'dlsym\s*\(\s*load_ntdll\s*\(\s*\)\s*,\s*"__wine_main"\s*\)',
    }
    positions: dict[str, int] = {}
    for label, pattern in anchors.items():
        match = re.search(pattern, normalized)
        if match is None:
            raise WineBootstrapSourceProofError(f"locked Wine source does not prove bootstrap anchor: {label}")
        positions[label] = match.start()

    if positions["load_ntdll_function"] >= positions["main_resolves_from_load_ntdll"]:
        raise WineBootstrapSourceProofError("Wine bootstrap ordering drifted: load_ntdll is not defined before main resolution")
    if positions["installed_arch_ntdll_rtld_now"] >= positions["main_resolves_from_load_ntdll"]:
        raise WineBootstrapSourceProofError("Wine bootstrap ordering drifted: installed ntdll RTLD_NOW load is not before __wine_main")

    return {
        "load_ntdll_function_present": True,
        "installed_arch_ntdll_uses_rtld_now": True,
        "main_resolves_wine_main_from_load_ntdll": True,
    }


def extract_bootstrap_source(source: dict, archive: Path, authority: dict) -> tuple[bytes, int]:
    archive_proof = SOURCE.validate_archive(source, archive)
    upstream = source["upstream"]
    member_name = f"{upstream['archive_root']}/{authority['source_path']}"
    pure = PurePosixPath(member_name)
    if pure.is_absolute() or ".." in pure.parts:
        raise WineBootstrapSourceProofError("unsafe Wine bootstrap source member path")

    seen = 0
    raw: bytes | None = None
    try:
        with tarfile.open(archive, "r:xz") as tar:
            for member in tar:
                if member.name != member_name:
                    continue
                seen += 1
                if not member.isfile() or member.size <= 0 or member.size > MAX_BOOTSTRAP_SOURCE_BYTES:
                    raise WineBootstrapSourceProofError("Wine bootstrap source member has invalid type/size")
                handle = tar.extractfile(member)
                if handle is None:
                    raise WineBootstrapSourceProofError("Wine bootstrap source member cannot be read")
                raw = handle.read(MAX_BOOTSTRAP_SOURCE_BYTES + 1)
                if len(raw) != member.size or len(raw) > MAX_BOOTSTRAP_SOURCE_BYTES:
                    raise WineBootstrapSourceProofError("Wine bootstrap source member exceeded exact bound")
    except (tarfile.TarError, OSError) as exc:
        raise WineBootstrapSourceProofError(f"cannot inspect locked Wine source archive: {exc}") from exc

    if seen != 1 or raw is None:
        raise WineBootstrapSourceProofError("locked Wine archive must contain exactly one bootstrap source member")
    if archive_proof.get("archive_sha256") != upstream["archive_sha256"]:
        raise WineBootstrapSourceProofError("source archive proof digest drifted")
    return raw, archive_proof["archive_member_count"]


def verify(archive: Path) -> dict:
    contract = load_runtime_contract()
    source, authority = validate_contract_binding(SOURCE.load_source(), contract)
    raw, member_count = extract_bootstrap_source(source, archive.resolve(), authority)
    source_file_sha256 = hashlib.sha256(raw).hexdigest()
    if source_file_sha256 != authority["source_file_sha256"]:
        raise WineBootstrapSourceProofError(
            f"Wine bootstrap source file digest mismatch: expected={authority['source_file_sha256']} actual={source_file_sha256}"
        )
    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise WineBootstrapSourceProofError("Wine bootstrap source is not UTF-8") from exc
    behavior = prove_source_text(text)
    core = {
        "runtime_id": source["runtime_id"],
        "wine_version": source["version"],
        "archive_sha256": source["upstream"]["archive_sha256"],
        "archive_member_count": member_count,
        "source_path": authority["source_path"],
        "source_file_sha256": source_file_sha256,
        "bootstrap_model": contract["loader_bootstrap"]["model"],
        "preloaded_shortnames": contract["loader_bootstrap"]["preloaded_shortnames"],
        "behavior": behavior,
    }
    return {
        "$schema": PROOF_SCHEMA,
        "status": "wine-bootstrap-source-verified-not-runtime-promoted-not-executable",
        **core,
        "evidence_sha256": canonical_sha256(core),
        "gates": {
            "source_lock_verified": True,
            "source_archive_verified": True,
            "wine_bootstrap_source_file_verified": True,
            "wine_bootstrap_source_behavior_verified": True,
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
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--source-archive", type=Path, required=True)
    verify_parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    contract = load_runtime_contract()
    validate_contract_binding(SOURCE.load_source(), contract)
    if args.command == "check":
        print("windows compatibility Wine bootstrap source proof contract: PASS")
        return 0

    result = verify(args.source_archive)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("windows compatibility Wine bootstrap source proof: PASS")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (WineBootstrapSourceProofError, SOURCE.CompatibilityRuntimeBuildError) as exc:
        print(f"windows-compat-wine-bootstrap-source-proof: {exc}", file=sys.stderr)
        raise SystemExit(2)
