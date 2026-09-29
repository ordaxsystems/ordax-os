#!/usr/bin/env python3
"""Classify Wine build-system producers of generated C sources.

This is intentionally narrower than a generated-source inventory. It proves that
nine source-generation rules declared by Wine 11.0's pinned tools/makedep.c are
present exactly once and records their authority. It does not claim that every
rule instance or generated output has been enumerated or scanned for loader calls.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import tarfile

HERE = Path(__file__).resolve().parent
CONTRACT_PATH = HERE / "runtime-generated-source-producers.json"
SOURCE_LOCK_PATH = HERE / "source.json"
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-generated-source-producer-proof/1"
MAX_MAKEDEP_BYTES = 4 * 1024 * 1024


class GeneratedSourceProducerError(RuntimeError):
    pass


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise GeneratedSourceProducerError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise GeneratedSourceProducerError(f"{label} must be an object")
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_sha256(value: object) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def load_contract() -> dict:
    value = load_json(CONTRACT_PATH, "generated source producer contract")
    if value.get("$schema") != "prototype-ordax.windows-compat-runtime-generated-source-producers/1":
        raise GeneratedSourceProducerError("unexpected generated source producer contract schema")
    if value.get("status") != "producer-classification-only-not-generated-source-inventory-complete":
        raise GeneratedSourceProducerError("generated source producer status drifted")
    rules = value.get("producer_rules")
    if not isinstance(rules, list) or len(rules) != value.get("expected", {}).get("producer_rules"):
        raise GeneratedSourceProducerError("generated source producer rule count drifted")
    ids = [item.get("id") for item in rules if isinstance(item, dict)]
    if len(ids) != len(rules) or len(set(ids)) != len(ids):
        raise GeneratedSourceProducerError("generated source producer rule ids are invalid or duplicated")
    if not value.get("open_boundaries") or any(item is not False for item in value["open_boundaries"].values()):
        raise GeneratedSourceProducerError("generated source producer open boundaries drifted")
    if not value.get("promotion") or any(item is not False for item in value["promotion"].values()):
        raise GeneratedSourceProducerError("generated source producer contract claims promotion/execution authority")
    return value


def source_lock() -> dict:
    value = load_json(SOURCE_LOCK_PATH, "source lock")
    if value.get("$schema") != "prototype-ordax.windows-compat-runtime-source/1":
        raise GeneratedSourceProducerError("unexpected source lock schema")
    return value


def strip_comments(text: str) -> str:
    """Remove C comments while preserving strings/chars and byte positions roughly."""
    out = list(text)
    i = 0
    state = "code"
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if state == "code":
            if ch == '"':
                state = "string"
            elif ch == "'":
                state = "char"
            elif ch == "/" and nxt == "/":
                out[i] = out[i + 1] = " "
                i += 2
                while i < len(text) and text[i] != "\n":
                    out[i] = " "
                    i += 1
                continue
            elif ch == "/" and nxt == "*":
                out[i] = out[i + 1] = " "
                state = "block"
                i += 2
                continue
        elif state == "string":
            if ch == "\\":
                i += 2
                continue
            if ch == '"':
                state = "code"
        elif state == "char":
            if ch == "\\":
                i += 2
                continue
            if ch == "'":
                state = "code"
        elif state == "block":
            if ch == "*" and nxt == "/":
                out[i] = out[i + 1] = " "
                state = "code"
                i += 2
                continue
            if ch != "\n":
                out[i] = " "
        i += 1
    if state == "block":
        raise GeneratedSourceProducerError("unterminated block comment in makedep source")
    return "".join(out)


def rule_pattern(rule: dict) -> re.Pattern[str]:
    kind = rule.get("kind")
    if kind == "replace-extension":
        src = re.escape(rule["input_suffix"])
        dst = re.escape(rule["output_suffix"])
        return re.compile(
            r"replace_extension\s*\(\s*source->name\s*,\s*\"" + src + r"\"\s*,\s*\"" + dst + r"\"\s*\)"
        )
    if kind == "direct-generated-source":
        name = re.escape(rule["output_name"])
        return re.compile(
            r"add_generated_source\s*\(\s*make\s*,\s*\"dlldata\.o\"\s*,\s*\"" + name + r"\"\s*,\s*0\s*\)"
        )
    if kind == "extra-object-fallback":
        return re.compile(
            r"add_generated_source\s*\(\s*make\s*,\s*obj\s*,\s*replace_extension\s*\(\s*obj\s*,\s*\"\.o\"\s*,\s*\"\.c\"\s*\)\s*,\s*0\s*\)"
        )
    raise GeneratedSourceProducerError(f"unsupported generated source producer rule kind: {kind!r}")


def classify_makedep(text: str, contract: dict) -> list[dict]:
    code = strip_comments(text)
    observed = []
    for rule in contract["producer_rules"]:
        pattern = rule_pattern(rule)
        matches = list(pattern.finditer(code))
        if len(matches) != 1:
            raise GeneratedSourceProducerError(
                f"generated source producer rule {rule['id']} must be observed exactly once; found={len(matches)}"
            )
        observed.append({**rule, "match_offset": matches[0].start()})
    observed.sort(key=lambda item: item["id"])
    return observed


def read_makedep(archive: Path, source: dict, contract: dict) -> tuple[bytes, str]:
    upstream = source.get("upstream", {})
    if archive.stat().st_size != upstream.get("archive_size_bytes") or sha256_file(archive) != upstream.get("archive_sha256"):
        raise GeneratedSourceProducerError("Wine archive does not match source lock")
    if upstream.get("archive_sha256") != contract["input"]["source_archive_sha256"]:
        raise GeneratedSourceProducerError("source lock and generated source producer contract archive digest differ")
    if upstream.get("archive_root") != contract["input"]["archive_root"]:
        raise GeneratedSourceProducerError("source archive root drifted")
    wanted = f"{upstream['archive_root']}/{contract['input']['makedep_path']}"
    found = None
    try:
        with tarfile.open(archive, "r:xz") as tar:
            for member in tar:
                if member.name != wanted:
                    continue
                if found is not None:
                    raise GeneratedSourceProducerError("duplicate makedep source in Wine archive")
                if not member.isfile() or member.size <= 0 or member.size > MAX_MAKEDEP_BYTES:
                    raise GeneratedSourceProducerError("invalid makedep source archive member")
                handle = tar.extractfile(member)
                if handle is None:
                    raise GeneratedSourceProducerError("cannot read makedep source archive member")
                raw = handle.read(MAX_MAKEDEP_BYTES + 1)
                if len(raw) != member.size or len(raw) > MAX_MAKEDEP_BYTES:
                    raise GeneratedSourceProducerError("makedep source exceeded exact bound")
                found = raw
    except (tarfile.TarError, OSError) as exc:
        raise GeneratedSourceProducerError(f"cannot inspect Wine archive: {exc}") from exc
    if found is None:
        raise GeneratedSourceProducerError("Wine archive lacks tools/makedep.c")
    try:
        text = found.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise GeneratedSourceProducerError("tools/makedep.c is not UTF-8") from exc
    return found, text


def prove(archive: Path) -> dict:
    contract = load_contract()
    source = source_lock()
    if source.get("runtime_id") != contract.get("runtime_id"):
        raise GeneratedSourceProducerError("runtime identity drifted")
    raw, text = read_makedep(archive, source, contract)
    rules = classify_makedep(text, contract)
    core = {
        "runtime_id": contract["runtime_id"],
        "source_archive_sha256": contract["input"]["source_archive_sha256"],
        "makedep_path": contract["input"]["makedep_path"],
        "makedep_sha256": hashlib.sha256(raw).hexdigest(),
        "producer_rules": rules,
    }
    return {
        "$schema": PROOF_SCHEMA,
        "status": "generated-c-producer-classes-proven-not-generated-source-inventory-complete",
        **core,
        "evidence_sha256": canonical_sha256(core),
        "counts": {"producer_rules": len(rules)},
        "gates": {
            "source_archive_verified": True,
            "makedep_source_bound": True,
            "generated_c_producer_classes_classified": True,
            "all_producer_rules_observed": True,
            "generated_source_instances_inventoried": False,
            "generated_source_outputs_scanned": False,
            "generated_source_inventory_complete": False,
            "wrapper_call_graph_complete": False,
            "dynamic_load_inventory_complete": False,
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
    parser.add_argument("command", choices=["check", "prove"])
    parser.add_argument("--source-archive", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    load_contract()
    if args.command == "check":
        print("windows compatibility generated source producer contract: PASS")
        return 0
    if not args.source_archive or not args.out:
        raise GeneratedSourceProducerError("prove requires --source-archive and --out")
    result = prove(args.source_archive.resolve())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("windows compatibility generated C source producers: PASS")
    print(json.dumps(result["counts"], sort_keys=True))
    print("evidence:", result["evidence_sha256"])
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except GeneratedSourceProducerError as exc:
        print(f"windows-compat-runtime-generated-source-producers: {exc}", file=sys.stderr)
        raise SystemExit(2)
