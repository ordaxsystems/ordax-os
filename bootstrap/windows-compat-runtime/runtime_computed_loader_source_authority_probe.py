#!/usr/bin/env python3
"""Prove source control semantics for runtime-computed direct Wine dlopen targets.

This proof deliberately does not resolve runtime values. It binds the exact Wine
11.0 archive, recomputes dynamic discovery and computed-target classification,
then verifies comment-free source anchors that explain where each computed
loader argument comes from. Runtime-controlled inputs remain unresolved.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile

HERE = Path(__file__).resolve().parent
CONTRACT_PATH = HERE / "runtime-computed-loader-source-authority.json"
BUILD_PATH = HERE / "build.py"
DYNAMIC_PATH = HERE / "runtime_dynamic_load_source_probe.py"
COMPUTED_PATH = HERE / "runtime_computed_loader_target_classifier.py"
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-computed-loader-source-authority-proof/1"
MAX_MEMBER_BYTES = 4 * 1024 * 1024
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class ComputedSourceAuthorityError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ComputedSourceAuthorityError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BUILD = load_module("ordax_computed_authority_build", BUILD_PATH)
DYNAMIC = load_module("ordax_computed_authority_dynamic", DYNAMIC_PATH)
COMPUTED = load_module("ordax_computed_authority_classification", COMPUTED_PATH)


def canonical_sha256(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ComputedSourceAuthorityError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise ComputedSourceAuthorityError(f"{label} must be an object")
    return value


def normalize_code(text: str) -> str:
    comments_removed, _ = DYNAMIC.lexical_views(text)
    return re.sub(r"\s+", " ", comments_removed).strip()


def normalize_fragment(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def load_contract() -> dict:
    contract = load_json(CONTRACT_PATH, "computed loader source authority contract")
    if contract.get("$schema") != "prototype-ordax.windows-compat-runtime-computed-loader-source-authority/1":
        raise ComputedSourceAuthorityError("unexpected computed source authority schema")
    if contract.get("status") != "computed-loader-control-source-semantics-proven-targets-not-resolved":
        raise ComputedSourceAuthorityError("computed source authority status drifted")
    expected_sha = "c07a6857933c1fc60dff5448d79f39c92481c1e9db5aa628db9d0358446e0701"
    if contract.get("input", {}).get("source_archive_sha256") != expected_sha:
        raise ComputedSourceAuthorityError("computed source authority archive identity drifted")
    verification = contract.get("verification", {})
    required_true = (
        "exact_locked_source_archive_required",
        "dynamic_source_recomputation_required",
        "computed_classification_recomputation_required",
        "comments_must_not_satisfy_semantic_anchors",
        "each_rule_must_reobserve_exact_direct_dlopen",
        "each_control_source_requires_source_evidence",
        "line_numbers_are_not_authority",
    )
    if any(verification.get(key) is not True for key in required_true):
        raise ComputedSourceAuthorityError("computed source authority guarantees drifted")
    if verification.get("runtime_value_resolution_complete") is not False:
        raise ComputedSourceAuthorityError("computed source authority overclaims runtime resolution")

    rules = contract.get("rules")
    if not isinstance(rules, list) or len(rules) != 10:
        raise ComputedSourceAuthorityError("exactly ten computed source authority rules are required")
    ids: set[str] = set()
    keys: set[tuple[str, str]] = set()
    for rule in rules:
        if not isinstance(rule, dict):
            raise ComputedSourceAuthorityError("computed source authority rule must be an object")
        for key in ("id", "path", "expression", "control_source", "source_semantics"):
            if not isinstance(rule.get(key), str) or not rule[key]:
                raise ComputedSourceAuthorityError(f"computed source authority rule lacks {key}")
        fragments = rule.get("required_code_fragments")
        if not isinstance(fragments, list) or not fragments or any(not isinstance(item, str) or not item for item in fragments):
            raise ComputedSourceAuthorityError(f"computed source authority fragments invalid: {rule['id']}")
        if len(fragments) != len(set(fragments)):
            raise ComputedSourceAuthorityError(f"duplicate semantic fragment: {rule['id']}")
        if rule["id"] in ids:
            raise ComputedSourceAuthorityError(f"duplicate computed source authority id: {rule['id']}")
        pair = (rule["path"], rule["expression"])
        if pair in keys:
            raise ComputedSourceAuthorityError(f"duplicate computed source authority key: {pair}")
        ids.add(rule["id"])
        keys.add(pair)

    boundaries = contract.get("open_boundaries", {})
    if not boundaries or any(value is not False for value in boundaries.values()):
        raise ComputedSourceAuthorityError("computed source authority crossed an open boundary")
    promotion = contract.get("promotion", {})
    if not promotion or any(value is not False for value in promotion.values()):
        raise ComputedSourceAuthorityError("computed source authority claims promotion or execution")
    return contract


def extract_members(archive: Path, source: dict, paths: set[str]) -> dict[str, dict]:
    BUILD.validate_archive(source, archive)
    root = source["upstream"]["archive_root"]
    wanted = {f"{root}/{path}": path for path in paths}
    found: dict[str, dict] = {}
    try:
        with tarfile.open(archive, "r:xz") as tar:
            for member in tar:
                relative = wanted.get(member.name)
                if relative is None:
                    continue
                if relative in found:
                    raise ComputedSourceAuthorityError(f"duplicate source authority member: {relative}")
                if not member.isfile() or member.size <= 0 or member.size > MAX_MEMBER_BYTES:
                    raise ComputedSourceAuthorityError(f"invalid source authority member type/size: {relative}")
                handle = tar.extractfile(member)
                if handle is None:
                    raise ComputedSourceAuthorityError(f"cannot read source authority member: {relative}")
                raw = handle.read(MAX_MEMBER_BYTES + 1)
                if len(raw) != member.size or len(raw) > MAX_MEMBER_BYTES:
                    raise ComputedSourceAuthorityError(f"source authority member exceeded bound: {relative}")
                try:
                    text = raw.decode("utf-8", errors="strict")
                except UnicodeDecodeError as exc:
                    raise ComputedSourceAuthorityError(f"source authority member is not UTF-8: {relative}") from exc
                found[relative] = {
                    "text": text,
                    "sha256": sha256_bytes(raw),
                    "size": len(raw),
                }
    except (tarfile.TarError, OSError) as exc:
        raise ComputedSourceAuthorityError(f"cannot inspect locked source archive: {exc}") from exc
    missing = sorted(paths - set(found))
    if missing:
        raise ComputedSourceAuthorityError(f"locked source archive lacks authority members: {missing}")
    return found


def classification_by_rule(proof: dict) -> dict[str, dict]:
    records = proof.get("classifications")
    if not isinstance(records, list):
        raise ComputedSourceAuthorityError("computed classification records are missing")
    result: dict[str, dict] = {}
    for record in records:
        if not isinstance(record, dict) or not isinstance(record.get("rule_id"), str):
            raise ComputedSourceAuthorityError("computed classification record is invalid")
        rule_id = record["rule_id"]
        if rule_id in result:
            raise ComputedSourceAuthorityError(f"computed classification rule is not unique: {rule_id}")
        result[rule_id] = record
    return result


def verify_rule_source(rule: dict, classification: dict, text: str) -> dict:
    for field in ("path", "expression", "control_source"):
        if classification.get(field) != rule[field]:
            raise ComputedSourceAuthorityError(
                f"computed classification {field} drifted for {rule['id']}: "
                f"{classification.get(field)!r} != {rule[field]!r}"
            )
    if classification.get("api") != "dlopen":
        raise ComputedSourceAuthorityError(f"computed source authority only models dlopen: {rule['id']}")

    calls = DYNAMIC.scan_text(rule["path"], text, {"dlopen": 0, "dlmopen": 1})
    matching = [
        call for call in calls
        if call.get("api") == "dlopen"
        and call.get("target", {}).get("kind") == "dynamic-expression"
        and call.get("target", {}).get("expression") == rule["expression"]
    ]
    if len(matching) != 1:
        raise ComputedSourceAuthorityError(
            f"source must contain exactly one classified direct dlopen for {rule['id']}: {len(matching)}"
        )

    normalized = normalize_code(text)
    fragment_evidence: list[dict] = []
    for fragment in rule["required_code_fragments"]:
        normalized_fragment = normalize_fragment(fragment)
        count = normalized.count(normalized_fragment)
        if count != 1:
            raise ComputedSourceAuthorityError(
                f"source semantic fragment cardinality drifted for {rule['id']}: "
                f"expected=1 actual={count} fragment={fragment!r}"
            )
        fragment_evidence.append({
            "sha256": sha256_bytes(normalized_fragment.encode("utf-8")),
            "match_count": count,
        })
    return {
        "id": rule["id"],
        "path": rule["path"],
        "expression": rule["expression"],
        "control_source": rule["control_source"],
        "source_semantics": rule["source_semantics"],
        "direct_dlopen_reobserved": True,
        "semantic_fragments": fragment_evidence,
    }


def verify(
    archive: Path,
    source_proof: dict,
    dynamic_proof: dict,
    computed_proof: dict,
) -> dict:
    contract = load_contract()
    source = BUILD.validate_source(BUILD.load_source())
    if source["runtime_id"] != contract["runtime_id"]:
        raise ComputedSourceAuthorityError("computed source authority runtime identity drifted")
    if source["upstream"]["archive_sha256"] != contract["input"]["source_archive_sha256"]:
        raise ComputedSourceAuthorityError("source lock does not match computed source authority archive")

    expected_source = BUILD.validate_archive(source, archive)
    if source_proof != expected_source:
        raise ComputedSourceAuthorityError("source proof is not the proof of the supplied locked archive")
    expected_dynamic = DYNAMIC.discover(archive, source, source_proof)
    if dynamic_proof != expected_dynamic:
        raise ComputedSourceAuthorityError("dynamic source proof does not recompute from locked archive")
    expected_computed = COMPUTED.classify(dynamic_proof)
    if computed_proof != expected_computed:
        raise ComputedSourceAuthorityError("computed classification does not recompute from dynamic source proof")

    by_rule = classification_by_rule(computed_proof)
    expected_ids = {rule["id"] for rule in contract["rules"]}
    if set(by_rule) != expected_ids:
        raise ComputedSourceAuthorityError("computed classification rule set drifted from source authority contract")

    paths = {rule["path"] for rule in contract["rules"]}
    members = extract_members(archive, source, paths)
    evidence: list[dict] = []
    for rule in contract["rules"]:
        item = verify_rule_source(rule, by_rule[rule["id"]], members[rule["path"]]["text"])
        item["source_member_sha256"] = members[rule["path"]]["sha256"]
        evidence.append(item)
    evidence.sort(key=lambda item: item["id"])

    member_manifest = [
        {"path": path, "size": members[path]["size"], "sha256": members[path]["sha256"]}
        for path in sorted(members)
    ]
    control_counts: dict[str, int] = {}
    for item in evidence:
        control_counts[item["control_source"]] = control_counts.get(item["control_source"], 0) + 1

    core = {
        "runtime_id": source["runtime_id"],
        "source_archive_sha256": source["upstream"]["archive_sha256"],
        "source_proof_sha256": DYNAMIC.canonical_sha256(DYNAMIC.source_proof_core(source_proof)),
        "dynamic_source_inventory_sha256": dynamic_proof["inventory_sha256"],
        "computed_classification_evidence_sha256": computed_proof["evidence_sha256"],
        "authority_rules_sha256": canonical_sha256(contract["rules"]),
        "source_member_manifest_sha256": canonical_sha256(member_manifest),
        "source_members": member_manifest,
        "rules": evidence,
        "counts": {
            "authority_rules": len(evidence),
            "source_members": len(member_manifest),
            "control_sources": dict(sorted(control_counts.items())),
        },
    }
    return {
        "$schema": PROOF_SCHEMA,
        "status": "computed-loader-control-source-semantics-proven-targets-not-resolved",
        **core,
        "evidence_sha256": canonical_sha256(core),
        "gates": {
            "source_archive_verified": True,
            "dynamic_source_recomputed": True,
            "computed_classification_recomputed": True,
            "all_computed_control_sources_source_verified": True,
            "caller_provided_control_source_verified": True,
            "environment_override_control_source_verified": True,
            "plugin_control_source_verified": True,
            "ntdll_internal_control_source_verified": True,
            "ntdll_bootstrap_control_source_verified": True,
            "caller_provided_library_policy_complete": False,
            "environment_override_resolution_complete": False,
            "plugin_module_resolution_complete": False,
            "ntdll_internal_path_resolution_complete": False,
            "ntdll_bootstrap_path_resolution_complete": False,
            "runtime_computed_target_resolution_complete": False,
            "wrapper_call_graph_complete": False,
            "generated_source_inventory_complete": False,
            "dynamic_load_inventory_complete": False,
            "external_transitive_closure_verified": False,
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
    verify_parser.add_argument("--source-proof", type=Path, required=True)
    verify_parser.add_argument("--dynamic-source-proof", type=Path, required=True)
    verify_parser.add_argument("--computed-classification-proof", type=Path, required=True)
    verify_parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    load_contract()
    if args.command == "check":
        print("windows compatibility computed loader source authority contract: PASS")
        return 0
    result = verify(
        args.source_archive.resolve(),
        load_json(args.source_proof, "source proof"),
        load_json(args.dynamic_source_proof, "dynamic source proof"),
        load_json(args.computed_classification_proof, "computed classification proof"),
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("windows compatibility computed loader source authority: PASS")
    print(json.dumps(result["counts"], sort_keys=True))
    print("evidence:", result["evidence_sha256"])
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (
        ComputedSourceAuthorityError,
        BUILD.CompatibilityRuntimeBuildError,
        DYNAMIC.DynamicLoadDiscoveryError,
        COMPUTED.ComputedTargetClassificationError,
    ) as exc:
        print(f"windows-compat-runtime-computed-source-authority: {exc}", file=sys.stderr)
        raise SystemExit(2)
