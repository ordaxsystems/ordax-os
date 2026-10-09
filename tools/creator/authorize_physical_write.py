#!/usr/bin/env python3
"""Prepare or record explicit owner authorization for the first Stable/MVP USB proof.

This tool mutates only docs/contracts/physical-write-authorization.json.
It never opens a physical device, never invokes the raw writer and never
materializes a writer candidate. Physical candidate creation remains owned by
the separate physical-promotion workflow after the authorized contract is
reviewed and committed.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
PROMOTION_PATH = Path(__file__).with_name("physical_promotion.py")
_spec = importlib.util.spec_from_file_location(
    "ordax_physical_promotion_authorization", PROMOTION_PATH
)
promotion = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(promotion)

AUTH_PATH = Path("docs/contracts/physical-write-authorization.json")
AUTH_SCHEMA = "prototype-ordax.physical-write-authorization/3"
RESULT_SCHEMA = "prototype-ordax.physical-owner-authorization/1"
EXPECTED_REPOSITORY = "ordaxsystems/ordax-os"
EXPECTED_SCOPE = "first-real-stable-mvp-usb-proof"
PRE_TRUST_STATUS = "blocked-canonical-trust-pending"
PRE_RELEASE_STATUS = "blocked-canonical-v4-release-proof-pending"
BLOCKED_STATUS = "blocked-explicit-physical-authorization-pending"
AUTHORIZED_STATUS = "authorized"
CONFIRMATION = "AUTHORIZE_FIRST_REAL_STABLE_MVP_USB_PROOF"


class AuthorizationError(RuntimeError):
    pass


def _authorization_path(repo_root: Path) -> Path:
    return repo_root.resolve() / AUTH_PATH


def _regular_bytes(path: Path) -> tuple[bytes, int]:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise AuthorizationError(f"authorization contract is unavailable: {path}") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise AuthorizationError("authorization contract must be a regular non-symlink file")
    try:
        return path.read_bytes(), stat.S_IMODE(metadata.st_mode)
    except OSError as exc:
        raise AuthorizationError("cannot read authorization contract") from exc


def _load_authorization(repo_root: Path) -> tuple[dict[str, Any], bytes, int]:
    path = _authorization_path(repo_root)
    original, mode = _regular_bytes(path)
    try:
        contract = json.loads(
            original.decode("utf-8"),
            object_pairs_hook=promotion._no_duplicates,
        )
    except (UnicodeError, json.JSONDecodeError, promotion.PromotionError) as exc:
        raise AuthorizationError(f"authorization contract is invalid: {exc}") from exc
    if not isinstance(contract, dict):
        raise AuthorizationError("authorization contract must be one JSON object")
    if contract.get("$schema") != AUTH_SCHEMA:
        raise AuthorizationError("authorization schema is incompatible")
    if contract.get("source_repository") != EXPECTED_REPOSITORY:
        raise AuthorizationError("authorization repository is incompatible")
    if contract.get("scope") != EXPECTED_SCOPE:
        raise AuthorizationError("authorization scope is incompatible")
    if contract.get("status") not in (PRE_TRUST_STATUS, PRE_RELEASE_STATUS, BLOCKED_STATUS):
        raise AuthorizationError(
            "authorization contract is not in a supported pre-consent state"
        )
    if contract.get("physical_write_allowed") is not False:
        raise AuthorizationError("authorization contract is already physically enabled")
    if contract.get("explicit_owner_authorization") is not False:
        raise AuthorizationError("owner authorization must be unset before this command")
    if contract.get("authorization_context_sha256") not in (None, ""):
        raise AuthorizationError(
            "authorization source context must be unset before explicit consent"
        )
    sequence = contract.get("release_sequence")
    if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence <= 0:
        raise AuthorizationError("release_sequence is invalid")
    return contract, original, mode


def prepare_authorization(repo_root: Path) -> dict[str, Any]:
    root = repo_root.resolve()
    contract, original, _mode = _load_authorization(root)
    status = promotion.evaluate(root)

    if status.get("pre_authorization_ready") is not True:
        raise AuthorizationError(
            "physical promotion prerequisites are not ready: "
            + ",".join(status.get("pre_authorization_blockers", []))
        )
    if contract.get("status") != BLOCKED_STATUS:
        raise AuthorizationError(
            "canonical trust promotion has not advanced the authorization "
            "contract to explicit-owner-consent stage"
        )
    if status.get("physical_authorization_bindings_resolved") is not True:
        raise AuthorizationError("physical authorization bindings are not resolved")
    if status.get("canonical_v4_release_proof_valid") is not True:
        raise AuthorizationError("canonical v4 release proof is not valid")
    if status.get("canonical_v4_release_binding_resolved") is not True:
        raise AuthorizationError("canonical v4 release binding is not resolved")
    context_sha = status.get("computed_authorization_context_sha256")
    if not isinstance(context_sha, str) or len(context_sha) != 64:
        raise AuthorizationError("physical authorization source context is unavailable")
    if status.get("owner_authorization_required") is not True:
        raise AuthorizationError("promotion state is not awaiting owner authorization")
    if status.get("authorized_candidate_materialization_allowed") is not False:
        raise AuthorizationError("authorized candidate is unexpectedly already allowed")
    if status.get("authorization_blockers") != [
        "explicit-physical-write-authorization-missing"
    ]:
        raise AuthorizationError("unexpected final authorization blockers")

    authorized = copy.deepcopy(contract)
    authorized["status"] = AUTHORIZED_STATUS
    authorized["physical_write_allowed"] = True
    authorized["explicit_owner_authorization"] = True
    authorized["authorization_context_sha256"] = context_sha
    payload = (
        json.dumps(authorized, indent=2, ensure_ascii=False) + "\n"
    ).encode("utf-8")

    return {
        "$schema": RESULT_SCHEMA,
        "status": "ready-for-explicit-owner-authorization",
        "ready": True,
        "scope": contract["scope"],
        "release_sequence": contract["release_sequence"],
        "source_contract_sha256": hashlib.sha256(original).hexdigest(),
        "authorized_contract_sha256": hashlib.sha256(payload).hexdigest(),
        "authorization_context_sha256": context_sha,
        "authorization_context_file_count": status.get(
            "authorization_context_file_count"
        ),
        "canonical_v4_release_proof_sha256": status.get(
            "canonical_v4_release_proof_sha256"
        ),
        "canonical_v4_release_source_commit": status.get(
            "canonical_v4_release_source_commit"
        ),
        "canonical_v4_release_envelope_url": status.get(
            "canonical_v4_release_envelope_url"
        ),
        "confirmation": CONFIRMATION,
        "physical_device_touched": False,
        "writer_invoked": False,
        "candidate_materialized": False,
        "_authorized_payload": payload,
    }


def _atomic_replace(
    path: Path,
    payload: bytes,
    mode: int,
    *,
    expected_sha256: str,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, mode)
        current, _ = _regular_bytes(path)
        if hashlib.sha256(current).hexdigest() != expected_sha256:
            raise AuthorizationError("authorization contract changed before atomic replace")
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def apply_authorization(
    repo_root: Path,
    *,
    confirm_scope: str,
    confirm_release_sequence: int,
    confirmation: str,
) -> dict[str, Any]:
    root = repo_root.resolve()
    plan = prepare_authorization(root)
    if confirm_scope != plan["scope"]:
        raise AuthorizationError("scope confirmation does not match")
    if confirm_release_sequence != plan["release_sequence"]:
        raise AuthorizationError("release-sequence confirmation does not match")
    if confirmation != CONFIRMATION:
        raise AuthorizationError("explicit authorization phrase does not match")

    path = _authorization_path(root)
    current, mode = _regular_bytes(path)
    current_sha = hashlib.sha256(current).hexdigest()
    if current_sha != plan["source_contract_sha256"]:
        raise AuthorizationError("authorization contract changed after preflight")

    original = current
    replaced = False
    try:
        _atomic_replace(
            path,
            plan["_authorized_payload"],
            mode,
            expected_sha256=plan["source_contract_sha256"],
        )
        replaced = True
        status = promotion.evaluate(root)
        if (
            status.get("ready") is not True
            or status.get("authorized_candidate_materialization_allowed") is not True
            or status.get("next_stage") != "authorized-candidate-materialization"
        ):
            raise AuthorizationError(
                "authorized contract did not close the promotion gate"
            )
    except Exception:
        if replaced:
            try:
                _atomic_replace(
                    path,
                    original,
                    mode,
                    expected_sha256=plan["authorized_contract_sha256"],
                )
            except AuthorizationError as rollback_exc:
                raise AuthorizationError(
                    "authorization failed and rollback could not prove current bytes"
                ) from rollback_exc
        raise

    return {
        "$schema": RESULT_SCHEMA,
        "status": "owner-authorization-recorded",
        "ready": True,
        "scope": plan["scope"],
        "release_sequence": plan["release_sequence"],
        "authorized_contract_sha256": plan["authorized_contract_sha256"],
        "authorization_context_sha256": plan["authorization_context_sha256"],
        "canonical_v4_release_proof_sha256": plan["canonical_v4_release_proof_sha256"],
        "canonical_v4_release_source_commit": plan["canonical_v4_release_source_commit"],
        "canonical_v4_release_envelope_url": plan["canonical_v4_release_envelope_url"],
        "physical_device_touched": False,
        "writer_invoked": False,
        "candidate_materialized": False,
    }


def _public_result(result: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in result.items() if not key.startswith("_")}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("check", "authorize"))
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=ROOT,
    )
    parser.add_argument("--confirm-scope", default="")
    parser.add_argument("--confirm-release-sequence", type=int)
    parser.add_argument("--authorize", default="")
    args = parser.parse_args()

    try:
        if args.mode == "check":
            result = prepare_authorization(args.repo_root)
        else:
            if args.confirm_release_sequence is None:
                parser.error("authorize requires --confirm-release-sequence")
            result = apply_authorization(
                args.repo_root,
                confirm_scope=args.confirm_scope,
                confirm_release_sequence=args.confirm_release_sequence,
                confirmation=args.authorize,
            )
        print(json.dumps(_public_result(result), indent=2, sort_keys=True))
        return 0
    except AuthorizationError as exc:
        print(
            json.dumps(
                {"$schema": RESULT_SCHEMA, "status": "blocked", "error": str(exc)},
                sort_keys=True,
            )
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
