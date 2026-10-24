#!/usr/bin/env python3
"""Aggregate the operator-facing readiness for the first real OrdaX MVP USB.

This command is intentionally read-only. It separates the first physical USB proof
from the public Creator distribution boundary so an unconfigured Windows
Authenticode identity cannot be confused with a blocker in the already-authorized
physical writer path.

It never reads private-key contents, selects a device, records consent, signs,
publishes, invokes the writer, or performs a physical write.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import re
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
USB_READINESS_PATH = ROOT / "tools" / "creator" / "stable_mvp_usb_readiness.py"
CODE_SIGNING_PATH = ROOT / "docs" / "contracts" / "creator-code-signing.json"
CONSUMER_FLOW_PATH = ROOT / "docs" / "contracts" / "creator-consumer-flow.json"
PHYSICAL_PUBLISHER_PATH = ROOT / "tools" / "release-signing" / "windows" / "8-Sign-Publish-CreatorPhysical.ps1"
CREATOR_FINALIZER_PATH = ROOT / "tools" / "release-signing" / "windows" / "Finalize-OrdaXCreatorRelease.ps1"

STATUS_SCHEMA = "prototype-ordax.first-mvp-operator-readiness/1"
HEX64 = re.compile(r"^[0-9a-f]{64}$")


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError(f"{path} must contain one JSON object")
    return value


def _official_creator_signing_ready(contract: dict[str, Any]) -> tuple[bool, list[str]]:
    blockers: list[str] = []
    if contract.get("$schema") != "prototype-ordax.creator-code-signing/2":
        blockers.append("creator-code-signing-schema-invalid")
        return False, blockers

    if contract.get("status") != "configured":
        blockers.append("creator-authenticode-identity-unconfigured")

    identity = contract.get("publisher_identity")
    if not isinstance(identity, dict):
        blockers.append("creator-publisher-identity-invalid")
    else:
        subject = identity.get("expected_subject")
        if not isinstance(subject, str) or not subject.strip():
            blockers.append("creator-publisher-subject-unconfigured")
        pins = identity.get("allowed_leaf_certificate_sha256")
        if not isinstance(pins, list) or not pins or any(
            not isinstance(value, str) or HEX64.fullmatch(value) is None for value in pins
        ):
            blockers.append("creator-publisher-certificate-pin-unconfigured")

    custody = contract.get("custody")
    if not isinstance(custody, dict) or custody.get("provider") in (None, "", "unconfigured"):
        blockers.append("creator-code-signing-custody-provider-unconfigured")

    policy = contract.get("release_policy")
    if not isinstance(policy, dict) or policy.get("publish_allowed") is not True:
        blockers.append("creator-official-publication-not-authorized")

    return not blockers, blockers


def _consumer_contract_ready(contract: dict[str, Any]) -> bool:
    try:
        return all(
            (
                contract["$schema"] == "prototype-ordax.creator-consumer-flow/2",
                contract["publisher_boundary"]["physical_release_tag"] == "creator-physical",
                contract["publisher_boundary"]["physical_release_envelope"] == "creator-physical-envelope.json",
                contract["publisher_boundary"]["physical_release_purpose"] == "creator-portable-physical-windows-amd64",
                contract["publisher_boundary"]["physical_release_recipe"] == "creator/physical/portable-windows/2",
                contract["publisher_boundary"]["offline_canonical_signing_required_before_publication"] is True,
                contract["physical_candidate_integrity"]["whole_disk_raw_image_required"] is False,
                contract["physical_candidate_integrity"]["portable_artifact_count"] == 17,
                contract["physical_candidate_integrity"]["portable_application_operation_count"] == 39,
                contract["physical_write_gate"]["internal_disk_write_allowed_in_mvp"] is False,
                contract["native_installation"]["foundation_may_exist_in_source"] is True,
                contract["native_installation"]["public_mvp_visible"] is False,
                contract["native_installation"]["public_mvp_enabled"] is False,
                contract["native_installation"]["internal_disk_destructive_apply_enabled"] is False,
            )
        )
    except (KeyError, TypeError):
        return False


def evaluate(repo_root: Path = ROOT) -> dict[str, Any]:
    root = repo_root.resolve()
    usb_module = _load_module(
        "ordax_first_mvp_usb_readiness",
        root / USB_READINESS_PATH.relative_to(ROOT),
    )
    usb = usb_module.evaluate(root)
    code_signing = _load_json(root / CODE_SIGNING_PATH.relative_to(ROOT))
    consumer = _load_json(root / CONSUMER_FLOW_PATH.relative_to(ROOT))

    consumer_ready = _consumer_contract_ready(consumer)
    physical_publisher_present = (root / PHYSICAL_PUBLISHER_PATH.relative_to(ROOT)).is_file()
    creator_finalizer_present = (root / CREATOR_FINALIZER_PATH.relative_to(ROOT)).is_file()

    authorized_physical_source = (
        usb.get("status") == "ready"
        and usb.get("stage") == "authorized-candidate-ready-for-separate-physical-flow"
        and usb.get("owner_authorization_recorded") is True
        and usb.get("authorized_candidate_materialization_allowed") is True
    )

    physical_publication_source_ready = (
        authorized_physical_source and consumer_ready and physical_publisher_present
    )

    creator_signing_ready, creator_blockers = _official_creator_signing_ready(code_signing)
    official_creator_source_ready = consumer_ready and creator_finalizer_present
    official_creator_publication_ready = official_creator_source_ready and creator_signing_ready

    first_usb_blockers: list[str] = []
    if not authorized_physical_source:
        first_usb_blockers.extend(str(value) for value in usb.get("blockers", []))
        if not first_usb_blockers:
            first_usb_blockers.append("authorized-physical-source-not-ready")
    if not consumer_ready:
        first_usb_blockers.append("creator-consumer-portable-v2-contract-invalid")
    if not physical_publisher_present:
        first_usb_blockers.append("creator-physical-offline-publisher-missing")

    if first_usb_blockers:
        first_usb_next = "resolve-first-usb-source-blockers"
    else:
        first_usb_next = "offline-sign-and-publish-creator-physical"

    native = consumer.get("native_installation", {})
    return {
        "$schema": STATUS_SCHEMA,
        "status": "ready-for-operator-handoff" if physical_publication_source_ready else "blocked",
        "first_usb": {
            "source_authorized": authorized_physical_source,
            "publisher_source_ready": physical_publication_source_ready,
            "creator_physical_public_release_required": True,
            "offline_canonical_ed25519_signing_required": True,
            "physical_target_selected": False,
            "target_specific_destructive_confirmation_recorded": False,
            "physical_write_performed": False,
            "next_stage": first_usb_next,
            "blockers": sorted(set(first_usb_blockers)),
        },
        "official_creator": {
            "source_ready": official_creator_source_ready,
            "publication_ready": official_creator_publication_ready,
            "authenticode_required": True,
            "authenticode_configured": creator_signing_ready,
            "blockers": creator_blockers,
            "may_block_first_usb_proof": False,
        },
        "native_installation": {
            "foundation_present_policy": native.get("foundation_may_exist_in_source") is True,
            "mvp_visible": native.get("public_mvp_visible") is True,
            "mvp_enabled": native.get("public_mvp_enabled") is True,
            "internal_disk_destructive_apply_enabled": native.get("internal_disk_destructive_apply_enabled") is True,
            "policy": native.get("policy"),
        },
        "boundaries": {
            "private_key_read": False,
            "signature_created": False,
            "release_published": False,
            "physical_target_selected": False,
            "writer_invoked": False,
            "physical_write_performed": False,
            "internal_disk_write_performed": False,
        },
        "source": {
            "stable_mvp_usb_readiness": usb,
            "consumer_contract": str(CONSUMER_FLOW_PATH.relative_to(ROOT)),
            "code_signing_contract": str(CODE_SIGNING_PATH.relative_to(ROOT)),
            "physical_publisher": str(PHYSICAL_PUBLISHER_PATH.relative_to(ROOT)),
            "creator_finalizer": str(CREATOR_FINALIZER_PATH.relative_to(ROOT)),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=ROOT)
    parser.add_argument("--require-first-usb-handoff", action="store_true")
    args = parser.parse_args()

    try:
        status = evaluate(args.repo_root)
    except Exception as exc:
        status = {
            "$schema": STATUS_SCHEMA,
            "status": "blocked",
            "error": str(exc),
            "boundaries": {
                "private_key_read": False,
                "signature_created": False,
                "release_published": False,
                "physical_target_selected": False,
                "writer_invoked": False,
                "physical_write_performed": False,
                "internal_disk_write_performed": False,
            },
        }

    print(json.dumps(status, indent=2, sort_keys=True))
    if args.require_first_usb_handoff and status.get("status") != "ready-for-operator-handoff":
        return 2
    return 0 if "error" not in status else 1


if __name__ == "__main__":
    raise SystemExit(main())
