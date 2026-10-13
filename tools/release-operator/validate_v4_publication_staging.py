#!/usr/bin/env python3
"""Validate exact Stable v4 prepublication files against the official signed handoff.

This check is read-only. It does not itself verify Ed25519; Step 5 from the
source-owned release-agent must run successfully first.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import stat
import sys

REPO = "ordaxsystems/ordax-os"
FILES = ("system.erofs", "native-surface-runtime.erofs", "local-ai-runtime.erofs")
SCHEMA = "prototype-ordax.canonical-v4-publication-staging/1"


class AdmissionError(ValueError):
    pass


def digest(path: Path) -> tuple[str, int]:
    try:
        mode = path.lstat().st_mode
    except OSError as exc:
        raise AdmissionError(f"missing file: {path.name}") from exc
    if not stat.S_ISREG(mode):
        raise AdmissionError(f"not a regular file: {path.name}")
    result = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
            size += len(block)
    return result.hexdigest(), size


def unique_json(path: Path) -> dict:
    if not stat.S_ISREG(path.lstat().st_mode):
        raise AdmissionError(f"not a regular JSON file: {path.name}")
    def parse(pairs):
        out = {}
        for key, value in pairs:
            if key in out:
                raise AdmissionError(f"duplicate JSON key: {key}")
            out[key] = value
        return out
    try:
        data = json.loads(path.read_bytes().decode("utf-8"), object_pairs_hook=parse)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise AdmissionError(f"invalid JSON: {path.name}") from exc
    if not isinstance(data, dict):
        raise AdmissionError(f"expected JSON object: {path.name}")
    return data


def verified_plan(*, bundle: Path, request: Path, receipt: Path,
                  trust: Path, source_commit: str) -> dict:
    if re.fullmatch(r"[0-9a-f]{40}", source_commit) is None:
        raise AdmissionError("invalid exact source commit")
    tag = "ordax-stable-v4-" + source_commit
    request_data = unique_json(request)
    proof = unique_json(receipt)
    manifest_path = bundle / "release-manifest.json"
    envelope_path = bundle / "release-envelope.json"
    manifest = unique_json(manifest_path)
    envelope = unique_json(envelope_path)
    if (request_data.get("$schema") != "prototype-ordax.canonical-v4-signing-request/1"
        or request_data.get("source_repository") != REPO
        or request_data.get("source_commit") != source_commit
        or request_data.get("operator_ref") != "release-candidate/" + source_commit
        or request_data.get("release_tag") != tag):
        raise AdmissionError("noncanonical request source/tag")
    for key in ("publication_performed", "release_activated", "physical_target_selected",
                "physical_write_authorized", "physical_write_performed"):
        if request_data.get(key) is not False:
            raise AdmissionError("unsafe request state: " + key)
    if (manifest.get("$schema") != "prototype-ordax.release-manifest/4"
        or manifest.get("source_repository") != REPO
        or manifest.get("source_commit") != source_commit):
        raise AdmissionError("manifest identity mismatch")
    try:
        payload = base64.b64decode(envelope["payload"], validate=True)
    except (KeyError, TypeError, ValueError) as exc:
        raise AdmissionError("invalid signed payload") from exc
    if envelope.get("$schema") != "prototype-ordax.release-envelope/1" or payload != manifest_path.read_bytes():
        raise AdmissionError("signed payload is not identical to manifest")
    if (proof.get("schema") != "prototype-ordax.portable-v4-signed-handoff-verification/1"
        or proof.get("source_commit") != source_commit
        or proof.get("signature_verified_by_release_agent") is not True
        or proof.get("signed_payload_matches_manifest_bytes") is not True
        or proof.get("local_artifacts_match_signed_manifest") is not True):
        raise AdmissionError("signed handoff not verified")
    for key in ("release_published", "release_activated", "portable_materialization_performed",
                "physical_target_selected", "physical_write_authorized_by_this_step",
                "physical_write_performed"):
        if proof.get(key) is not False:
            raise AdmissionError("unsafe signed handoff state: " + key)
    for name, path in (("canonical_trust_sha256", trust),
                       ("release_manifest_sha256", manifest_path),
                       ("release_envelope_sha256", envelope_path)):
        if proof.get(name) != digest(path)[0]:
            raise AdmissionError("signed receipt mismatch: " + name)
    signed = manifest.get("artifacts")
    proof_artifacts = proof.get("artifacts")
    urls = request_data.get("artifact_urls")
    if (not isinstance(signed, list) or len(signed) != 3
        or not isinstance(proof_artifacts, dict) or set(proof_artifacts) != set(FILES)
        or not isinstance(urls, dict) or set(urls) != set(FILES)):
        raise AdmissionError("unexpected v4 artifact inventory")
    assets = []
    for name, item in zip(FILES, signed):
        if not isinstance(item, dict) or item.get("name") != name:
            raise AdmissionError("unexpected v4 artifact order")
        url = f"https://github.com/{REPO}/releases/download/{tag}/{name}"
        if item.get("url") != url or urls.get(name) != url:
            raise AdmissionError("noncanonical artifact URL: " + name)
        actual_hash, actual_size = digest(bundle / name)
        recorded = proof_artifacts[name]
        if (not isinstance(recorded, dict) or actual_hash != item.get("sha256")
            or actual_size != item.get("size") or recorded.get("sha256") != actual_hash
            or recorded.get("size") != actual_size or actual_size <= 0):
            raise AdmissionError("artifact differs from signed manifest: " + name)
        assets.append({"name": name, "sha256": actual_hash, "size": actual_size})
    for name in ("release-manifest.json", "release-envelope.json"):
        sha, size = digest(bundle / name)
        assets.insert(0 if name == "release-manifest.json" else 1,
                      {"name": name, "sha256": sha, "size": size})
    return {"schema": SCHEMA, "status": "ready-for-explicit-publication-review",
            "source_commit": source_commit, "release_tag": tag,
            "release_publication_performed": False, "physical_write_authorized": False,
            "physical_write_performed": False, "assets": assets}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle-dir", type=Path, required=True)
    parser.add_argument("--signing-request", type=Path, required=True)
    parser.add_argument("--signed-receipt", type=Path, required=True)
    parser.add_argument("--trust", type=Path, required=True)
    parser.add_argument("--source-commit", required=True)
    args = parser.parse_args()
    try:
        result = verified_plan(bundle=args.bundle_dir, request=args.signing_request,
                               receipt=args.signed_receipt, trust=args.trust,
                               source_commit=args.source_commit)
    except (AdmissionError, OSError) as exc:
        print(json.dumps({"schema": SCHEMA, "status": "blocked", "error": str(exc)}),
              file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
