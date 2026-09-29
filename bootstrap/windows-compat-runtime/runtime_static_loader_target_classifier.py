#!/usr/bin/env python3
"""Classify static-string direct dlopen targets without inferring Linux reachability."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
CONTRACT = HERE / "runtime-static-loader-targets.json"
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-static-loader-target-classification-proof/1"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class StaticTargetClassificationError(RuntimeError):
    pass


def canonical_sha256(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise StaticTargetClassificationError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise StaticTargetClassificationError(f"{label} must be an object")
    return value


def load_contract() -> dict:
    contract = load_json(CONTRACT, "static loader target contract")
    if contract.get("$schema") != "prototype-ordax.windows-compat-runtime-static-loader-targets/1":
        raise StaticTargetClassificationError("unexpected static target contract schema")
    if contract.get("status") != "static-loader-target-classification-only-not-linux-reachability-proof":
        raise StaticTargetClassificationError("static target contract status drifted")
    classification = contract.get("classification", {})
    for key in ("all_static_string_callsites_must_match_exactly_one_rule", "all_rules_must_be_observed", "line_numbers_are_not_authority"):
        if classification.get(key) is not True:
            raise StaticTargetClassificationError(f"static target classification guarantee drifted: {key}")
    for key in ("linux_build_reachability_verified", "static_target_runtime_resolution_complete"):
        if classification.get(key) is not False:
            raise StaticTargetClassificationError(f"static target classification overclaims: {key}")
    boundaries = contract.get("open_boundaries", {})
    if not boundaries or any(value is not False for value in boundaries.values()):
        raise StaticTargetClassificationError("static target open boundaries drifted")
    promotion = contract.get("promotion", {})
    if not promotion or any(value is not False for value in promotion.values()):
        raise StaticTargetClassificationError("static target contract claims promotion/execution authority")
    rules = contract.get("rules")
    if not isinstance(rules, list) or not rules:
        raise StaticTargetClassificationError("static target classification rules are missing")
    ids, keys = set(), set()
    for rule in rules:
        if not isinstance(rule, dict):
            raise StaticTargetClassificationError("static target rule must be an object")
        for field in ("id", "path", "expression", "category", "host_platform"):
            if not isinstance(rule.get(field), str) or not rule[field]:
                raise StaticTargetClassificationError(f"static target rule lacks {field}")
        if rule["id"] in ids:
            raise StaticTargetClassificationError(f"duplicate static target rule id: {rule['id']}")
        key = (rule["path"], rule["expression"])
        if key in keys:
            raise StaticTargetClassificationError(f"duplicate static target rule key: {key}")
        if not isinstance(rule.get("expected_callsites"), int) or rule["expected_callsites"] < 1:
            raise StaticTargetClassificationError(f"invalid expected callsite count: {rule['id']}")
        ids.add(rule["id"]); keys.add(key)
    return contract


def dynamic_source_core(proof: dict) -> dict:
    return {
        "runtime_id": proof.get("runtime_id"),
        "source_archive_sha256": proof.get("source_archive_sha256"),
        "source_proof_sha256": proof.get("source_proof_sha256"),
        "c_archive_manifest_sha256": proof.get("c_archive_manifest_sha256"),
        "counts": proof.get("counts"),
        "callsites": proof.get("callsites"),
    }


def validate_dynamic_source(proof: dict, contract: dict) -> str:
    if proof.get("$schema") != contract.get("input", {}).get("dynamic_source_proof_schema"):
        raise StaticTargetClassificationError("unexpected dynamic source proof schema")
    if proof.get("runtime_id") != contract.get("runtime_id"):
        raise StaticTargetClassificationError("dynamic source runtime identity drifted")
    digest = proof.get("inventory_sha256")
    if not isinstance(digest, str) or not SHA256_RE.fullmatch(digest):
        raise StaticTargetClassificationError("dynamic source inventory digest is invalid")
    if canonical_sha256(dynamic_source_core(proof)) != digest:
        raise StaticTargetClassificationError("dynamic source inventory digest does not verify")
    gates = proof.get("gates", {})
    for key in ("source_lock_verified", "source_proof_verified", "c_archive_manifest_bound", "direct_host_loader_calls_inventoried"):
        if gates.get(key) is not True:
            raise StaticTargetClassificationError(f"dynamic source prerequisite is not proven: {key}")
    for key in ("dynamic_load_inventory_complete", "external_transitive_closure_verified", "runtime_dependency_inventory_complete", "binary_artifact_pinned", "activation_authorized", "execution_authorized", "wine_executed", "windows_payload_executed"):
        if gates.get(key) is not False:
            raise StaticTargetClassificationError(f"dynamic source proof crossed forbidden boundary: {key}")
    return digest


def classify(dynamic_source: dict) -> dict:
    contract = load_contract()
    digest = validate_dynamic_source(dynamic_source, contract)
    callsites = dynamic_source.get("callsites")
    if not isinstance(callsites, list):
        raise StaticTargetClassificationError("dynamic source callsites are missing")
    static_calls = [call for call in callsites if isinstance(call, dict) and isinstance(call.get("target"), dict) and call["target"].get("kind") == "static-string"]
    if dynamic_source.get("counts", {}).get("static_string_targets") != len(static_calls):
        raise StaticTargetClassificationError("static-string callsite count drifted")
    if not static_calls:
        raise StaticTargetClassificationError("dynamic source proof contains no static loader targets")
    rule_map = {(r["path"], r["expression"]): r for r in contract["rules"]}
    observed = {r["id"]: 0 for r in contract["rules"]}
    records = []
    for call in static_calls:
        if call.get("api") != "dlopen":
            raise StaticTargetClassificationError(f"unmodeled static loader API: {call.get('api')}")
        expression = call["target"].get("expression")
        rule = rule_map.get((call.get("path"), expression))
        if rule is None:
            raise StaticTargetClassificationError(f"unclassified static loader target: path={call.get('path')!r} expression={expression!r}")
        observed[rule["id"]] += 1
        records.append({
            "path": call["path"], "line": call.get("line"), "column": call.get("column"), "api": call["api"],
            "expression": expression, "rule_id": rule["id"], "category": rule["category"], "host_platform": rule["host_platform"]
        })
    for rule in contract["rules"]:
        actual = observed[rule["id"]]
        if actual != rule["expected_callsites"]:
            raise StaticTargetClassificationError(f"static target rule cardinality drifted: {rule['id']} expected={rule['expected_callsites']} actual={actual}")
    records.sort(key=lambda item: (item["path"], item.get("line") or 0, item["rule_id"]))
    categories, platforms = {}, {}
    for record in records:
        categories[record["category"]] = categories.get(record["category"], 0) + 1
        platforms[record["host_platform"]] = platforms.get(record["host_platform"], 0) + 1
    counts = {"static_callsites": len(records), "classification_rules": len(contract["rules"]), "categories": dict(sorted(categories.items())), "host_platforms": dict(sorted(platforms.items()))}
    core = {"runtime_id": contract["runtime_id"], "dynamic_source_inventory_sha256": digest, "classifications": records, "counts": counts}
    return {
        "$schema": PROOF_SCHEMA,
        "status": "static-loader-targets-classified-linux-build-reachability-open",
        **core,
        "evidence_sha256": canonical_sha256(core),
        "gates": {
            "dynamic_source_proof_verified": True,
            "all_static_loader_targets_classified": True,
            "all_classification_rules_observed": True,
            "linux_build_reachability_verified": False,
            "static_target_runtime_resolution_complete": False,
            "dynamic_load_inventory_complete": False,
            "external_transitive_closure_verified": False,
            "runtime_dependency_inventory_complete": False,
            "runtime_package_content_hashes_pinned": False,
            "binary_artifact_pinned": False,
            "activation_authorized": False,
            "execution_authorized": False,
            "wine_executed": False,
            "windows_payload_executed": False
        }
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check", "classify"])
    parser.add_argument("--dynamic-source-proof", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    load_contract()
    if args.command == "check":
        print("windows compatibility static loader target classification contract: PASS")
        return 0
    if not all((args.dynamic_source_proof, args.out)):
        raise StaticTargetClassificationError("classify requires --dynamic-source-proof and --out")
    result = classify(load_json(args.dynamic_source_proof, "dynamic source proof"))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("windows compatibility static loader target classification: PASS")
    print(json.dumps(result["counts"], sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except StaticTargetClassificationError as exc:
        print(f"windows-compat-runtime-static-targets: {exc}", file=sys.stderr)
        raise SystemExit(2)
