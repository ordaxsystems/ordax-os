#!/usr/bin/env python3
"""Read-only MVP Surface smoke collector for the OrdaX Native runtime."""
from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import quote

SCHEMA = "ordax.mvp-surface-smoke/1"
COMPARE_SCHEMA = "ordax.mvp-surface-smoke-comparison/1"
PREFERENCE_REBOOT_SCHEMA = "ordax.mvp-surface-preference-reboot/1"
TOUR_SCHEMA = "ordax.mvp-surface-tour-checklist/1"
FINAL_SCHEMA = "ordax.mvp-surface-smoke-final/1"
SOURCE_ROOT = Path("/srv/ordax-system")
RUN_ROOT = Path("/run/ordax-surface")
EVIDENCE_ROOT = Path("/var/lib/ordax/mvp-smoke")
PROC_ROOT = Path("/proc")
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
MAX_BODY = 2 * 1024 * 1024
MAX_REPORT = 4 * 1024 * 1024
EVIDENCE_CONTEXTS = {
    ("owner-development", "dynamic-native-runtime"): "development",
    ("owner-development", "verified-erofs-overlay"): "development",
    ("stable-mvp", "verified-erofs-overlay"): "canonical-stable-mvp",
}
UPDATE_PHASES = frozenset({
    "idle",
    "checking",
    "fetching",
    "validating",
    "activating",
    "health-wait",
    "rollback",
    "blocked",
    "error",
})
BASE_UPDATE_PHASES = frozenset({
    "none",
    "waiting-candidate",
    "candidate-requested",
    "candidate-fetching",
    "candidate-ready",
    "staged",
    "activation-ready",
})

REQUIRED_SOURCE_FILES = (
    "apps/files/app.mjs",
    "apps/notes/app.mjs",
    "apps/internet/app.mjs",
    "apps/settings/app.mjs",
    "apps/system/app.mjs",
    "apps/account/app.mjs",
    "composition/native/main.mjs",
    "surface/ui/surface.mjs",
    "surface/ui/account-overview-controls.mjs",
    "surface/ui/memory-review-controls.mjs",
)

TOUR_ITEMS = (
    "surface",
    "files",
    "notes",
    "internet",
    "settings",
    "system",
    "network-power",
    "keyboard-layout",
    "account-memory",
    "failure-isolation",
    "continuity",
    "post-tour",
)


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _check(name: str, ok: bool, detail: str) -> dict:
    return {"id": name, "status": "pass" if ok else "fail", "detail": detail}


def _warn(name: str, detail: str) -> dict:
    return {"id": name, "status": "warn", "detail": detail}


def _summary(checks: list[dict]) -> dict:
    return {status: sum(item["status"] == status for item in checks) for status in ("pass", "warn", "fail")}


def _timestamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def evidence_context_from_environment() -> dict:
    distribution_profile = os.environ.get(
        "ORDAX_PROOF_PROFILE",
        "owner-development",
    )
    runtime_mode = os.environ.get(
        "ORDAX_PROOF_RUNTIME_MODE",
        "dynamic-native-runtime",
    )
    evidence_scope = os.environ.get(
        "ORDAX_PROOF_EVIDENCE_SCOPE",
        EVIDENCE_CONTEXTS.get((distribution_profile, runtime_mode), ""),
    )
    runtime_sha256 = os.environ.get("ORDAX_PROOF_RUNTIME_SHA256", "")
    expected_scope = EVIDENCE_CONTEXTS.get((distribution_profile, runtime_mode))
    if expected_scope is None or evidence_scope != expected_scope:
        raise ValueError("physical proof evidence context is invalid")

    if runtime_mode == "verified-erofs-overlay":
        if not (
            len(runtime_sha256) == 64
            and all(char in "0123456789abcdef" for char in runtime_sha256)
        ):
            raise ValueError("Stable/MVP proof runtime digest is invalid")
        normalized_digest = runtime_sha256
    else:
        if runtime_sha256:
            raise ValueError("development proof runtime must not claim a verified digest")
        normalized_digest = None

    return {
        "distribution_profile": distribution_profile,
        "runtime_mode": runtime_mode,
        "evidence_scope": evidence_scope,
        "runtime_sha256": normalized_digest,
    }


def _boot_id(proc_root: Path = PROC_ROOT) -> str | None:
    try:
        return (proc_root / "sys/kernel/random/boot_id").read_text(encoding="ascii").strip() or None
    except OSError:
        return None


def _bounded_json(body: bytes) -> object:
    if len(body) > MAX_BODY:
        raise ValueError(f"response exceeds {MAX_BODY} bytes")
    return json.loads(body.decode("utf-8"))


def _http_get(host: str, port: int, target: str, timeout: float) -> tuple[int, dict[str, str], bytes]:
    authority = f"{host}:{port}"
    connection = http.client.HTTPConnection(host, port, timeout=timeout)
    connection.putrequest("GET", target, skip_host=True, skip_accept_encoding=True)
    connection.putheader("Host", authority)
    connection.putheader("Accept", "application/json, text/html;q=0.9, */*;q=0.1")
    connection.endheaders()
    response = connection.getresponse()
    body = response.read(MAX_BODY + 1)
    headers = {name.lower(): value for name, value in response.getheaders()}
    status = response.status
    connection.close()
    if len(body) > MAX_BODY:
        raise ValueError(f"response exceeds {MAX_BODY} bytes")
    return status, headers, body


def source_snapshot(source_root: Path = SOURCE_ROOT) -> tuple[dict, list[dict]]:
    files = {}
    checks = []
    for relative in REQUIRED_SOURCE_FILES:
        path = source_root / relative
        try:
            data = path.read_bytes()
        except OSError as exc:
            checks.append(_check(f"source:{relative}", False, f"arquivo indisponível: {exc}"))
            continue
        files[relative] = {"size": len(data), "sha256": _sha(data)}
        checks.append(_check(f"source:{relative}", bool(data), f"{len(data)} bytes"))
    return {"files": files}, checks


def validate_metrics(value: object) -> dict:
    if not isinstance(value, dict):
        raise ValueError("metrics payload must be an object")
    fields = (
        "uptimeSeconds",
        "memoryTotalBytes",
        "memoryAvailableBytes",
        "userStorageTotalBytes",
        "userStorageFreeBytes",
    )
    for field in fields:
        item = value.get(field)
        if not isinstance(item, int) or isinstance(item, bool) or item < 0:
            raise ValueError(f"invalid metrics field: {field}")
    if value["memoryAvailableBytes"] > value["memoryTotalBytes"]:
        raise ValueError("available memory exceeds total")
    if value["userStorageFreeBytes"] > value["userStorageTotalBytes"]:
        raise ValueError("free user storage exceeds total")
    return {
        "uptime_seconds": value["uptimeSeconds"],
        "memory_total_bytes": value["memoryTotalBytes"],
        "memory_available_bytes": value["memoryAvailableBytes"],
        "user_storage_total_bytes": value["userStorageTotalBytes"],
        "user_storage_free_bytes": value["userStorageFreeBytes"],
    }


def validate_network(value: object) -> dict:
    if not isinstance(value, dict) or not isinstance(value.get("interfaces"), list):
        raise ValueError("network payload must contain interfaces")
    interfaces = value["interfaces"]
    if len(interfaces) > 64:
        raise ValueError("too many interfaces")
    kinds = {"wifi": 0, "ethernet": 0, "other": 0}
    states = {"connected": 0, "disconnected": 0, "unknown": 0}
    names = set()
    for item in interfaces:
        if not isinstance(item, dict):
            raise ValueError("invalid network interface")
        name = item.get("name")
        kind = item.get("kind")
        state = item.get("state")
        signal = item.get("signalDbm")
        if not isinstance(name, str) or not name or name in names:
            raise ValueError("invalid or duplicate interface name")
        if kind not in kinds or state not in states:
            raise ValueError("invalid interface kind/state")
        if signal is not None and (kind != "wifi" or not isinstance(signal, int) or isinstance(signal, bool) or signal < -200 or signal > 0):
            raise ValueError("invalid signal")
        names.add(name)
        kinds[kind] += 1
        states[state] += 1
    return {"interface_count": len(interfaces), "kinds": kinds, "states": states}


def validate_power(value: object) -> dict:
    if not isinstance(value, dict):
        raise ValueError("power payload must be an object")
    battery = value.get("battery")
    external = value.get("externalPower")
    if external is not None and not isinstance(external, bool):
        raise ValueError("invalid externalPower")
    if battery is None:
        return {"battery_present": False, "battery_percent": None, "battery_state": None, "external_power": external}
    if not isinstance(battery, dict):
        raise ValueError("invalid battery")
    percent = battery.get("percent")
    state = battery.get("state")
    if not isinstance(percent, int) or isinstance(percent, bool) or not 0 <= percent <= 100:
        raise ValueError("invalid battery percent")
    if state not in {"charging", "discharging", "full", "not-charging", "unknown"}:
        raise ValueError("invalid battery state")
    return {"battery_present": True, "battery_percent": percent, "battery_state": state, "external_power": external}


def validate_keyboard_layout(value: object) -> dict:
    if not isinstance(value, dict):
        raise ValueError("keyboard layout payload must be an object")
    configured = value.get("configuredLayoutId")
    applied = value.get("appliedLayoutId")
    supported = value.get("supportedLayoutIds")
    restart_required = value.get("restartRequired")
    allowed = {"br-abnt2", "us"}
    if configured not in allowed or applied not in allowed:
        raise ValueError("invalid keyboard layout id")
    if (
        not isinstance(supported, list)
        or len(supported) != len(set(supported))
        or set(supported) != allowed
    ):
        raise ValueError("invalid supported keyboard layouts")
    if not isinstance(restart_required, bool):
        raise ValueError("invalid keyboard restartRequired")
    expected_restart = configured != applied
    if restart_required != expected_restart:
        raise ValueError("keyboard restartRequired does not match configured/applied state")
    return {
        "configured_layout_id": configured,
        "applied_layout_id": applied,
        "restart_required": restart_required,
        "settled": not restart_required,
    }


def _valid_logical_path(path: object) -> bool:
    if not isinstance(path, str) or not path.startswith("/"):
        return False
    if path != "/" and path.endswith("/"):
        return False
    if path == "/":
        return True
    return all(part and part not in {".", ".."} and "\0" not in part for part in path.split("/")[1:])


def validate_files(value: object) -> dict:
    if not isinstance(value, dict) or not isinstance(value.get("entries"), list):
        raise ValueError("file listing must contain entries")
    if not _valid_logical_path(value.get("path")):
        raise ValueError("invalid file listing path")
    file_count = 0
    directory_count = 0
    for entry in value["entries"]:
        if not isinstance(entry, dict):
            raise ValueError("invalid file entry")
        name = entry.get("name")
        kind = entry.get("kind")
        size = entry.get("size")
        modified = entry.get("modifiedAt")
        if not isinstance(name, str) or not name or "/" in name or "\0" in name or name in {".", ".."}:
            raise ValueError("invalid file entry name")
        if kind not in {"file", "directory"}:
            raise ValueError("invalid file entry kind")
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            raise ValueError("invalid file entry size")
        if not isinstance(modified, int) or isinstance(modified, bool) or modified < 0:
            raise ValueError("invalid file modifiedAt")
        if kind == "file":
            file_count += 1
        else:
            directory_count += 1
    return {
        "path": value["path"],
        "entry_count": len(value["entries"]),
        "file_count": file_count,
        "directory_count": directory_count,
    }


def validate_update_history(value: object) -> dict:
    if not isinstance(value, dict):
        raise ValueError("update history payload must be an object")
    releases = value.get("releases")
    applications = value.get("applications")
    if not isinstance(releases, list) or len(releases) > 80:
        raise ValueError("invalid releases")
    if not isinstance(applications, list) or len(applications) > 200:
        raise ValueError("invalid applications")
    results = {"applied": 0, "rolled-back": 0}
    for item in applications:
        if not isinstance(item, dict) or item.get("result") not in results:
            raise ValueError("invalid update application")
        results[item["result"]] += 1
    return {
        "release_count": len(releases),
        "application_count": len(applications),
        "results": results,
    }


def validate_update_status(value: object) -> dict:
    if not isinstance(value, dict):
        raise ValueError("update status payload must be an object")

    source_sha = value.get("sourceSha")
    status = value.get("status")
    apply_mode = value.get("applyMode")
    if not isinstance(source_sha, str) or not source_sha:
        raise ValueError("update status requires sourceSha")
    if not isinstance(status, str) or not status:
        raise ValueError("update status requires status")
    if not isinstance(apply_mode, str) or not apply_mode:
        raise ValueError("update status requires applyMode")

    phase = value.get("phase", "idle")
    if phase not in UPDATE_PHASES:
        raise ValueError("invalid update phase")

    delivery_number = value.get("deliveryNumber", value.get("versionNumber", 0))
    if (
        not isinstance(delivery_number, int)
        or isinstance(delivery_number, bool)
        or not 0 <= delivery_number <= 1_000_000
    ):
        raise ValueError("invalid delivery number")

    boot_refresh_required = value.get("bootRefreshRequired") is True
    base_update_phase = value.get(
        "baseUpdatePhase",
        "waiting-candidate" if boot_refresh_required else "none",
    )
    if base_update_phase not in BASE_UPDATE_PHASES:
        raise ValueError("invalid Base update phase")

    optional_text_fields = (
        "runtimeSurfaceSha",
        "targetSha",
        "attemptId",
        "baseUpdateSha",
        "checkedAt",
        "lastAppliedSha",
        "lastAppliedAt",
        "rejectedSha",
        "lastError",
        "healthToken",
    )
    for field in optional_text_fields:
        item = value.get(field)
        if item not in (None, "") and not isinstance(item, str):
            raise ValueError(f"invalid update status text field: {field}")

    for field in ("lastApplyDurationSeconds", "lastStageDurationSeconds"):
        item = value.get(field, 0)
        if not isinstance(item, int) or isinstance(item, bool) or not 0 <= item <= 3600:
            raise ValueError(f"invalid update status duration: {field}")

    runtime_surface_sha = value.get("runtimeSurfaceSha") or source_sha
    return {
        "status": status,
        "phase": phase,
        "apply_mode": apply_mode,
        "delivery_number": delivery_number,
        "boot_refresh_required": boot_refresh_required,
        "base_update_phase": base_update_phase,
        "source_identity_sha256": _sha(source_sha.encode("utf-8")),
        "runtime_surface_matches_source": runtime_surface_sha == source_sha,
        "has_target": bool(value.get("targetSha")),
        "has_last_applied": bool(value.get("lastAppliedSha")),
        "has_rejected": bool(value.get("rejectedSha")),
        "has_last_error": bool(value.get("lastError")),
        "health_token_present": bool(value.get("healthToken")),
    }


def live_surface_checks(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT, timeout: float = 1.5) -> tuple[dict, list[dict]]:
    checks = []
    observed = {}

    try:
        status, headers, body = _http_get(host, port, "/composition/native/index.html", timeout)
        ok = status == 200 and bool(body)
        checks.append(_check("surface_document", ok, f"HTTP {status}; {len(body)} bytes"))
        observed["surface_document"] = {
            "status": status,
            "size": len(body),
            "sha256": _sha(body) if body else None,
            "content_type": headers.get("content-type"),
        }
    except (OSError, ValueError) as exc:
        checks.append(_check("surface_document", False, f"probe falhou: {exc}"))

    probes = (
        ("system_metrics", "/__ordax/native/metrics", validate_metrics),
        ("network_status", "/__ordax/native/network-status", validate_network),
        ("power_status", "/__ordax/native/power-status", validate_power),
        ("keyboard_layout", "/__ordax/native/keyboard-layout", validate_keyboard_layout),
        ("file_space_root", f"/__ordax/native/files?path={quote('/', safe='')}", validate_files),
        ("update_status", "/__ordax/native/update", validate_update_status),
        ("update_history", "/__ordax/native/update-history", validate_update_history),
    )
    for name, target, validator in probes:
        try:
            status, _headers, body = _http_get(host, port, target, timeout)
            if status != 200:
                checks.append(_check(name, False, f"HTTP {status}; esperado 200"))
                continue
            summary = validator(_bounded_json(body))
            observed[name] = summary
            healthy = not (
                name == "keyboard_layout"
                and summary.get("settled") is not True
            )
            checks.append(_check(
                name,
                healthy,
                "HTTP 200; payload válido e estado aplicado"
                if healthy
                else "layout configurado ainda não corresponde ao layout aplicado",
            ))
        except (OSError, ValueError, UnicodeError, json.JSONDecodeError) as exc:
            checks.append(_check(name, False, f"probe falhou: {exc}"))
    return observed, checks


def preference_theme_witness(expected_theme: str, host: str, port: int, timeout: float) -> tuple[dict, list[dict]]:
    """Read-only cosmetic witness. Never serialize the preference response."""
    if expected_theme not in ("light", "dark"):
        raise ValueError("only appearance.theme may be probed")
    witness = {"preference_id": "appearance.theme", "expected_theme": expected_theme, "matched": False}
    try:
        status, _headers, body = _http_get(host, port, "/__ordax/native/preferences", timeout)
        if status != 200:
            return witness, [_check("preference_theme_witness", False, f"HTTP {status}")]
        record = _bounded_json(body)
        if not isinstance(record, dict) or len(record) > 128:
            raise ValueError("invalid response shape")
        witness["matched"] = record.get("appearance.theme") == expected_theme
    except (OSError, ValueError, UnicodeError, json.JSONDecodeError) as exc:
        return witness, [_check("preference_theme_witness", False, f"read-only probe failed: {type(exc).__name__}")]
    return witness, [_check(
        "preference_theme_witness", witness["matched"],
        "cosmetic choice matches local host" if witness["matched"] else "cosmetic choice not recovered",
    )]


def host_log_snapshot(run_root: Path = RUN_ROOT) -> tuple[dict, list[dict]]:
    path = run_root / "host.log"
    try:
        data = path.read_bytes()[-64 * 1024 :]
    except OSError as exc:
        return {"present": False, "tail_sha256": None, "error_markers": None}, [
            _check("surface_host_log", False, f"host.log indisponível: {exc}")
        ]
    lower = data.lower()
    markers = sum(lower.count(marker) for marker in (b"traceback", b"segmentation fault", b"fatal"))
    return {
        "present": True,
        "tail_sha256": _sha(data),
        "error_markers": markers,
    }, [
        _check("surface_host_log", markers == 0, f"{markers} marcador(es) fatal/traceback no tail")
    ]


def collect(
    label: str,
    *,
    host: str = DEFAULT_HOST,
    port: int = DEFAULT_PORT,
    timeout: float = 1.5,
    source_root: Path = SOURCE_ROOT,
    run_root: Path = RUN_ROOT,
    proc_root: Path = PROC_ROOT,
    expected_theme: str | None = None,
) -> dict:
    source, source_checks = source_snapshot(source_root)
    observed, live_checks = live_surface_checks(host, port, timeout)
    host_log, log_checks = host_log_snapshot(run_root)
    checks = [*source_checks, *live_checks, *log_checks]
    if expected_theme is not None:
        witness, witness_checks = preference_theme_witness(expected_theme, host, port, timeout)
        observed["preference_theme_witness"] = witness
        checks.extend(witness_checks)
    report = {
        "schema": SCHEMA,
        "captured_at": _timestamp(),
        "label": label,
        "boot_id": _boot_id(proc_root),
        "loopback": {"host": host, "port": port},
        "evidence_context": evidence_context_from_environment(),
        "source": source,
        "observed": observed,
        "host_log": host_log,
        "checks": checks,
    }
    report["summary"] = _summary(checks)
    return report


def _valid_sha256(value: object) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(char in "0123456789abcdef" for char in value)


def _evidence_context(report: dict) -> tuple[str, str, str, str | None] | None:
    context = report.get("evidence_context")
    if not isinstance(context, dict):
        return None
    distribution_profile = context.get("distribution_profile")
    runtime_mode = context.get("runtime_mode")
    evidence_scope = context.get("evidence_scope")
    runtime_sha256 = context.get("runtime_sha256")
    expected_scope = EVIDENCE_CONTEXTS.get((distribution_profile, runtime_mode))
    if expected_scope is None or evidence_scope != expected_scope:
        return None
    if runtime_mode == "verified-erofs-overlay":
        if not _valid_sha256(runtime_sha256):
            return None
    elif runtime_sha256 is not None:
        return None
    return distribution_profile, runtime_mode, evidence_scope, runtime_sha256


def _source_identity(report: dict) -> dict[str, tuple[int, str]] | None:
    source = report.get("source")
    files = source.get("files") if isinstance(source, dict) else None
    if not isinstance(files, dict) or set(files) != set(REQUIRED_SOURCE_FILES):
        return None
    result = {}
    for path in REQUIRED_SOURCE_FILES:
        item = files.get(path)
        if not isinstance(item, dict):
            return None
        size = item.get("size")
        digest = item.get("sha256")
        if not isinstance(size, int) or isinstance(size, bool) or size < 0 or not _valid_sha256(digest):
            return None
        result[path] = (size, digest)
    return result


def _updater_identity(report: dict) -> tuple[str, bool] | None:
    observed = report.get("observed")
    update = observed.get("update_status") if isinstance(observed, dict) else None
    if not isinstance(update, dict):
        return None
    digest = update.get("source_identity_sha256")
    runtime_matches = update.get("runtime_surface_matches_source")
    if not _valid_sha256(digest) or not isinstance(runtime_matches, bool):
        return None
    return digest, runtime_matches


def _keyboard_identity(report: dict) -> tuple[str, str, bool] | None:
    observed = report.get("observed")
    keyboard = observed.get("keyboard_layout") if isinstance(observed, dict) else None
    if not isinstance(keyboard, dict):
        return None
    configured = keyboard.get("configured_layout_id")
    applied = keyboard.get("applied_layout_id")
    settled = keyboard.get("settled")
    if configured not in {"br-abnt2", "us"} or applied not in {"br-abnt2", "us"}:
        return None
    if not isinstance(settled, bool):
        return None
    return configured, applied, settled


def _report_has_no_failures(report: dict) -> bool:
    summary = report.get("summary")
    if not isinstance(summary, dict):
        return False
    fail = summary.get("fail")
    return isinstance(fail, int) and not isinstance(fail, bool) and fail == 0


def compare_reports(baseline: dict, after: dict, label: str = "mvp-surface-comparison") -> dict:
    checks = []
    schemas_ok = baseline.get("schema") == SCHEMA and after.get("schema") == SCHEMA
    checks.append(_check("report_schema", schemas_ok, "relatórios usam o schema esperado" if schemas_ok else "schema de relatório incompatível"))

    baseline_context = _evidence_context(baseline)
    after_context = _evidence_context(after)
    same_context = baseline_context is not None and baseline_context == after_context
    checks.append(_check(
        "same_evidence_context",
        same_context,
        "mesmo perfil/runtime de evidência"
        if same_context
        else "perfil/runtime de evidência ausente, inválido ou diferente",
    ))

    baseline_clean = _report_has_no_failures(baseline)
    after_clean = _report_has_no_failures(after)
    checks.append(_check("baseline_failures", baseline_clean, "baseline sem FAIL" if baseline_clean else "baseline contém FAIL ou summary inválido"))
    checks.append(_check("after_tour_failures", after_clean, "pós-tour sem FAIL" if after_clean else "pós-tour contém FAIL ou summary inválido"))

    baseline_boot = baseline.get("boot_id")
    after_boot = after.get("boot_id")
    same_boot = isinstance(baseline_boot, str) and bool(baseline_boot) and baseline_boot == after_boot
    checks.append(_check("same_boot", same_boot, "mesmo boot confirmado" if same_boot else "boot ausente ou diferente entre as coletas"))

    baseline_source = _source_identity(baseline)
    after_source = _source_identity(after)
    same_source = baseline_source is not None and baseline_source == after_source
    checks.append(_check("same_source", same_source, "mesmas fontes compartilhadas" if same_source else "fontes ausentes, inválidas ou diferentes"))

    baseline_updater = _updater_identity(baseline)
    after_updater = _updater_identity(after)
    updater_valid = baseline_updater is not None and after_updater is not None
    same_updater = updater_valid and baseline_updater[0] == after_updater[0]
    checks.append(_check("same_updater_source", same_updater, "mesma identidade de source do updater" if same_updater else "identidade do updater ausente ou diferente"))

    runtime_aligned = updater_valid and baseline_updater[1] and after_updater[1]
    checks.append(_check("runtime_surface_aligned", runtime_aligned, "Surface alinhada ao source nas duas coletas" if runtime_aligned else "Surface não está alinhada ao source em uma das coletas"))

    baseline_keyboard = _keyboard_identity(baseline)
    after_keyboard = _keyboard_identity(after)
    keyboard_stable = (
        baseline_keyboard is not None
        and after_keyboard is not None
        and baseline_keyboard == after_keyboard
        and baseline_keyboard[2]
    )
    checks.append(_check(
        "keyboard_layout_stable",
        keyboard_stable,
        "mesmo layout físico aplicado e estável nas duas coletas"
        if keyboard_stable
        else "layout físico ausente, pendente ou diferente entre as coletas",
    ))

    report = {
        "schema": COMPARE_SCHEMA,
        "captured_at": _timestamp(),
        "label": label,
        "baseline_label": baseline.get("label") if isinstance(baseline.get("label"), str) else "",
        "after_label": after.get("label") if isinstance(after.get("label"), str) else "",
        "evidence_context": (
            {
                "distribution_profile": baseline_context[0],
                "runtime_mode": baseline_context[1],
                "evidence_scope": baseline_context[2],
                "runtime_sha256": baseline_context[3],
            }
            if same_context else None
        ),
        "checks": checks,
    }
    report["summary"] = _summary(checks)
    return report


def compare_preference_reboots(baseline: dict, after: dict, label: str = "preference-reboot") -> dict:
    """Share tour checks but require different boots and the same cosmetic witness."""
    report = compare_reports(baseline, after, label)
    before_id, after_id = baseline.get("boot_id"), after.get("boot_id")
    different_boot = (
        isinstance(before_id, str) and bool(before_id)
        and isinstance(after_id, str) and bool(after_id) and before_id != after_id
    )
    report["checks"] = [
        _check("different_boot", different_boot, "different boot IDs confirmed" if different_boot else "boot IDs missing or identical")
        if check["id"] == "same_boot" else check for check in report["checks"]
    ]
    before = baseline.get("observed")
    after_observed = after.get("observed")
    b = before.get("preference_theme_witness") if isinstance(before, dict) else None
    a = after_observed.get("preference_theme_witness") if isinstance(after_observed, dict) else None
    shape = (
        isinstance(b, dict) and isinstance(a, dict)
        and b.get("preference_id") == "appearance.theme"
        and a.get("preference_id") == "appearance.theme"
        and b.get("expected_theme") in ("light", "dark")
        and a.get("expected_theme") in ("light", "dark")
        and type(b.get("matched")) is bool and type(a.get("matched")) is bool
    )
    same = shape and b["expected_theme"] == a["expected_theme"]
    matched = same and b["matched"] and a["matched"]
    report["checks"].extend((
        _check("preference_witness_shape", shape, "two valid cosmetic witnesses" if shape else "witness missing or malformed"),
        _check("same_expected_preference", same, "same selected theme" if same else "selected theme differs"),
        _check("preference_continuity", matched, "host returned selected theme on both boots" if matched else "theme did not persist"),
    ))
    report["schema"] = PREFERENCE_REBOOT_SCHEMA
    report["summary"] = _summary(report["checks"])
    return report


def tour_template(label: str = "mvp-surface-tour") -> dict:
    return {
        "schema": TOUR_SCHEMA,
        "label": label,
        "items": [{"id": item_id, "status": "pending"} for item_id in TOUR_ITEMS],
    }


def load_tour_checklist(path: Path) -> dict:
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise ValueError(f"tour checklist unavailable: {exc}") from exc
    if len(data) > MAX_REPORT:
        raise ValueError(f"tour checklist exceeds {MAX_REPORT} bytes")
    try:
        value = json.loads(data.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("tour checklist is not valid UTF-8 JSON") from exc
    if not isinstance(value, dict) or value.get("schema") != TOUR_SCHEMA:
        raise ValueError("tour checklist schema is incompatible")
    label = value.get("label")
    items = value.get("items")
    if not isinstance(label, str) or not label or not isinstance(items, list):
        raise ValueError("tour checklist requires label and items")
    if len(items) != len(TOUR_ITEMS):
        raise ValueError("tour checklist must contain every required item exactly once")
    seen = set()
    normalized = []
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("invalid tour checklist item")
        item_id = item.get("id")
        status = item.get("status")
        if item_id not in TOUR_ITEMS or item_id in seen:
            raise ValueError("invalid or duplicate tour checklist item id")
        if status not in {"pass", "fail"}:
            raise ValueError(f"tour checklist item {item_id} must be pass or fail")
        if set(item) != {"id", "status"}:
            raise ValueError("tour checklist items may contain only id and status")
        seen.add(item_id)
        normalized.append({"id": item_id, "status": status})
    if seen != set(TOUR_ITEMS):
        raise ValueError("tour checklist is missing required items")
    return {"schema": TOUR_SCHEMA, "label": label, "items": normalized}


def load_comparison(path: Path) -> dict:
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise ValueError(f"comparison unavailable: {exc}") from exc
    if len(data) > MAX_REPORT:
        raise ValueError(f"comparison exceeds {MAX_REPORT} bytes")
    try:
        value = json.loads(data.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("comparison is not valid UTF-8 JSON") from exc
    if not isinstance(value, dict) or value.get("schema") != COMPARE_SCHEMA:
        raise ValueError("comparison schema is incompatible")
    return value


def _comparison_semantics(report: dict) -> dict:
    return {
        key: report.get(key)
        for key in ("schema", "label", "baseline_label", "after_label", "evidence_context", "checks", "summary")
    }


def finalize_evidence(
    baseline: dict,
    after: dict,
    comparison: dict,
    checklist: dict,
    label: str = "mvp-surface-final",
) -> dict:
    checks = []
    expected_comparison = compare_reports(
        baseline,
        after,
        comparison.get("label") if isinstance(comparison.get("label"), str) else "mvp-surface-comparison",
    )
    comparison_exact = _comparison_semantics(comparison) == _comparison_semantics(expected_comparison)
    checks.append(_check(
        "comparison_recomputed_match",
        comparison_exact,
        "comparison matches recomputation" if comparison_exact else "comparison is stale, edited or inconsistent",
    ))

    automatic_clean = (
        _report_has_no_failures(baseline)
        and _report_has_no_failures(after)
        and isinstance(comparison.get("summary"), dict)
        and comparison["summary"].get("fail") == 0
        and comparison_exact
    )
    checks.append(_check(
        "automatic_evidence_clean",
        automatic_clean,
        "baseline, after-tour and comparison are clean" if automatic_clean else "automatic evidence contains a failure or mismatch",
    ))

    item_map = {
        item["id"]: item["status"]
        for item in checklist.get("items", [])
        if isinstance(item, dict) and item.get("id") in TOUR_ITEMS
    }
    tour_complete = set(item_map) == set(TOUR_ITEMS)
    checks.append(_check(
        "tour_checklist_complete",
        tour_complete,
        "all required tour items recorded" if tour_complete else "tour checklist is incomplete",
    ))
    for item_id in TOUR_ITEMS:
        status = item_map.get(item_id)
        checks.append(_check(
            f"tour:{item_id}",
            status == "pass",
            "PASS" if status == "pass" else "FAIL or missing",
        ))

    report = {
        "schema": FINAL_SCHEMA,
        "captured_at": _timestamp(),
        "label": label,
        "baseline_label": baseline.get("label") if isinstance(baseline.get("label"), str) else "",
        "after_label": after.get("label") if isinstance(after.get("label"), str) else "",
        "comparison_label": comparison.get("label") if isinstance(comparison.get("label"), str) else "",
        "tour_label": checklist.get("label") if isinstance(checklist.get("label"), str) else "",
        "evidence_context": expected_comparison.get("evidence_context"),
        "physical_write": False,
        "reboot_required": False,
        "checks": checks,
    }
    report["summary"] = _summary(checks)
    return report


def load_report(path: Path) -> dict:
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise ValueError(f"report unavailable: {exc}") from exc
    if len(data) > MAX_REPORT:
        raise ValueError(f"report exceeds {MAX_REPORT} bytes")
    try:
        value = json.loads(data.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("report is not valid UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise ValueError("report must be a JSON object")
    if value.get("schema") != SCHEMA:
        raise ValueError("report schema is incompatible")
    return value


def write_report(report: dict, output: Path | None, *, prefix: str = "mvp-smoke") -> Path:
    path = output or (EVIDENCE_ROOT / f"{prefix}-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}.json")
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    path.write_text(serialized, encoding="utf-8")
    return path


def _print_summary(report: dict, path: Path) -> None:
    summary = report["summary"]
    print(f"REPORT={path}")
    print(f"PASS={summary['pass']} WARN={summary['warn']} FAIL={summary['fail']}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        nargs="?",
        default="collect",
        choices=["collect", "compare", "reboot-compare", "tour-template", "finalize"],
    )
    parser.add_argument("--label", default="mvp-surface-smoke")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--timeout", type=float, default=1.5)
    parser.add_argument("--expected-theme", choices=("light", "dark"))
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--after", type=Path)
    parser.add_argument("--comparison", type=Path)
    parser.add_argument("--checklist", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)

    if args.command in ("compare", "reboot-compare"):
        if args.baseline is None or args.after is None:
            parser.error(f"{args.command} requires --baseline and --after")
        if args.comparison is not None or args.checklist is not None or args.expected_theme is not None:
            parser.error("invalid arguments for comparison")
        try:
            baseline = load_report(args.baseline)
            after = load_report(args.after)
        except ValueError as exc:
            parser.error(str(exc))
        report = compare_preference_reboots(baseline, after, args.label) if args.command == "reboot-compare" else compare_reports(baseline, after, args.label)
        path = write_report(report, args.output, prefix="mvp-preference-reboot" if args.command == "reboot-compare" else "mvp-smoke-comparison")
    elif args.command == "tour-template":
        if args.expected_theme is not None:
            parser.error("--expected-theme is only valid with collect")
        if any(value is not None for value in (args.baseline, args.after, args.comparison, args.checklist)):
            parser.error("tour-template does not accept evidence input paths")
        report = tour_template(args.label)
        path = write_report(report, args.output, prefix="mvp-smoke-tour")
        print(f"REPORT={path}")
        print("TOUR_TEMPLATE=CREATED")
        return 0
    elif args.command == "finalize":
        if args.expected_theme is not None:
            parser.error("--expected-theme is only valid with collect")
        if None in (args.baseline, args.after, args.comparison, args.checklist):
            parser.error("finalize requires --baseline, --after, --comparison and --checklist")
        try:
            baseline = load_report(args.baseline)
            after = load_report(args.after)
            comparison = load_comparison(args.comparison)
            checklist = load_tour_checklist(args.checklist)
        except ValueError as exc:
            parser.error(str(exc))
        report = finalize_evidence(baseline, after, comparison, checklist, args.label)
        path = write_report(report, args.output, prefix="mvp-smoke-final")
    else:
        if any(value is not None for value in (args.baseline, args.after, args.comparison, args.checklist)):
            parser.error("evidence input paths are only valid with compare/finalize")
        report = collect(
            args.label, host=args.host, port=args.port, timeout=args.timeout,
            expected_theme=args.expected_theme,
        )
        path = write_report(report, args.output)

    _print_summary(report, path)
    return 1 if report["summary"]["fail"] else 0


if __name__ == "__main__":
    sys.exit(main())