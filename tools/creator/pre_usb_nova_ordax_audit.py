#!/usr/bin/env python3
"""Evaluate the source-only Nova OrdaX pre-USB functional closure gates.

The audit is read-only and fail-closed. It proves that the structural product
requirements required by PLANO-03 are still represented by canonical contracts
and Native composition source. It never validates operator-owned signing proof,
selects a physical target, or grants physical-write authority.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import stat
from typing import Any

STATUS_SCHEMA = "prototype-ordax.pre-usb-nova-ordax-audit-status/1"
PLAN_PATH = "PLANO-03-FECHAMENTO-PRE-USB-NOVA-ORDAX.md"

GATE_NAMES = (
    "INTELLIGENCE_REAL_SYSTEM_CONSUMER",
    "LOCAL_SESSION_LOCK_POLICY",
    "LOCAL_SESSION_LOCK_IMPLEMENTATION",
    "OOBE_PERSISTENCE",
    "OOBE_LOCALE_COVERAGE",
    "FILES_DAILY_OPERATIONS",
    "FILES_SAFE_REMOVAL",
    "DIAGNOSTICS_RECOVERY_PRESENTATION",
    "SUPPORTED_HARDWARE_MATRIX",
    "STABLE_V4_LOCAL_AI_SOURCE_HANDOFF",
)

REQUIRED_SOURCE_PATHS = (
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
)


class AuditError(RuntimeError):
    pass


def _no_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise AuditError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _is_regular_file(path: Path) -> bool:
    try:
        metadata = path.lstat()
    except OSError:
        return False
    return stat.S_ISREG(metadata.st_mode) and not stat.S_ISLNK(metadata.st_mode)


def required_source_paths(repo_root: Path) -> list[Path]:
    root = repo_root.resolve()
    return [root / relative for relative in REQUIRED_SOURCE_PATHS]


def _load_json(root: Path, relative: str, errors: list[str]) -> dict[str, Any]:
    path = root / relative
    if not _is_regular_file(path):
        errors.append(f"source-unavailable:{relative}")
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_no_duplicates)
    except (OSError, UnicodeError, json.JSONDecodeError, AuditError):
        errors.append(f"source-invalid-json:{relative}")
        return {}
    if not isinstance(value, dict):
        errors.append(f"source-not-object:{relative}")
        return {}
    return value


def _load_text(root: Path, relative: str, errors: list[str]) -> str:
    path = root / relative
    if not _is_regular_file(path):
        errors.append(f"source-unavailable:{relative}")
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        errors.append(f"source-invalid-text:{relative}")
        return ""


def _contains_all(text: str, fragments: tuple[str, ...]) -> bool:
    return bool(text) and all(fragment in text for fragment in fragments)


def _paths_are_regular(root: Path, paths: list[str]) -> bool:
    return bool(paths) and all(_is_regular_file(root / path) for path in paths)


def evaluate(repo_root: Path) -> dict[str, Any]:
    root = repo_root.resolve()
    source_errors: list[str] = []

    # Every path named as canonical evidence must exist as a regular file. This
    # makes additions to REQUIRED_SOURCE_PATHS fail closed even before a gate
    # starts consuming the file's semantic fields.
    for relative in REQUIRED_SOURCE_PATHS:
        if not _is_regular_file(root / relative):
            source_errors.append(f"source-unavailable:{relative}")

    intelligence = _load_json(root, "docs/contracts/intelligence.json", source_errors)
    local_session = _load_json(root, "docs/contracts/local-session.json", source_errors)
    first_run = _load_json(root, "docs/contracts/first-run.json", source_errors)
    diagnostics = _load_json(root, "docs/contracts/diagnostics.json", source_errors)
    recovery = _load_json(root, "docs/contracts/recovery-status.json", source_errors)
    hardware = _load_json(root, "docs/contracts/hardware-support-matrix.json", source_errors)
    file_space = _load_text(root, "system/contracts/file-space.mjs", source_errors)
    native = _load_text(root, "system/composition/native/main.mjs", source_errors)

    gates: dict[str, dict[str, Any]] = {}
    blockers: list[str] = []

    def record(name: str, passed: bool, evidence: list[str]) -> None:
        gates[name] = {"passed": bool(passed), "evidence": evidence}
        if not passed:
            blockers.append(f"gate-failed:{name}")

    intel_mvp = _dict(intelligence.get("mvp"))
    intel_arch = _dict(intelligence.get("architecture"))
    intel_policy = _dict(intelligence.get("mvp_policy"))
    record(
        "INTELLIGENCE_REAL_SYSTEM_CONSUMER",
        all((
            intelligence.get("$schema") == "prototype-ordax.intelligence/1",
            intelligence.get("status") == "mvp-system-consultative-integration",
            intel_mvp.get("included_in_stable_mvp") is True,
            intel_mvp.get("required_for_boot") is False,
            intel_mvp.get("failure_mode") == "degrade-intelligence-without-blocking-os",
            intel_arch.get("production_native_composition") is True,
            set(intel_arch.get("first_party_consultative_consumers", [])) == {"system"},
            intel_arch.get("direct_provider_access_from_consumers") is False,
            intel_policy.get("first_party_consumer_source_proof") is True,
            intel_policy.get("external_app_consumers_use_public_port") is True,
            intel_policy.get("system_explanation_is_read_only") is True,
            _contains_all(native, (
                "const localAi = createLocalAiRuntime({",
                "const intelligence = createIntelligenceRuntime({ inferencePort: localAi });",
                "const systemOverviewControls = mountSystemOverviewControls(",
            )),
        )),
        ["docs/contracts/intelligence.json", "system/composition/native/main.mjs"],
    )

    local_policy = _dict(local_session.get("policy"))
    local_credential = _dict(local_session.get("credential"))
    record(
        "LOCAL_SESSION_LOCK_POLICY",
        all((
            local_session.get("$schema") == "prototype-ordax.local-session/1",
            local_session.get("status") == "native-mvp-source-implemented",
            local_session.get("capability_id") == "session.local-lock",
            local_policy.get("independent_from_cloud_account") is True,
            local_policy.get("independent_from_network") is True,
            local_policy.get("credential_optional_in_mvp") is True,
            local_policy.get("workspace_preserved_while_locked") is True,
            local_policy.get("surface_interaction_inert_while_locked") is True,
            local_policy.get("does_not_claim_usb_file_encryption") is True,
            local_credential.get("plaintext_persisted") is False,
            local_credential.get("first_run_state_persisted") is False,
            local_credential.get("telemetry_allowed") is False,
            local_credential.get("bad_or_unreadable_credential") == "fail-closed",
        )),
        ["docs/contracts/local-session.json"],
    )

    local_owners = _dict(local_session.get("owners"))
    local_owner_paths = [value for value in local_owners.values() if isinstance(value, str)]
    record(
        "LOCAL_SESSION_LOCK_IMPLEMENTATION",
        _paths_are_regular(root, local_owner_paths)
        and _contains_all(native, (
            "createNativeLocalSession",
            "mountFirstRunExperience",
            "mountLocalSessionLock",
            "localSession,",
        )),
        ["docs/contracts/local-session.json", *local_owner_paths, "system/composition/native/main.mjs"],
    )

    persistence = _dict(first_run.get("persistence"))
    account = _dict(first_run.get("account"))
    network = _dict(first_run.get("network"))
    first_run_mvp = _dict(first_run.get("mvp"))
    record(
        "OOBE_PERSISTENCE",
        all((
            first_run.get("$schema") == "prototype-ordax.first-run/1",
            first_run.get("status") == "native-foundation-implemented",
            first_run.get("scope") == "mvp-usb-first-use",
            first_run.get("flow") == ["welcome", "regional", "network", "security", "account", "privacy", "ready"],
            persistence.get("persistent_usb_state") is True,
            persistence.get("completion_must_be_durable_before_dismiss") is True,
            persistence.get("state_is_separate_from_identity_session") is True,
            persistence.get("state_is_separate_from_local_session_secret") is True,
            account.get("optional") is True,
            account.get("local_only_always_available") is True,
            account.get("provider_unavailable_must_not_block_completion") is True,
            network.get("skippable") is True,
            network.get("password_must_not_enter_first_run_state") is True,
            first_run_mvp.get("runs_from_usb") is True,
            first_run_mvp.get("permanent_internal_disk_install_exposed") is False,
            _contains_all(native, ("createNativeFirstRunStateStore", "mountFirstRunExperience")),
        )),
        ["docs/contracts/first-run.json", "system/composition/native/main.mjs"],
    )

    regional = _dict(first_run.get("regional"))
    translation_status = _dict(regional.get("surface_translation_status"))
    record(
        "OOBE_LOCALE_COVERAGE",
        all((
            regional.get("default_locale") == "pt-BR",
            set(regional.get("public_mvp_locales", [])) == {"pt-BR", "en-US"},
            set(regional.get("surface_complete_locales", [])) == {"pt-BR", "en-US"},
            set(regional.get("retained_compatible_locales", [])) == {"es-ES", "de-DE", "fr-FR"},
            regional.get("public_selector_must_only_offer_surface_ready_locales") is True,
            translation_status.get("pt-BR") == "source-language",
            translation_status.get("en-US") == "complete",
        )),
        ["docs/contracts/first-run.json"],
    )

    daily_methods = (
        "typeof port.list !== \"function\"",
        "typeof port.createDirectory !== \"function\"",
        "typeof port.readTextFile !== \"function\"",
        "typeof port.renameEntry !== \"function\"",
        "typeof port.copyFile !== \"function\"",
        "typeof port.moveEntry !== \"function\"",
        "typeof port.exportFile !== \"function\"",
        "typeof port.importFile !== \"function\"",
    )
    record(
        "FILES_DAILY_OPERATIONS",
        all((
            'FILE_SPACE_SCHEMA = "ordax.file-space/11"' in file_space,
            _contains_all(file_space, daily_methods),
            _is_regular_file(root / "system/adapters/native/file-space.mjs"),
            _contains_all(native, ("createNativeFileSpace", "mountFileSpaceControls")),
        )),
        ["system/contracts/file-space.mjs", "system/adapters/native/file-space.mjs", "system/composition/native/main.mjs"],
    )
    record(
        "FILES_SAFE_REMOVAL",
        'RESERVED_ENTRY_NAMES = new Set([".ordax-trash"])' in file_space
        and _contains_all(file_space, (
            "typeof port.trashEntry !== \"function\"",
            "typeof port.listTrash !== \"function\"",
            "typeof port.restoreTrashEntry !== \"function\"",
            "validateTrashEntry",
            "validateTrashListing",
        )),
        ["system/contracts/file-space.mjs", "system/adapters/native/file-space.mjs"],
    )

    diagnostics_authority = _dict(diagnostics.get("authority"))
    diagnostics_privacy = _dict(diagnostics.get("privacy"))
    recovery_authority = _dict(recovery.get("authority"))
    recovery_gates = _dict(recovery.get("gate_semantics"))
    recovery_paths = [
        value for value in (
            recovery.get("contract"),
            recovery.get("adapter"),
            recovery.get("native_owner"),
            recovery.get("presentation"),
        )
        if isinstance(value, str)
    ]
    record(
        "DIAGNOSTICS_RECOVERY_PRESENTATION",
        all((
            diagnostics.get("$schema") == "prototype-ordax.diagnostics/1",
            diagnostics_authority.get("local_diagnostics_available_offline") is True,
            diagnostics_authority.get("remote_telemetry_required_for_operation") is False,
            diagnostics_privacy.get("diagnostic_export_requires_redaction") is True,
            recovery.get("$schema") == "prototype-ordax.recovery-status/1",
            recovery.get("status") == "native-source-implemented",
            recovery.get("product_scope") == "stable-mvp-usb-only",
            recovery_authority.get("read_only") is True,
            recovery_authority.get("rollback") is False,
            recovery_authority.get("reboot") is False,
            recovery_authority.get("automatic_mutation") is False,
            recovery_gates.get("DIAGNOSTICS_RECOVERY_PRESENTATION") == "PASS_SOURCE",
            _paths_are_regular(root, recovery_paths),
            _is_regular_file(root / "system/composition/native/diagnostics.mjs"),
            _contains_all(native, (
                "createNativeDiagnosticReviewComposition",
                "diagnosticReviewController,",
                "createNativeRecoveryStatus",
                "recoveryStatus,",
            )),
        )),
        ["docs/contracts/diagnostics.json", "docs/contracts/recovery-status.json", "system/composition/native/diagnostics.mjs", *recovery_paths, "system/composition/native/main.mjs"],
    )

    support_policy = _dict(hardware.get("support_claim_policy"))
    hardware_gates = _dict(hardware.get("gate_semantics"))
    required_capabilities = hardware.get("required_mvp_capabilities")
    record(
        "SUPPORTED_HARDWARE_MATRIX",
        all((
            hardware.get("$schema") == "prototype-ordax.hardware-support-matrix/1",
            hardware.get("status") == "source-policy-defined",
            hardware.get("product_scope") == "stable-mvp-usb-only",
            hardware.get("architecture") == "x86_64",
            support_policy.get("driver_present_is_supported_hardware_claim") is False,
            support_policy.get("stable_mvp_support_requires_target_physical_proof") is True,
            support_policy.get("unsupported_or_unproven_features_must_remain_explicit") is True,
            isinstance(required_capabilities, list) and len(required_capabilities) >= 6,
            hardware_gates.get("SUPPORTED_HARDWARE_MATRIX") == "PASS_SOURCE",
            hardware_gates.get("CANONICAL_STABLE_TARGET_HARDWARE_PROOF") == "PENDING_PHYSICAL",
        )),
        ["docs/contracts/hardware-support-matrix.json"],
    )

    record(
        "STABLE_V4_LOCAL_AI_SOURCE_HANDOFF",
        all((
            intel_arch.get("stable_v4_backend_lifecycle")
            == "source-handoff-implemented-signed-stable-materialization-pending",
            intel_policy.get("stable_v4_backend_lifecycle_required_pre_usb") is True,
            intel_policy.get("stable_v4_boot_handoff_source_complete") is True,
            intel_policy.get("signed_stable_v4_materialization_pending") is True,
        )),
        ["docs/contracts/intelligence.json"],
    )

    blockers.extend(source_errors)
    blockers = sorted(set(blockers))
    source_ready = not blockers and set(gates) == set(GATE_NAMES)

    return {
        "$schema": STATUS_SCHEMA,
        "status": "pass-source" if source_ready else "blocked",
        "source_ready": source_ready,
        "plan_reference": PLAN_PATH,
        "product_scope": "stable-mvp-usb-only",
        "gates": gates,
        "blockers": blockers,
        "canonical_v4_release_proof_required_separately": True,
        "physical_target_selected": False,
        "physical_write_authorized": False,
        "physical_write_performed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    try:
        status = evaluate(args.repo_root)
    except Exception:
        status = {
            "$schema": STATUS_SCHEMA,
            "status": "blocked",
            "source_ready": False,
            "plan_reference": PLAN_PATH,
            "product_scope": "stable-mvp-usb-only",
            "gates": {},
            "blockers": ["audit-execution-failed"],
            "canonical_v4_release_proof_required_separately": True,
            "physical_target_selected": False,
            "physical_write_authorized": False,
            "physical_write_performed": False,
        }
    print(json.dumps(status, indent=2, sort_keys=True))
    return 0 if status["source_ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
