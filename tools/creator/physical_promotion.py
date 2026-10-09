#!/usr/bin/env python3
"""Evaluate the canonical gates required before a destructive Portable Creator payload may exist."""

from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import stat
from typing import Any
from urllib.parse import urlsplit

AUTH_SCHEMA = "prototype-ordax.physical-write-authorization/3"
MINIMAL_SCHEMA = "prototype-ordax.minimal-bootstrap/4"
TRUST_POLICY_SCHEMA = "prototype-ordax.release-trust-policy/1"
TRUST_SCHEMA = "prototype-ordax.release-trust/1"
PORTABLE_USB_SCHEMA = "prototype-ordax.portable-usb-v2/1"
CREATOR_PORTABLE_SCHEMA = "prototype-ordax.creator-portable-media-plan/1"
CANONICAL_V4_PROOF_SCHEMA = "prototype-ordax.portable-v4-canonical-release-proof/1"
CANONICAL_V4_PROOF_PATH = Path("docs/evidence/canonical-v4-release-proof.json")
PRE_USB_NOVA_ORDAX_AUDIT_PATH = Path("tools/creator/pre_usb_nova_ordax_audit.py")
KEY_ID = "ordax-prototype-release-v1"
REPOSITORY = "ordaxsystems/ordax-os"
HEX64 = re.compile(r"^[0-9a-f]{64}$")

FINAL_AUTHORIZATION_BLOCKERS = {
    "explicit-physical-write-authorization-missing",
    "physical-authorization-bindings-unresolved",
    "physical-authorization-context-mismatch",
}

AUTHORIZATION_CONTEXT_PATTERNS = (
    ".github/workflows/physical-write-promotion.yml",
    "tools/creator/physical_promotion.py",
    "tools/creator/pre_usb_nova_ordax_audit.py",
    "docs/contracts/intelligence.json",
    "docs/contracts/local-session.json",
    "docs/contracts/first-run.json",
    "docs/contracts/diagnostics.json",
    "docs/contracts/recovery-status.json",
    "docs/contracts/hardware-support-matrix.json",
    "system/contracts/file-space.mjs",
    "system/adapters/native/file-space.mjs",
    "system/contracts/local-session.mjs",
    "system/adapters/native/local-session.mjs",
    "system/contracts/recovery-status.mjs",
    "system/adapters/native/recovery-status.mjs",
    "system/composition/native/diagnostics.mjs",
    "system/composition/native/main.mjs",
    "system/surface/runtime/native_host_server.py",
    "system/surface/ui/first-run.mjs",
    "system/surface/ui/local-session-lock.mjs",
    "system/surface/ui/settings-overview-controls.mjs",
    "system/surface/ui/system-overview-controls.mjs",
    "tools/creator/authorize_physical_write.py",
    "tools/creator/bind_canonical_v4_release_proof.py",
    "tools/creator/go.*",
    "tools/creator/core/*.go",
    "tools/creator/host/windows/*.go",
    "tools/creator/physicalchannel/*.go",
    "tools/creator/cmd/ordax-creator-physical-test/*.go",
    "tools/release-signing/go.*",
    "tools/release-signing/cmd/ordax-physical-release-signing/*.go",
)

REQUIRED_AUTHORIZATION_REQUIREMENTS = {
    "pre_usb_nova_ordax_audit_passed",
    "canonical_public_trust_pinned",
    "canonical_v4_release_proof_bound",
    "minimal_bootstrap_all_artifacts_resolved",
    "minimal_bootstrap_remains_non_destructive",
    "portable_usb_contract_canonical",
    "creator_portable_media_policy_canonical",
    "disposable_portable_media_proof_required",
    "portable_physical_writer_implemented",
    "writer_binds_portable_media_plan_sha256",
    "writer_binds_generated_media_sha256_and_size",
    "writer_binds_public_trust_sha256",
    "writer_requires_exact_17_artifact_readback",
    "signed_release_sequence_must_never_decrease",
    "live_usb_reenumeration_required",
    "end_user_destructive_confirmation_required",
    "windows_uac_required",
    "post_write_readback_required",
}


class PromotionError(RuntimeError):
    pass


def _no_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise PromotionError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_no_duplicates)
    except (OSError, json.JSONDecodeError, UnicodeError, PromotionError) as exc:
        raise PromotionError(f"cannot load {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise PromotionError(f"{path} must contain one JSON object")
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def authorization_source_sha256(path: Path) -> str:
    try:
        payload = path.read_bytes()
    except OSError as exc:
        raise PromotionError(
            f"cannot read physical authorization context source: {path}"
        ) from exc
    # Git checkouts may present text as LF or CRLF depending on the Windows
    # client configuration. Consent is bound to logical source bytes, not
    # platform line-ending conversion.
    canonical = payload.replace(b"\r\n", b"\n")
    if b"\r" in canonical:
        raise PromotionError(
            f"physical authorization context source contains bare CR bytes: {path}"
        )
    return hashlib.sha256(canonical).hexdigest()


def authorization_context_files(repo_root: Path) -> list[Path]:
    root = repo_root.resolve()
    files: dict[str, Path] = {}
    for pattern in AUTHORIZATION_CONTEXT_PATTERNS:
        matches = sorted(root.glob(pattern))
        usable = []
        for path in matches:
            if path.name.endswith("_test.go"):
                continue
            try:
                metadata = path.lstat()
            except OSError as exc:
                raise PromotionError(
                    f"cannot inspect physical authorization context file: {path}"
                ) from exc
            if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
                raise PromotionError(
                    f"physical authorization context path is not a regular file: {path}"
                )
            usable.append(path)
        if not usable:
            raise PromotionError(
                f"physical authorization context pattern resolved no source files: {pattern}"
            )
        for path in usable:
            relative = path.relative_to(root).as_posix()
            files[relative] = path
    return [files[name] for name in sorted(files)]


def authorization_context_sha256(repo_root: Path) -> tuple[str, int]:
    root = repo_root.resolve()
    digest = hashlib.sha256()
    digest.update(b"ordax-physical-authorization-context/1\0")
    files = authorization_context_files(root)
    for path in files:
        relative = path.relative_to(root).as_posix().encode("utf-8")
        digest.update(relative)
        digest.update(b"\0")
        digest.update(bytes.fromhex(authorization_source_sha256(path)))
        digest.update(b"\0")
    return digest.hexdigest(), len(files)


def _add(blockers: list[str], condition: bool, label: str) -> None:
    if not condition:
        blockers.append(label)


def _pre_usb_nova_ordax_audit(repo_root: Path) -> dict[str, Any]:
    root = repo_root.resolve()
    path = root / PRE_USB_NOVA_ORDAX_AUDIT_PATH
    try:
        metadata = path.lstat()
    except OSError:
        return {
            "source_ready": False,
            "status": "blocked",
            "blockers": ["audit-source-unavailable"],
        }
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        return {
            "source_ready": False,
            "status": "blocked",
            "blockers": ["audit-source-not-regular-file"],
        }
    try:
        spec = importlib.util.spec_from_file_location("ordax_pre_usb_nova_ordax_audit", path)
        if spec is None or spec.loader is None:
            raise RuntimeError("audit module loader unavailable")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        evaluator = getattr(module, "evaluate", None)
        if not callable(evaluator):
            raise RuntimeError("audit evaluate() unavailable")
        status = evaluator(root)
    except Exception:
        return {
            "source_ready": False,
            "status": "blocked",
            "blockers": ["audit-execution-failed"],
        }
    if not isinstance(status, dict):
        return {
            "source_ready": False,
            "status": "blocked",
            "blockers": ["audit-status-invalid"],
        }
    return status


def _canonical_v4_release_proof(
    repo_root: Path,
    expected_trust_sha256: str | None,
) -> tuple[bool, dict[str, Any] | None, str | None]:
    path = repo_root.resolve() / CANONICAL_V4_PROOF_PATH
    try:
        metadata = path.lstat()
    except OSError:
        return False, None, None
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        return False, None, None
    try:
        proof = load_json(path)
    except PromotionError:
        return False, None, None

    source_commit = proof.get("source_commit")
    canonical_url = proof.get("canonical_envelope_url")
    trust_sha = proof.get("canonical_trust_sha256")
    manifest_sha = proof.get("release_manifest_sha256")
    envelope_sha = proof.get("release_envelope_sha256")
    signed_receipt_sha = proof.get("signed_handoff_receipt_sha256")
    material_receipt_sha = proof.get("canonical_materialization_receipt_sha256")
    artifacts = proof.get("artifacts")

    url_ok = False
    if isinstance(canonical_url, str):
        try:
            parsed = urlsplit(canonical_url)
            url_ok = all(
                [
                    parsed.scheme == "https",
                    bool(parsed.hostname),
                    parsed.username is None,
                    parsed.password is None,
                    parsed.query == "",
                    parsed.fragment == "",
                ]
            )
        except ValueError:
            url_ok = False

    artifact_names = {
        "system.erofs",
        "native-surface-runtime.erofs",
        "local-ai-runtime.erofs",
    }
    artifacts_ok = isinstance(artifacts, dict) and set(artifacts) == artifact_names
    if artifacts_ok:
        for name in sorted(artifact_names):
            entry = artifacts.get(name)
            size = entry.get("size") if isinstance(entry, dict) else None
            sha = entry.get("sha256") if isinstance(entry, dict) else None
            if (
                not isinstance(entry, dict)
                or HEX64.fullmatch(str(sha or "")) is None
                or isinstance(size, bool)
                or not isinstance(size, int)
                or size <= 0
            ):
                artifacts_ok = False
                break

    valid = all(
        [
            proof.get("schema") == CANONICAL_V4_PROOF_SCHEMA,
            isinstance(source_commit, str)
            and re.fullmatch(r"[0-9a-f]{40}", source_commit) is not None,
            url_ok,
            isinstance(expected_trust_sha256, str),
            trust_sha == expected_trust_sha256,
            HEX64.fullmatch(str(manifest_sha or "")) is not None,
            HEX64.fullmatch(str(envelope_sha or "")) is not None,
            HEX64.fullmatch(str(signed_receipt_sha or "")) is not None,
            HEX64.fullmatch(str(material_receipt_sha or "")) is not None,
            artifacts_ok,
            proof.get("signed_handoff_verified") is True,
            proof.get("canonical_materialization_verified") is True,
            proof.get("release_activated") is False,
            proof.get("physical_target_selected") is False,
            proof.get("physical_write_authorized") is False,
            proof.get("physical_write_performed") is False,
        ]
    )
    return (
        valid,
        proof if valid else None,
        sha256_file(path) if valid else None,
    )


def _portable_contract_ok(portable: dict[str, Any]) -> bool:
    partitions = portable.get("partitions")
    if not isinstance(partitions, list) or len(partitions) != 2:
        return False
    esp, data = partitions
    internal = portable.get("ordax_internal_layout")
    if not isinstance(internal, dict):
        return False
    state = internal.get("persistent_state_image")
    activation = internal.get("activation_state")
    return all(
        [
            portable.get("$schema") == PORTABLE_USB_SCHEMA,
            portable.get("product_scope") == "mvp-usb-durable-storage-target",
            portable.get("physical_write_authorized") is False,
            portable.get("physical_device_paths_allowed") is False,
            portable.get("logical_sector_bytes") == 512,
            portable.get("alignment_bytes") == 1048576,
            isinstance(esp, dict),
            esp.get("index") == 1,
            esp.get("name") == "ORDAX-ESP",
            esp.get("filesystem") == "fat32",
            esp.get("filesystem_label") == "ORDAX-ESP",
            esp.get("start_lba") == 2048,
            esp.get("size_bytes") == 536870912,
            isinstance(data, dict),
            data.get("index") == 2,
            data.get("name") == "ORDAX-DATA",
            data.get("filesystem") == "exfat",
            data.get("filesystem_label") == "ORDAX-DATA",
            data.get("size_policy") == "fill-all-remaining-usable-capacity",
            data.get("windows_visible") is True,
            data.get("direct_overlayfs_upper") is False,
            isinstance(state, dict),
            state.get("path") == ".ordax/state/persistent-state.img",
            state.get("filesystem") == "ext4",
            state.get("filesystem_label") == "ORDAX-STATE",
            state.get("mounted_through_loop_device_in_runtime") is True,
            state.get("overlayfs_upper_owner") is True,
            isinstance(activation, dict),
            activation.get("not_stored_directly_on_exfat") is True,
        ]
    )


def _creator_portable_contract_ok(contract: dict[str, Any]) -> bool:
    application = contract.get("application_planner")
    runtime = contract.get("surface_runtime_preseed")
    ai_runtime = contract.get("local_ai_runtime_preseed")
    writer = contract.get("physical_writer_v2")
    return all(
        [
            contract.get("$schema") == CREATOR_PORTABLE_SCHEMA,
            contract.get("product_scope") == "stable-mvp-usb-only",
            contract.get("artifact_count") == 17,
            contract.get("partitions") == ["ORDAX-ESP", "ORDAX-DATA"],
            contract.get("physical_write_authorized") is False,
            contract.get("physical_device_paths_allowed") is False,
            contract.get("disposable_materializer_implemented") is True,
            contract.get("disposable_materializer_physical_device_allowed") is False,
            contract.get("disposable_materializer_readback_verification") is True,
            isinstance(application, dict),
            application.get("implemented") is True,
            application.get("consumes_exact_media_plan") is True,
            application.get("canonical_media_plan_sha256_bound") is True,
            application.get("host_neutral") is True,
            application.get("physical_device_bound") is False,
            application.get("physical_write_authorized") is False,
            application.get("public_promotion_allowed") is False,
            application.get("whole_disk_raw_image_required") is False,
            application.get("ordered_phases")
            == [
                "write-exact-two-partition-gpt",
                "format-ORDAX-ESP-fat32",
                "format-ORDAX-DATA-exfat",
                "materialize-17-exact-artifacts",
                "flush-and-sync",
                "readback-sha256-and-size-for-17-artifacts",
                "verify-gpt-filesystems-labels-and-capacity",
            ],
            isinstance(runtime, dict),
            runtime.get("implemented") is True,
            runtime.get("image_artifact_id") == "surface-runtime-image",
            runtime.get("reference_artifact_id") == "surface-runtime-ref",
            runtime.get("content_addressed") is True,
            runtime.get("release_manifest_schema") == "prototype-ordax.release-manifest/4",
            runtime.get("physical_write_authorized") is False,
            isinstance(ai_runtime, dict),
            ai_runtime.get("implemented") is True,
            ai_runtime.get("image_artifact_id") == "local-ai-runtime-image",
            ai_runtime.get("reference_artifact_id") == "local-ai-runtime-ref",
            ai_runtime.get("image_target") == "/.ordax/ai-runtimes/sha256/<runtime-sha256>/local-ai-runtime.erofs",
            ai_runtime.get("reference_target") == "/.ordax/releases/<source_commit>/local-ai-runtime.sha256",
            ai_runtime.get("content_addressed") is True,
            ai_runtime.get("release_manifest_schema") == "prototype-ordax.release-manifest/4",
            ai_runtime.get("physical_write_authorized") is False,
            isinstance(writer, dict),
            writer.get("exact_operation_count") == 39,
            writer.get("exact_artifact_count") == 17,
            writer.get("readback_sha256_and_size_per_artifact") is True,
            writer.get("physical_write_authorized") is False,
        ]
    )


def evaluate(repo_root: Path) -> dict[str, Any]:
    root = repo_root.resolve()
    auth_path = root / "docs/contracts/physical-write-authorization.json"
    minimal_path = root / "docs/contracts/minimal-bootstrap.json"
    policy_path = root / "docs/contracts/release-trust-policy.json"
    portable_path = root / "docs/contracts/portable-usb-v2.json"
    creator_portable_path = root / "docs/contracts/creator-portable-media-plan.json"
    trust_path = root / "bootstrap/trust/release-ed25519.json"
    canonical_v4_proof_path = root / CANONICAL_V4_PROOF_PATH

    auth = load_json(auth_path)
    minimal = load_json(minimal_path)
    policy = load_json(policy_path)
    portable = load_json(portable_path)
    creator_portable = load_json(creator_portable_path)
    blockers: list[str] = []

    pre_usb_audit = _pre_usb_nova_ordax_audit(root)
    pre_usb_audit_passed = pre_usb_audit.get("source_ready") is True
    _add(
        blockers,
        pre_usb_audit_passed,
        "pre-usb-nova-ordax-audit-not-pass",
    )

    _add(blockers, auth.get("$schema") == AUTH_SCHEMA, "authorization-schema-invalid")
    _add(blockers, auth.get("source_repository") == REPOSITORY, "authorization-repository-mismatch")
    release_sequence = auth.get("release_sequence")
    sequence_ok = (
        isinstance(release_sequence, int)
        and not isinstance(release_sequence, bool)
        and 1 <= release_sequence <= (2**63 - 1)
    )
    _add(blockers, sequence_ok, "physical-release-sequence-invalid")
    _add(blockers, minimal.get("$schema") == MINIMAL_SCHEMA, "minimal-bootstrap-schema-invalid")
    _add(blockers, policy.get("$schema") == TRUST_POLICY_SCHEMA, "release-trust-policy-schema-invalid")
    _add(blockers, _portable_contract_ok(portable), "portable-usb-contract-invalid")
    _add(
        blockers,
        _creator_portable_contract_ok(creator_portable),
        "creator-portable-media-contract-invalid",
    )
    _add(
        blockers,
        creator_portable.get("physical_writer_v2_implemented") is True,
        "portable-physical-writer-not-implemented",
    )

    requirements = auth.get("requirements")
    requirements_ok = (
        isinstance(requirements, dict)
        and set(requirements) == REQUIRED_AUTHORIZATION_REQUIREMENTS
        and all(requirements.get(name) is True for name in REQUIRED_AUTHORIZATION_REQUIREMENTS)
    )
    _add(blockers, requirements_ok, "physical-authorization-requirements-invalid")

    consumer = policy.get("consumer_creator")
    consumer_ok = isinstance(consumer, dict) and all(
        [
            consumer.get("generates_publisher_private_keys") is False,
            consumer.get("stores_publisher_private_keys") is False,
            consumer.get("requests_private_key_backup_from_end_user") is False,
            consumer.get("runs_release_trust_ceremony") is False,
            consumer.get("signature_verification_is_automatic") is True,
        ]
    )
    _add(blockers, consumer_ok, "consumer-publisher-boundary-invalid")

    gates = policy.get("gates")
    expected_gate_names = {
        "key_material_generated",
        "public_anchor_pinned",
        "minimal_bootstrap_resolved",
        "physical_authorization_eligible",
    }
    gates_ok = (
        isinstance(gates, dict)
        and set(gates) == expected_gate_names
        and all(gates.get(name) is True for name in expected_gate_names)
    )
    _add(blockers, gates_ok, "release-trust-policy-gates-not-authorized")

    groups = minimal.get("artifact_groups")
    groups_ok = isinstance(groups, list) and len(groups) > 0 and all(
        isinstance(group, dict) and group.get("resolved") is True and bool(group.get("artifacts"))
        for group in groups
    )
    _add(blockers, minimal.get("all_artifacts_resolved") is True, "minimal-bootstrap-not-fully-resolved")
    _add(
        blockers,
        minimal.get("physical_write_allowed") is False,
        "minimal-bootstrap-must-remain-non-destructive",
    )
    _add(blockers, groups_ok, "minimal-bootstrap-has-unresolved-group")

    trust_sha: str | None = None
    trust_valid = False
    if trust_path.is_file() and not trust_path.is_symlink():
        try:
            trust = load_json(trust_path)
            encoded = trust.get("public_key_base64")
            decoded = base64.b64decode(encoded, validate=True) if isinstance(encoded, str) else b""
            trust_valid = (
                trust.get("$schema") == TRUST_SCHEMA
                and trust.get("key_id") == KEY_ID
                and len(decoded) == 32
            )
            if trust_valid:
                trust_sha = sha256_file(trust_path)
        except (PromotionError, ValueError):
            trust_valid = False
    _add(blockers, trust_valid, "canonical-public-trust-missing-or-invalid")

    if isinstance(groups, list) and trust_valid:
        trust_groups = [
            group
            for group in groups
            if isinstance(group, dict) and group.get("id") == "bootstrap-release-trust"
        ]
        trust_group_ok = False
        if len(trust_groups) == 1:
            artifacts = trust_groups[0].get("artifacts")
            if trust_groups[0].get("resolved") is True and isinstance(artifacts, list) and len(artifacts) == 1:
                artifact = artifacts[0]
                trust_group_ok = (
                    artifact.get("source_path") == "bootstrap/trust/release-ed25519.json"
                    and artifact.get("target_path") == "/ordax/bootstrap/trust/release-ed25519.json"
                    and artifact.get("sha256") == trust_sha
                )
        _add(blockers, trust_group_ok, "minimal-bootstrap-trust-binding-invalid")

    canonical_v4_proof_valid, canonical_v4_proof, canonical_v4_proof_sha = (
        _canonical_v4_release_proof(root, trust_sha)
    )
    _add(
        blockers,
        canonical_v4_proof_valid,
        "canonical-v4-release-proof-missing-or-invalid",
    )

    minimal_sha = sha256_file(minimal_path)
    portable_sha = sha256_file(portable_path)
    creator_portable_sha = sha256_file(creator_portable_path)
    authorization_context_sha, authorization_context_file_count = (
        authorization_context_sha256(root)
    )
    authorization_claimed = (
        auth.get("status") == "authorized"
        or auth.get("physical_write_allowed") is True
        or auth.get("explicit_owner_authorization") is True
    )
    authorization_context_value = auth.get("authorization_context_sha256")
    if authorization_claimed:
        _add(
            blockers,
            authorization_context_value == authorization_context_sha,
            "physical-authorization-context-mismatch",
        )
    else:
        _add(
            blockers,
            authorization_context_value in (None, ""),
            "physical-authorization-context-must-be-empty-before-consent",
        )
    authorization_enabled = (
        auth.get("status") == "authorized"
        and auth.get("physical_write_allowed") is True
        and auth.get("explicit_owner_authorization") is True
    )
    _add(blockers, authorization_enabled, "explicit-physical-write-authorization-missing")

    bindings = auth.get("bindings")
    bindings_resolved = False
    if isinstance(bindings, dict) and trust_sha is not None:
        expected_bindings = {
            "minimal_bootstrap_sha256": minimal_sha,
            "release_trust_sha256": trust_sha,
            "portable_usb_contract_sha256": portable_sha,
            "creator_portable_media_contract_sha256": creator_portable_sha,
            "canonical_v4_release_proof_sha256": canonical_v4_proof_sha,
        }
        bindings_resolved = (
            set(bindings) == set(expected_bindings)
            and all(
                HEX64.fullmatch(str(bindings.get(name, ""))) is not None
                and bindings.get(name) == value
                for name, value in expected_bindings.items()
            )
        )
    _add(
        blockers,
        bindings_resolved,
        "physical-authorization-bindings-unresolved",
    )

    release_binding = auth.get("release_binding")
    release_binding_resolved = False
    if isinstance(release_binding, dict) and canonical_v4_proof is not None:
        release_binding_resolved = (
            set(release_binding)
            == {
                "proof_path",
                "proof_schema",
                "source_commit",
                "canonical_envelope_url",
                "release_manifest_sha256",
                "release_envelope_sha256",
            }
            and release_binding.get("proof_path") == CANONICAL_V4_PROOF_PATH.as_posix()
            and release_binding.get("proof_schema") == CANONICAL_V4_PROOF_SCHEMA
            and release_binding.get("source_commit")
            == canonical_v4_proof.get("source_commit")
            and release_binding.get("canonical_envelope_url")
            == canonical_v4_proof.get("canonical_envelope_url")
            and release_binding.get("release_manifest_sha256")
            == canonical_v4_proof.get("release_manifest_sha256")
            and release_binding.get("release_envelope_sha256")
            == canonical_v4_proof.get("release_envelope_sha256")
        )
    _add(
        blockers,
        release_binding_resolved,
        "canonical-v4-release-binding-unresolved",
    )

    blockers = sorted(set(blockers))
    authorization_blockers = sorted(
        blocker for blocker in blockers if blocker in FINAL_AUTHORIZATION_BLOCKERS
    )
    pre_authorization_blockers = sorted(
        blocker for blocker in blockers if blocker not in FINAL_AUTHORIZATION_BLOCKERS
    )
    pre_authorization_ready = not pre_authorization_blockers
    ready = not blockers
    if ready:
        next_stage = "authorized-candidate-materialization"
    elif pre_authorization_ready:
        next_stage = "explicit-owner-authorization"
    else:
        next_stage = "resolve-pre-authorization-blockers"

    return {
        "$schema": "prototype-ordax.physical-promotion-status/2",
        "status": "ready" if ready else "blocked",
        "ready": ready,
        "pre_authorization_ready": pre_authorization_ready,
        "pre_authorization_blockers": pre_authorization_blockers,
        "authorization_blockers": authorization_blockers,
        "owner_authorization_required": pre_authorization_ready and not ready,
        "authorized_candidate_materialization_allowed": ready,
        "pre_usb_nova_ordax_audit_passed": pre_usb_audit_passed,
        "pre_usb_nova_ordax_audit_status": pre_usb_audit.get("status"),
        "pre_usb_nova_ordax_audit_blockers": pre_usb_audit.get("blockers", []),
        "physical_authorization_bindings_resolved": bindings_resolved,
        "canonical_v4_release_proof_valid": canonical_v4_proof_valid,
        "canonical_v4_release_proof_sha256": canonical_v4_proof_sha,
        "canonical_v4_release_binding_resolved": release_binding_resolved,
        "canonical_v4_release_source_commit": canonical_v4_proof.get("source_commit") if canonical_v4_proof else None,
        "canonical_v4_release_envelope_url": canonical_v4_proof.get("canonical_envelope_url") if canonical_v4_proof else None,
        "computed_authorization_context_sha256": authorization_context_sha,
        "authorization_context_file_count": authorization_context_file_count,
        "authorization_context_matches_current_source": (
            authorization_context_value == authorization_context_sha
        ),
        "next_stage": next_stage,
        "blockers": blockers,
        "computed_bindings": {
            "minimal_bootstrap_sha256": minimal_sha,
            "release_trust_sha256": trust_sha,
            "portable_usb_contract_sha256": portable_sha,
            "creator_portable_media_contract_sha256": creator_portable_sha,
            "canonical_v4_release_proof_sha256": canonical_v4_proof_sha,
        },
        "release_sequence": release_sequence if sequence_ok else None,
        "portable_layout_authority": "tools/creator/core/portable_media.go",
        "legacy_physical_media_contract_authoritative": False,
        "consumer_key_setup_required": False,
        "development_channel_can_authorize_write": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--require-ready", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        status = evaluate(args.repo_root)
    except PromotionError as exc:
        print(json.dumps({"status": "error", "error": str(exc)}, sort_keys=True))
        return 1
    payload = json.dumps(status, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(payload, encoding="utf-8")
    print(payload, end="")
    if args.require_ready and not status["ready"]:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
