#!/usr/bin/env python3
"""Read-only preflight for external runtime-component signing.

The preflight validates the unsigned candidate first, then evaluates canonical
platform trust/publication policy. It never receives or reads a private key and
never signs, publishes, stages, installs or activates a component.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import importlib.util
import json
import stat
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


candidate_verifier = _load_module(
    "ordax_unsigned_candidate_verifier",
    HERE / "verify_unsigned_candidate.py",
)
readiness = _load_module(
    "ordax_component_production_readiness",
    HERE / "check_production_readiness.py",
)

TRUST_POLICY = Path("docs/contracts/runtime-component-trust-policy.json")
PACKAGE_POLICY = Path("docs/contracts/runtime-component-package.json")
TRUST_SCHEMA = "prototype-ordax.runtime-component-trust/1"
TRUST_POLICY_SCHEMA = "prototype-ordax.runtime-component-trust-policy/1"
TRUST_DOMAIN = "runtime-components"
KEY_ID = "ordax-runtime-components-v1"

BLOCKER_ANCHOR = "canonical-runtime-component-trust-anchor-not-pinned"
BLOCKER_PUBLICATION = "component-publication-not-authorized"
PENDING_STATUSES = {"operator-ceremony-pending", "foundation-only"}


class SigningPreflightError(RuntimeError):
    pass


def _fail(message: str) -> None:
    raise SigningPreflightError(message)


def _load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        _fail(f"cannot load {label}: {exc}")
    if not isinstance(value, dict):
        _fail(f"{label} must contain one JSON object")
    return value


def _validate_public_anchor(root: Path, trust_policy: dict, anchor_required: bool) -> None:
    public_anchor = trust_policy.get("public_anchor")
    if not isinstance(public_anchor, dict) or set(public_anchor) != {
        "repository_path",
        "runtime_path",
        "pinned",
        "sha256",
    }:
        _fail("runtime-component public anchor policy shape drifted")

    repository_path = public_anchor.get("repository_path")
    if repository_path != "system/trust/runtime-components-ed25519.json":
        _fail("runtime-component canonical public anchor repository path drifted")

    anchor_path = root / repository_path
    pinned = public_anchor.get("pinned")
    expected_digest = public_anchor.get("sha256")

    if not anchor_required:
        if pinned is not False or expected_digest is not None:
            _fail("unpinned runtime-component anchor metadata is inconsistent")
        if anchor_path.exists() or anchor_path.is_symlink():
            _fail("runtime-component anchor file exists while canonical anchor gate is false")
        return

    if pinned is not True:
        _fail("canonical anchor gate is true but public_anchor.pinned is not true")
    if (
        not isinstance(expected_digest, str)
        or len(expected_digest) != 64
        or any(char not in "0123456789abcdef" for char in expected_digest)
    ):
        _fail("pinned runtime-component anchor must carry an exact lowercase SHA-256")

    try:
        metadata = anchor_path.lstat()
    except OSError as exc:
        _fail(f"pinned runtime-component public anchor is unavailable: {exc}")
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        _fail("pinned runtime-component public anchor must be a regular non-symlink file")
    if metadata.st_size <= 0 or metadata.st_size > 16 * 1024:
        _fail("pinned runtime-component public anchor size is outside allowed bounds")

    payload = anchor_path.read_bytes()
    if hashlib.sha256(payload).hexdigest() != expected_digest:
        _fail("pinned runtime-component public anchor digest mismatch")

    try:
        trust = json.loads(payload.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        _fail(f"pinned runtime-component public anchor is invalid JSON: {exc}")
    if not isinstance(trust, dict) or set(trust) != {
        "$schema",
        "key_id",
        "public_key_base64",
    }:
        _fail("pinned runtime-component public anchor shape is invalid")
    if trust.get("$schema") != TRUST_SCHEMA or trust.get("key_id") != KEY_ID:
        _fail("pinned runtime-component public anchor identity is invalid")

    encoded = trust.get("public_key_base64")
    if not isinstance(encoded, str):
        _fail("pinned runtime-component public key is missing")
    try:
        public = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        _fail(f"pinned runtime-component public key is not strict base64: {exc}")
    if len(public) != 32:
        _fail("pinned runtime-component public key must contain exactly 32 Ed25519 bytes")

    if trust_policy.get("status") in PENDING_STATUSES:
        _fail("pinned canonical component trust cannot retain a pending policy status")


def evaluate(root: Path, candidate_dir: Path) -> dict:
    root = root.resolve()
    candidate_dir = candidate_dir.resolve()

    candidate = candidate_verifier.verify(
        candidate_dir,
        root / PACKAGE_POLICY,
    )

    try:
        production = readiness.evaluate(root)
    except readiness.ReadinessError as exc:
        _fail(f"runtime-component production policy is invalid: {exc}")

    trust_policy = _load_json(root / TRUST_POLICY, "runtime-component trust policy")
    if trust_policy.get("$schema") != TRUST_POLICY_SCHEMA:
        _fail("runtime-component trust policy schema drifted")
    if trust_policy.get("trust_domain") != TRUST_DOMAIN:
        _fail("runtime-component trust domain drifted")
    if trust_policy.get("key_id") != KEY_ID:
        _fail("runtime-component trust key id drifted")

    anchor_pinned = production["anchor_pinned"]
    publication_allowed = production["publication_allowed"]

    _validate_public_anchor(root, trust_policy, anchor_pinned)

    blockers = []
    if not anchor_pinned:
        blockers.append(BLOCKER_ANCHOR)
    if not publication_allowed:
        blockers.append(BLOCKER_PUBLICATION)

    if publication_allowed and not anchor_pinned:
        _fail("component publication cannot be eligible before canonical trust")
    if publication_allowed and blockers:
        _fail("component publication is enabled with unresolved signing blockers")

    eligible = anchor_pinned and publication_allowed and not blockers

    return {
        "eligible": eligible,
        "blockers": blockers,
        "component_id": candidate["component_id"],
        "version": candidate["version"],
        "source_repository": candidate["source_repository"],
        "source_commit": candidate["source_commit"],
        "handoff_sha256": candidate["handoff_sha256"],
        "package_sha256": candidate["package_sha256"],
        "activation_allowed": production["activation_allowed"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=ROOT,
        help="OrdaX OS repository root containing trust/package policies.",
    )
    parser.add_argument("--candidate-dir", type=Path, required=True)
    args = parser.parse_args()

    try:
        result = evaluate(args.root, args.candidate_dir)
    except (SigningPreflightError, candidate_verifier.CandidateError) as exc:
        print(f"RUNTIME_COMPONENT_EXTERNAL_SIGNING_PREFLIGHT=FAIL\n{exc}")
        return 1

    print("RUNTIME_COMPONENT_EXTERNAL_SIGNING_PREFLIGHT=PASS")
    print(f"COMPONENT_ID={result['component_id']}")
    print(f"COMPONENT_VERSION={result['version']}")
    print(f"SOURCE_REPOSITORY={result['source_repository']}")
    print(f"SOURCE_COMMIT={result['source_commit']}")
    print(f"HANDOFF_SHA256={result['handoff_sha256']}")
    print(f"PACKAGE_SHA256={result['package_sha256']}")
    print("SIGNING_ELIGIBLE=" + ("YES" if result["eligible"] else "NO"))
    print(
        "PRODUCTION_ACTIVATION_ALLOWED="
        + ("YES" if result["activation_allowed"] else "NO")
    )
    for blocker in result["blockers"]:
        print(f"BLOCKER={blocker}")
    print("PRIVATE_KEY_READ=NO")
    print("SIGNING_PERFORMED=NO")
    print("PUBLICATION_PERFORMED=NO")
    print("INSTALLATION_PERFORMED=NO")
    print("ACTIVATION_PERFORMED=NO")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
