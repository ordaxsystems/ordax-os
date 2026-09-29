#!/usr/bin/env python3
"""Classify every runtime-computed direct dlopen target from the locked Wine source proof.

This step is descriptive and fail-closed: each dynamic-expression callsite from
the authoritative source inventory must match exactly one reviewed semantic
rule, and every rule must be observed at its expected cardinality. It does not
resolve any runtime path or grant runtime completeness.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
CONTRACT = HERE / "runtime-computed-loader-targets.json"
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-computed-loader-target-classification-proof/1"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class ComputedTargetClassificationError(RuntimeError):
    pass


def canonical_sha256(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ComputedTargetClassificationError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise ComputedTargetClassificationError(f"{label} must be an object")
    return value


def load_contract() -> dict:
    contract = load_json(CONTRACT, "runtime-computed target contract")
    if contract.get("$schema") != "prototype-ordax.windows-compat-runtime-computed-loader-targets/1":
        raise ComputedTargetClassificationError("unexpected runtime-computed target contract schema")
    if contract.get("status") != "runtime-computed-target-classification-only-not-resolved":
        raise ComputedTargetClassificationError("runtime-computed target contract status drifted")
    classification = contract.get("classification", {})
    required_true = (
        "all_dynamic_expression_callsites_must_match_exactly_one_rule",
        "all_rules_must_be_observed",
        "line_numbers_are_not_authority",
    )
    if any(classification.get(key) is not True for key in required_true):
        raise ComputedTargetClassificationError("runtime-computed classification guarantees drifted")
    if classification.get("runtime_computed_target_resolution_complete") is not False:
        raise ComputedTargetClassificationError("runtime-computed classification overclaims resolution")

    boundaries = contract.get("open_boundaries", {})
    if not boundaries or any(value is not False for value in boundaries.values()):
        raise ComputedTargetClassificationError("runtime-computed open boundaries drifted")
    promotion = contract.get("promotion", {})
    if not promotion or any(value is not False for value in promotion.values()):
        raise ComputedTargetClassificationError("runtime-computed contract claims promotion/execution authority")

    rules = contract.get("rules")
    if not isinstance(rules, list) or not rules:
        raise ComputedTargetClassificationError("runtime-computed classification rules are missing")
    ids: set[str] = set()
    keys: set[tuple[str, str]] = set()
    for rule in rules:
        if not isinstance(rule, dict):
            raise ComputedTargetClassificationError("runtime-computed classification rule must be an object")
        required_strings = ("id", "path", "expression", "category", "control_source")
        if any(not isinstance(rule.get(key), str) or not rule[key] for key in required_strings):
            raise ComputedTargetClassificationError("runtime-computed classification rule is incomplete")
        if rule["id"] in ids:
            raise ComputedTargetClassificationError(f"duplicate runtime-computed rule id: {rule['id']}")
        key = (rule["path"], rule["expression"])
        if key in keys:
            raise ComputedTargetClassificationError(f"duplicate runtime-computed rule key: {key}")
        expected = rule.get("expected_callsites")
        if not isinstance(expected, int) or expected < 1:
            raise ComputedTargetClassificationError(f"invalid expected callsite count for rule: {rule['id']}")
        ids.add(rule["id"])
        keys.add(key)
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


def validate_dynamic_source_proof(proof: dict, contract: dict) -> str:
    if proof.get("$schema") != contract.get("input", {}).get("dynamic_source_proof_schema"):
        raise ComputedTargetClassificationError("unexpected dynamic source proof schema")
    if proof.get("runtime_id") != contract.get("runtime_id"):
        raise ComputedTargetClassificationError("dynamic source runtime identity drifted")
    digest = proof.get("inventory_sha256")
    if not isinstance(digest, str) or not SHA256_RE.fullmatch(digest):
        raise ComputedTargetClassificationError("dynamic source inventory digest is invalid")
    if canonical_sha256(dynamic_source_core(proof)) != digest:
        raise ComputedTargetClassificationError("dynamic source inventory digest does not verify")

    gates = proof.get("gates", {})
    for key in (
        "source_lock_verified",
        "source_proof_verified",
        "c_archive_manifest_bound",
        "direct_host_loader_calls_inventoried",
        "configured_soname_symbols_classified",
    ):
        if gates.get(key) is not True:
            raise ComputedTargetClassificationError(f"dynamic source prerequisite is not proven: {key}")
    for key in (
        "configured_soname_values_resolved",
        "wrapper_call_graph_complete",
        "generated_source_inventory_complete",
        "dynamic_load_inventory_complete",
        "external_transitive_closure_verified",
        "runtime_dependency_inventory_complete",
        "runtime_package_content_hashes_pinned",
        "binary_artifact_pinned",
        "activation_authorized",
        "execution_authorized",
        "wine_executed",
        "windows_payload_executed",
    ):
        if gates.get(key) is not False:
            raise ComputedTargetClassificationError(f"dynamic source proof crossed forbidden boundary: {key}")
    return digest


def classify(dynamic_source: dict) -> dict:
    contract = load_contract()
    source_digest = validate_dynamic_source_proof(dynamic_source, contract)
    callsites = dynamic_source.get("callsites")
    if not isinstance(callsites, list):
        raise ComputedTargetClassificationError("dynamic source callsites are missing")

    dynamic_calls = []
    for call in callsites:
        if not isinstance(call, dict) or not isinstance(call.get("target"), dict):
            raise ComputedTargetClassificationError("dynamic source callsite is invalid")
        if call["target"].get("kind") == "dynamic-expression":
            dynamic_calls.append(call)

    counts = dynamic_source.get("counts", {})
    if counts.get("dynamic_expression_targets") != len(dynamic_calls):
        raise ComputedTargetClassificationError("dynamic-expression callsite count drifted")
    if not dynamic_calls:
        raise ComputedTargetClassificationError("dynamic source proof contains no runtime-computed targets")

    rules = contract["rules"]
    rule_map = {(rule["path"], rule["expression"]): rule for rule in rules}
    observed = {rule["id"]: 0 for rule in rules}
    records: list[dict] = []
    for call in dynamic_calls:
        if call.get("api") != "dlopen":
            raise ComputedTargetClassificationError(
                f"unmodeled runtime-computed loader API: {call.get('path')}:{call.get('line')}:{call.get('api')}"
            )
        expression = call["target"].get("expression")
        if not isinstance(expression, str) or not expression:
            raise ComputedTargetClassificationError("runtime-computed target expression is invalid")
        key = (call.get("path"), expression)
        rule = rule_map.get(key)
        if rule is None:
            raise ComputedTargetClassificationError(
                f"unclassified runtime-computed target: path={call.get('path')!r} expression={expression!r}"
            )
        observed[rule["id"]] += 1
        records.append(
            {
                "path": call["path"],
                "line": call.get("line"),
                "column": call.get("column"),
                "api": call["api"],
                "expression": expression,
                "rule_id": rule["id"],
                "category": rule["category"],
                "control_source": rule["control_source"],
            }
        )

    for rule in rules:
        actual = observed[rule["id"]]
        if actual != rule["expected_callsites"]:
            raise ComputedTargetClassificationError(
                f"runtime-computed rule cardinality drifted: {rule['id']} expected={rule['expected_callsites']} actual={actual}"
            )

    records.sort(key=lambda item: (item["path"], item.get("line") or 0, item.get("column") or 0, item["rule_id"]))
    category_counts: dict[str, int] = {}
    control_counts: dict[str, int] = {}
    for record in records:
        category_counts[record["category"]] = category_counts.get(record["category"], 0) + 1
        control_counts[record["control_source"]] = control_counts.get(record["control_source"], 0) + 1

    derived_counts = {
        "runtime_computed_callsites": len(records),
        "classification_rules": len(rules),
        "categories": dict(sorted(category_counts.items())),
        "control_sources": dict(sorted(control_counts.items())),
    }
    core = {
        "runtime_id": contract["runtime_id"],
        "dynamic_source_inventory_sha256": source_digest,
        "classifications": records,
        "counts": derived_counts,
    }
    return {
        "$schema": PROOF_SCHEMA,
        "status": "runtime-computed-targets-classified-not-resolved",
        **core,
        "evidence_sha256": canonical_sha256(core),
        "gates": {
            "dynamic_source_proof_verified": True,
            "all_runtime_computed_targets_classified": True,
            "all_classification_rules_observed": True,
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
    parser.add_argument("command", choices=["check", "classify"])
    parser.add_argument("--dynamic-source-proof", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    load_contract()
    if args.command == "check":
        print("windows compatibility runtime-computed target classification contract: PASS")
        return 0
    if not all((args.dynamic_source_proof, args.out)):
        raise ComputedTargetClassificationError("classify requires --dynamic-source-proof and --out")
    result = classify(load_json(args.dynamic_source_proof, "dynamic source proof"))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("windows compatibility runtime-computed target classification: PASS")
    print(json.dumps(result["counts"], sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ComputedTargetClassificationError as exc:
        print(f"windows-compat-runtime-computed-targets: {exc}", file=sys.stderr)
        raise SystemExit(2)
