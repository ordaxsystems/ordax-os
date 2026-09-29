#!/usr/bin/env python3
"""Prepare a deterministic, unsigned Profile-content publication handoff.

This tool never signs, publishes, installs, activates, or mutates trust. It only
validates an existing canonical Profile-content source and emits a bounded JSON
handoff that identifies the exact bytes an external operator would later sign.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

HANDOFF_SCHEMA = "prototype-ordax.profile-content-publication-handoff/1"
MANIFEST_SCHEMA = "prototype-ordax.profile-content-manifest/1"
PACK_SCHEMA = "ordax.profile-content-pack/1"
TRUST_POLICY_SCHEMA = "prototype-ordax.profile-content-trust-policy/1"
DEFAULT_POLICY = Path(__file__).resolve().parents[2] / "docs/contracts/profile-content-trust-policy.json"


class HandoffError(ValueError):
    pass


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise HandoffError(f"invalid JSON: {path}") from exc
    if not isinstance(value, dict):
        raise HandoffError(f"JSON object required: {path}")
    return value


def _read_policy(policy_path: Path) -> dict:
    policy = _read_json(policy_path)
    if policy.get("$schema") != TRUST_POLICY_SCHEMA:
        raise HandoffError("unsupported Profile-content trust policy schema")
    key_id = policy.get("key_id")
    anchor = policy.get("public_anchor")
    gates = policy.get("current_gates")
    if not isinstance(key_id, str) or not key_id:
        raise HandoffError("Profile-content trust key id is invalid")
    if not isinstance(anchor, dict) or not isinstance(gates, dict):
        raise HandoffError("Profile-content trust policy is incomplete")
    if anchor.get("pinned") is not False:
        raise HandoffError("unsigned handoff is only valid before canonical trust pinning")
    expected = {
        "profile_content_publish_allowed": False,
        "profile_content_install_allowed": False,
        "profile_content_activation_allowed": False,
    }
    for field, value in expected.items():
        if gates.get(field) is not value:
            raise HandoffError(f"unsigned handoff requires {field}=false")
    return policy


def build_handoff(source_dir: Path, policy_path: Path = DEFAULT_POLICY) -> dict:
    policy = _read_policy(policy_path)
    if not source_dir.is_dir():
        raise HandoffError("source directory does not exist")

    names = {path.name for path in source_dir.iterdir()}
    if names != {"manifest.json", "content.pack"}:
        raise HandoffError("source directory must contain exactly manifest.json and content.pack")

    manifest_path = source_dir / "manifest.json"
    content_path = source_dir / "content.pack"
    manifest_bytes = manifest_path.read_bytes()
    content_bytes = content_path.read_bytes()
    manifest = _read_json(manifest_path)
    pack = _read_json(content_path)

    if manifest.get("$schema") != MANIFEST_SCHEMA:
        raise HandoffError("unsupported manifest schema")
    if pack.get("schema") != PACK_SCHEMA:
        raise HandoffError("unsupported content pack schema")
    if manifest.get("content_format") != PACK_SCHEMA:
        raise HandoffError("manifest content format mismatch")
    if manifest.get("kind") != pack.get("kind"):
        raise HandoffError("manifest/content kind mismatch")
    if manifest.get("content_hash") != _sha256(content_bytes):
        raise HandoffError("content SHA-256 mismatch")
    if manifest.get("content_size") != len(content_bytes):
        raise HandoffError("content size mismatch")
    if manifest.get("requested_capabilities") != []:
        raise HandoffError("publication handoff refuses requested capabilities")
    if manifest.get("runtime_network_allowed") is not False:
        raise HandoffError("publication handoff refuses runtime network authority")
    if manifest.get("mutable_host_access_allowed") is not False:
        raise HandoffError("publication handoff refuses mutable host authority")

    source = manifest.get("source")
    if not isinstance(source, dict):
        raise HandoffError("manifest source is required")
    revision = source.get("revision")
    if not isinstance(revision, str) or len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision):
        raise HandoffError("manifest source revision must be a full git SHA")

    component_id = manifest.get("id")
    version = manifest.get("version")
    publisher = manifest.get("publisher")
    if not all(isinstance(v, str) and v for v in (component_id, version, publisher)):
        raise HandoffError("manifest identity is incomplete")

    return {
        "$schema": HANDOFF_SCHEMA,
        "component": {
            "id": component_id,
            "kind": manifest["kind"],
            "version": version,
            "publisher": publisher,
        },
        "source": {
            "revision": revision,
            "uri": source.get("uri"),
            "license": source.get("license"),
            "jurisdiction": source.get("jurisdiction"),
        },
        "artifacts": {
            "manifest": {
                "name": "manifest.json",
                "sha256": _sha256(manifest_bytes),
                "sizeBytes": len(manifest_bytes),
            },
            "content": {
                "name": "content.pack",
                "sha256": _sha256(content_bytes),
                "sizeBytes": len(content_bytes),
            },
        },
        "constraints": {
            "requestedCapabilities": [],
            "runtimeNetworkAllowed": False,
            "mutableHostAccessAllowed": False,
        },
        "signing": {
            "required": True,
            "keyId": policy["key_id"],
            "envelopePresent": False,
            "canonicalTrustAnchorPinned": policy["public_anchor"]["pinned"],
        },
        "gates": {
            "publicationAllowed": policy["current_gates"]["profile_content_publish_allowed"],
            "installationAllowed": policy["current_gates"]["profile_content_install_allowed"],
            "activationAllowed": policy["current_gates"]["profile_content_activation_allowed"],
        },
    }


def write_handoff(source_dir: Path, output_path: Path, policy_path: Path = DEFAULT_POLICY) -> dict:
    if output_path.exists():
        raise HandoffError("refusing to overwrite publication handoff")
    handoff = build_handoff(source_dir, policy_path)
    payload = (
        json.dumps(handoff, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False)
        + "\n"
    ).encode("utf-8")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(payload)
    return handoff


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--policy", default=str(DEFAULT_POLICY))
    args = parser.parse_args()
    try:
        handoff = write_handoff(Path(args.source), Path(args.out), Path(args.policy))
    except HandoffError as exc:
        print(f"PROFILE_CONTENT_PUBLICATION_HANDOFF_ERROR={exc}")
        return 1
    print("PROFILE_CONTENT_PUBLICATION_HANDOFF=PASS")
    print(f"PROFILE_CONTENT_COMPONENT={handoff['component']['id']}@{handoff['component']['version']}")
    print("PROFILE_CONTENT_CANONICAL_ANCHOR_PINNED=NO")
    print("PROFILE_CONTENT_PUBLICATION_ALLOWED=NO")
    print("PROFILE_CONTENT_INSTALL_ALLOWED=NO")
    print("PROFILE_CONTENT_ACTIVATION_ALLOWED=NO")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
