#!/usr/bin/env python3
"""Serve the checked-out OrdaX system and a narrow loopback-only native control API."""

from __future__ import annotations

import argparse
import ctypes
import errno
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import stat
import sys
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlsplit
from urllib.request import Request, urlopen

_RUNTIME_DIR = os.path.dirname(os.path.abspath(__file__))
if _RUNTIME_DIR not in sys.path:
    sys.path.insert(0, _RUNTIME_DIR)

from native_request_boundary import expected_surface_authority, request_is_trusted
from native_account_gateway import NativeAccountGateway, NativeAccountGatewayError
from native_component_slots import (
    COMPONENT_MODULE_PREFIX,
    ComponentSlotRequestError,
    ComponentSlotUnavailableError,
    ComponentSlotVerificationError,
    component_slot_reader_available,
    parse_component_module_path,
    read_component_runtime_file,
    resolve_component_slot,
)
from native_memory_endpoint import (
    MAX_MEMORY_REQUEST_BODY_BYTES,
    MemoryEndpointRequestError,
    read_memory_endpoint,
    write_memory_endpoint,
)
from native_memory_entitlement_proxy import (
    NativeMemoryEntitlementProxyError,
    read_native_memory_cloud_entitlement,
)
from native_hardware_inventory import read_hardware_inventory
from native_profile_component_inventory import read_profile_component_inventory
from native_profile_activation_state import read_profile_activation_state
from native_profile_activation_command import execute_profile_activation_command
from native_profile_content_context import read_active_profile_content_context
from native_profile_human_consent import ProfileHumanConsentAuthority
from native_profile_consent_presenter import ProfileHumanConsentCoordinator
from native_profile_consent_ipc import request_native_decision
from native_store_catalog import StoreCatalogError, read_native_store_catalog_snapshot
from native_store_catalog_acquisition import (
    StoreCatalogAcquisitionError,
    acquire_and_promote_store_catalog,
    normalize_catalog_base_origin,
)
from native_app_artifact_store import DEFAULT_ARTIFACT_ROOT
from native_app_artifact_acquisition import (
    AppArtifactAcquisitionError,
    acquire_lifecycle_plan_artifacts,
    normalize_https_base_origin,
)
from native_app_lifecycle_executor import (
    NativeAppLifecycleError,
    execute_offline_lifecycle_plan,
    validate_lifecycle_plan,
)

SESSION_PATH = "/__ordax/native/session"
POWER_PATH = "/__ordax/native/power"
UPDATE_PATH = "/__ordax/native/update"
HEALTH_PATH = "/__ordax/native/health"
SURFACE_HEARTBEAT_PATH = "/__ordax/native/surface-heartbeat"
CLIENT_DIAGNOSTIC_PATH = "/__ordax/native/client-diagnostic"
PREFERENCES_PATH = "/__ordax/native/preferences"
KEYBOARD_LAYOUT_PATH = "/__ordax/native/keyboard-layout"
FIRST_RUN_PATH = "/__ordax/native/first-run"
DEVICE_PROFILE_PATH = "/__ordax/native/device-profile"
LOCAL_SESSION_PATH = "/__ordax/native/local-session"
MEMORY_PATH = "/__ordax/native/intelligence-memory"
COMPONENT_STATE_PATH = "/__ordax/native/component-state"
PROFILE_COMPONENT_INVENTORY_PATH = "/__ordax/native/profile-component-inventory"
PROFILE_ACTIVATION_STATE_PATH = "/__ordax/native/profile-activation-state"
PROFILE_CONTENT_CONTEXT_PATH = "/__ordax/native/profile-content-context"
PROFILE_CONTENT_CONTEXT_CAPABILITY_PATH = "/__ordax/native/profile-content-context-capability"
PROFILE_ACTIVATION_COMMAND_PATH = "/__ordax/native/profile-activation-command"
SYNC_STATE_PATH = "/__ordax/native/sync-state"
SYNC_CHECKPOINT_PATH = "/__ordax/native/sync-checkpoint"
ACCOUNT_SESSION_PATH = "/auth/session"
ACCOUNT_REGISTRATION_POLICY_PATH = "/auth/registration-policy"
ACCOUNT_LOGIN_PATH = "/auth/login"
ACCOUNT_REGISTER_PATH = "/auth/register"
ACCOUNT_REGISTRATION_ENABLED = False
ACCOUNT_LOGOUT_PATH = "/auth/logout"
ACCOUNT_CLOSE_PATH = "/account/close"
ACCOUNT_EXPORT_PATH = "/account/export"
ACCOUNT_SPACES_PATH = "/account/spaces"
ACCOUNT_MEMORY_ENTITLEMENT_PATH = "/account/entitlements/memory-cloud"
ACCOUNT_SYNC_OBJECTS_PATH = "/sync/objects"
ACCOUNT_SYNC_SNAPSHOT_PATH = "/sync/snapshot"
ACCOUNT_SYNC_CHANGES_PATH = "/sync/changes"
ACCOUNT_SYNC_MUTATE_PATH = "/sync/mutate"
NETWORK_MESSAGE_SEND_PATH = "/network/v2/messages/send"
DIAGNOSTIC_JOURNAL_PATH = "/__ordax/native/diagnostic-journal"
FILES_PATH = "/__ordax/native/files"
TRASH_PATH = "/__ordax/native/trash"
FILE_CONTENT_PATH = "/__ordax/native/file-content"
FILE_EXPORT_PATH = "/__ordax/native/file-export"
IMAGE_PREVIEW_PATH = "/__ordax/native/image-preview"
MEDIA_PREVIEW_PATH = "/__ordax/native/media-preview"
DOCUMENT_PREVIEW_PATH = "/__ordax/native/document-preview"
FILE_IMPORT_PATH = "/__ordax/native/file-import"
METRICS_PATH = "/__ordax/native/metrics"
RECOVERY_STATUS_PATH = "/__ordax/native/recovery-status"
POWER_STATUS_PATH = "/__ordax/native/power-status"
HARDWARE_INVENTORY_PATH = "/__ordax/native/hardware-inventory"
NETWORK_STATUS_PATH = "/__ordax/native/network-status"
NETWORK_MANAGEMENT_PATH = "/__ordax/native/network-management"
UPDATE_HISTORY_PATH = "/__ordax/native/update-history"
NATIVE_INSTALL_TARGETS_PATH = "/__ordax/native/native-install-targets"
COMPONENT_RUNTIME_PATH = "/__ordax/native/component-runtime"
STORE_CATALOG_PATH = "/__ordax/native/store-catalog"
STORE_LIFECYCLE_PATH = "/__ordax/native/store-lifecycle"
DEFAULT_COMPONENT_CHANNEL_BIN = "/srv/ordax-system/bin/ordax-runtime-component-channel"
DEFAULT_COMPONENT_TRUST_PATH = "/srv/ordax-system/trust/runtime-components-ed25519.json"
DEFAULT_COMPONENT_SLOT_ROOT = "/var/lib/ordax/components"
DEFAULT_STORE_CATALOG_ENVELOPE_PATH = "/var/lib/ordax/store/catalog-envelope.json"
DEFAULT_STORE_CATALOG_WATERMARK_PATH = "/var/lib/ordax/store/catalog-watermark.json"
DEFAULT_STORE_ARTIFACT_ROOT = DEFAULT_ARTIFACT_ROOT
UPDATE_STATE_FILE = "/run/ordax-update/state.json"
HEALTH_STATE_FILE = "/run/ordax-update/healthy-sha"
PREFERENCES_FILE = "/var/lib/ordax/preferences.json"
KEYBOARD_LAYOUT_FILE = "/var/lib/ordax/keyboard-layout"
FIRST_RUN_FILE = "/var/lib/ordax/first-run.json"
DEVICE_PROFILE_FILE = "/var/lib/ordax/device-profile.json"
LOCAL_SESSION_CREDENTIAL_FILE = "/var/lib/ordax/local-session-credential.json"
COMPONENT_STATE_FILE = "/var/lib/ordax/component-state.json"
SYNC_STATE_FILE = "/var/lib/ordax/sync-state.json"
SYNC_CHECKPOINT_FILE = "/var/lib/ordax/sync-checkpoint.json"
ACCOUNT_SESSION_FILE = "/var/lib/ordax/account/session.json"
DIAGNOSTIC_JOURNAL_FILE = "/var/lib/ordax/diagnostic-journal.json"
UPDATE_HISTORY_FILE = "/var/lib/ordax/update-history.tsv"
RELEASE_HISTORY_FILE = "/var/lib/ordax/release-history.tsv"
SURFACE_HEARTBEAT_FILE = "/run/ordax-update/surface-heartbeat.json"
CLIENT_DIAGNOSTIC_FILE = "/var/lib/ordax/client-diagnostic.json"
TELEMETRY_DEVICE_ID_FILE = "/var/lib/ordax/telemetry-device-id"
RESCUE_STATUS_FILE = "/var/lib/ordax/rescue-status.json"
BOOT_ID_FILE = "/run/ordax-update/base-boot-id"
TOKEN_HEADER = "X-OrdaX-Power-Token"
NETWORK_TOKEN_HEADER = "X-OrdaX-Network-Token"
NATIVE_INSTALL_TOKEN_HEADER = "X-OrdaX-Native-Install-Token"
PROFILE_ACTIVATION_TOKEN_HEADER = "X-OrdaX-Profile-Activation-Token"
DIAGNOSTIC_TOKEN_HEADER = "X-OrdaX-Diagnostic-Token"
HEALTH_TOKEN_HEADER = "X-OrdaX-Health-Token"
MAX_CONTROL_BODY = 512
MAX_STORE_LIFECYCLE_BODY = 16 * 1024
MAX_NETWORK_ACTION_BODY = 1024
MAX_NETWORK_SCAN_BYTES = 512 * 1024
MAX_NETWORKS = 32
MAX_NATIVE_INSTALL_SNAPSHOT_BYTES = 256 * 1024
MAX_NATIVE_INSTALL_TARGETS = 64
MAX_PROFILE_ACTIVATION_COMMAND_BODY = 64 * 1024
MAX_SURFACE_HEARTBEAT_BODY = 512
MAX_CLIENT_DIAGNOSTIC_BODY = 512
MAX_PREFERENCE_BODY = 8192
MAX_KEYBOARD_LAYOUT_BODY = 128
MAX_FIRST_RUN_BODY = 2048
MAX_DEVICE_PROFILE_BODY = 1024
MAX_LOCAL_SESSION_BODY = 1024
LOCAL_SESSION_SECRET_MIN_CHARS = 6
LOCAL_SESSION_SECRET_MAX_CHARS = 128
LOCAL_SESSION_SCRYPT_N = 1 << 15
LOCAL_SESSION_SCRYPT_R = 8
LOCAL_SESSION_SCRYPT_P = 1
LOCAL_SESSION_SCRYPT_DKLEN = 32
LOCAL_SESSION_SCRYPT_MAXMEM = 64 * 1024 * 1024
MAX_COMPONENT_STATE_PAYLOAD = 256 * 1024
MAX_COMPONENT_STATE_BODY = 6 * MAX_COMPONENT_STATE_PAYLOAD + 1024
MAX_SYNC_STATE_PAYLOAD = 65536
MAX_SYNC_STATE_BODY = 393216
MAX_SYNC_CHECKPOINT_BODY = 8192
MAX_ACCOUNT_CREDENTIAL_BODY = 4096
MAX_ACCOUNT_SYNC_BODY = 65536
MAX_NETWORK_MESSAGE_BODY = 24 * 1024
MAX_DIAGNOSTIC_JOURNAL_PAYLOAD = 4 * 1024 * 1024
MAX_DIAGNOSTIC_JOURNAL_BODY = 6 * MAX_DIAGNOSTIC_JOURNAL_PAYLOAD + 1024
MAX_FILE_ACTION_BODY = 2048
MAX_FILE_ENTRIES = 1000
MAX_TRASH_INFO_BYTES = 4096
TRASH_ROOT_NAME = ".ordax-trash"
TRASH_FILES_NAME = "files"
TRASH_INFO_NAME = "info"
TRASH_ID_RE = re.compile(r"^[0-9a-f]{32}$")
MAX_TEXT_FILE_BYTES = 256 * 1024
MAX_FILE_COPY_BYTES = 64 * 1024 * 1024
MAX_FILE_EXPORT_BYTES = 64 * 1024 * 1024
MAX_IMAGE_PREVIEW_BYTES = 8 * 1024 * 1024
MAX_MEDIA_PREVIEW_BYTES = 64 * 1024 * 1024
MAX_DOCUMENT_PREVIEW_BYTES = 32 * 1024 * 1024
MAX_FILE_IMPORT_BYTES = 64 * 1024 * 1024
IMAGE_PREVIEW_TYPES = {
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}
DOCUMENT_PREVIEW_TYPES = {".pdf": "application/pdf"}
MEDIA_PREVIEW_TYPES = {
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".oga": "audio/ogg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".m4v": "video/mp4",
    ".mp4": "video/mp4",
    ".ogv": "video/ogg",
    ".webm": "video/webm",
}
MAX_UPDATE_HISTORY_BYTES = 256 * 1024
MAX_RELEASE_HISTORY_ENTRIES = 80
MAX_APPLICATION_HISTORY_ENTRIES = 200
STANDARD_USER_DIRECTORIES = ("Documentos", "Imagens", "Downloads")
PREFERENCE_ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$")
FIRST_RUN_TIME_ZONES = frozenset((
    "America/Bahia",
    "America/Sao_Paulo",
    "America/Manaus",
    "America/Rio_Branco",
    "America/Noronha",
))
FIRST_RUN_ACCOUNT_MODES = frozenset(("local-only", "identity"))
FIRST_RUN_LOCALES = frozenset(("pt-BR", "en-US", "es-ES", "de-DE", "fr-FR"))
KEYBOARD_LAYOUT_IDS = ("br-abnt2", "us")
KEYBOARD_LAYOUT_ID_SET = frozenset(KEYBOARD_LAYOUT_IDS)
DEFAULT_KEYBOARD_LAYOUT_ID = "br-abnt2"
NETWORK_INTERFACE_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,32}$")
CLIENT_DIAGNOSTIC_STAGE_RE = re.compile(r"^[a-z][a-z0-9.-]{0,63}$")
CLIENT_DIAGNOSTIC_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]{0,63}$")
CLIENT_DIAGNOSTIC_SOURCE_RE = re.compile(r"^[A-Za-z0-9_.-]+\.mjs:[1-9][0-9]{0,5}:[1-9][0-9]{0,5}$")
POWER_ACTIONS = ("restart", "shutdown")
DEFAULT_POWER_REQUEST_PATH = "/run/ordax-surface/power-request"
DEFAULT_NETWORK_SESSION_DIR = "/run/ordax-surface"
SURFACE_HOST_RECOVERY_GENERATION = 1
RENAME_NOREPLACE = 1


def read_small_text(path: str, max_chars: int = 4096) -> str:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read(max_chars).strip()
    except (OSError, UnicodeError):
        return ""


def persistent_telemetry_device_id() -> str:
    current = read_small_text(TELEMETRY_DEVICE_ID_FILE, 256)
    if re.fullmatch(r"ordax-[0-9a-f]{32}", current):
        return current

    device_id = f"ordax-{secrets.token_hex(16)}"
    directory = os.path.dirname(TELEMETRY_DEVICE_ID_FILE)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    temporary = f"{TELEMETRY_DEVICE_ID_FILE}.tmp.{os.getpid()}.{threading.get_ident()}"
    with open(temporary, "w", encoding="utf-8") as handle:
        handle.write(device_id)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, TELEMETRY_DEVICE_ID_FILE)
    return device_id


def read_telemetry_config(path: str) -> dict | None:
    if not path:
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or payload.get("$schema") != "ordax.telemetry-relay/1":
        return None
    endpoint = payload.get("endpoint")
    publishable_key = payload.get("publishableKey")
    interval = payload.get("intervalSeconds", 30)
    timeout = payload.get("timeoutSeconds", 4)
    if (
        not isinstance(endpoint, str)
        or not endpoint.startswith("https://")
        or len(endpoint) > 2048
        or not isinstance(publishable_key, str)
        or not publishable_key.startswith("sb_publishable_")
        or len(publishable_key) > 512
        or not isinstance(interval, int)
        or interval < 15
        or interval > 3600
        or not isinstance(timeout, int)
        or timeout < 1
        or timeout > 15
    ):
        return None
    return {
        "endpoint": endpoint,
        "publishableKey": publishable_key,
        "intervalSeconds": interval,
        "timeoutSeconds": timeout,
    }


def read_rescue_status() -> tuple[int | None, str]:
    try:
        with open(RESCUE_STATUS_FILE, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None, "none"
    if not isinstance(payload, dict):
        return None, "none"
    generation = payload.get("generation")
    action = payload.get("action")
    if not isinstance(generation, int) or generation < 0:
        generation = None
    if action not in {"none", "noop", "clear-rejected", "retry-main"}:
        action = "none"
    return generation, action


def bounded_telemetry_duration(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        return 0
    if value < 0 or value > 3600:
        return 0
    return value


def build_telemetry_payload(device_id: str) -> dict:
    update = read_update_state() or {}
    rescue_generation, rescue_action = read_rescue_status()
    healthy_sha = read_small_text(HEALTH_STATE_FILE, 128)
    if not valid_commit_sha(healthy_sha):
        healthy_sha = ""

    last_applied_at = update.get("lastAppliedAt")
    if not isinstance(last_applied_at, str) or last_applied_at in {"", "unknown"}:
        last_applied_at = ""

    client_diagnostic = read_client_diagnostic()
    return {
        "deviceId": device_id,
        "sourceSha": update.get("sourceSha") if valid_commit_sha(update.get("sourceSha")) else "",
        "targetSha": update.get("targetSha") if valid_commit_sha(update.get("targetSha")) else "",
        "remoteSha": "",
        "updateStatus": update.get("status") if isinstance(update.get("status"), str) else "",
        "phase": update.get("phase") if isinstance(update.get("phase"), str) else "",
        "applyMode": update.get("applyMode") if isinstance(update.get("applyMode"), str) else "",
        "attemptId": update.get("attemptId") if isinstance(update.get("attemptId"), str) else "",
        "rejectedSha": update.get("rejectedSha") if valid_commit_sha(update.get("rejectedSha")) else "",
        "healthySha": healthy_sha,
        "lastAppliedSha": update.get("lastAppliedSha") if valid_commit_sha(update.get("lastAppliedSha")) else "",
        "lastAppliedAt": last_applied_at,
        "stagedReleaseSha": update.get("stagedReleaseSha") if valid_commit_sha(update.get("stagedReleaseSha")) else "",
        "lastApplyDurationSeconds": bounded_telemetry_duration(update.get("lastApplyDurationSeconds")),
        "lastStageDurationSeconds": bounded_telemetry_duration(update.get("lastStageDurationSeconds")),
        "rescueGeneration": rescue_generation,
        "rescueAction": rescue_action,
        "surfaceState": "running",
        "bootId": read_small_text(BOOT_ID_FILE, 256),
        "lastError": update.get("lastError") if isinstance(update.get("lastError"), str) else "",
        "clientDiagnosticSha": client_diagnostic.get("sourceSha", ""),
        "clientDiagnosticStage": client_diagnostic.get("stage", ""),
        "clientDiagnosticName": client_diagnostic.get("errorName", ""),
        "clientDiagnosticSource": client_diagnostic.get("source", ""),
        "clientDiagnosticEpoch": client_diagnostic.get("observedEpoch"),
        "relayVersion": 2,
    }


def submit_telemetry(config: dict, payload: dict) -> bool:
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    request = Request(
        config["endpoint"],
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "apikey": config["publishableKey"],
            "User-Agent": "OrdaX-OS-Telemetry/1",
        },
    )
    try:
        with urlopen(request, timeout=config["timeoutSeconds"]) as response:
            return 200 <= response.status < 300
    except (HTTPError, URLError, OSError, TimeoutError):
        return False


def telemetry_heartbeat_loop(config: dict) -> None:
    try:
        device_id = persistent_telemetry_device_id()
    except OSError as exc:
        print(f"ordax-native-host: telemetry device id unavailable: {exc}", file=sys.stderr, flush=True)
        return

    while True:
        try:
            submit_telemetry(config, build_telemetry_payload(device_id))
        except Exception as exc:
            print(f"ordax-native-host: telemetry heartbeat failed safely: {exc}", file=sys.stderr, flush=True)
        time.sleep(config["intervalSeconds"])


def start_telemetry_heartbeat(config_path: str) -> bool:
    config = read_telemetry_config(config_path)
    if config is None:
        return False
    thread = threading.Thread(
        target=telemetry_heartbeat_loop,
        args=(config,),
        name="ordax-telemetry",
        daemon=True,
    )
    thread.start()
    return True


def supported_power_actions(power_request_path: str) -> tuple[str, ...]:
    try:
        metadata = os.stat(power_request_path)
    except OSError:
        return ()
    if (
        not stat.S_ISFIFO(metadata.st_mode)
        or metadata.st_uid != os.geteuid()
        or stat.S_IMODE(metadata.st_mode) != 0o600
        or not os.access(power_request_path, os.W_OK)
    ):
        return ()
    return POWER_ACTIONS


def queue_power_action(power_request_path: str, action: str) -> None:
    if action not in POWER_ACTIONS:
        raise ValueError("unsupported power action")
    descriptor = os.open(
        power_request_path,
        os.O_WRONLY
        | getattr(os, "O_NONBLOCK", 0)
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0),
    )
    try:
        metadata = os.fstat(descriptor)
        if (
            not stat.S_ISFIFO(metadata.st_mode)
            or metadata.st_uid != os.geteuid()
            or stat.S_IMODE(metadata.st_mode) != 0o600
        ):
            raise PermissionError("host power broker boundary is not a private FIFO")
        payload = f"{action}\n".encode("ascii")
        written = os.write(descriptor, payload)
        if written != len(payload):
            raise OSError("short write to host power broker")
    finally:
        os.close(descriptor)


def read_update_state() -> dict | None:
    try:
        with open(UPDATE_STATE_FILE, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    source_sha = payload.get("sourceSha")
    if not isinstance(source_sha, str) or not source_sha:
        return None
    return payload


def valid_commit_sha(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 40
        and all(character in "0123456789abcdef" for character in value)
    )


def valid_client_diagnostic_payload(value: object) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == {"sourceSha", "stage", "errorName", "source"}
        and valid_commit_sha(value.get("sourceSha"))
        and isinstance(value.get("stage"), str)
        and CLIENT_DIAGNOSTIC_STAGE_RE.fullmatch(value["stage"]) is not None
        and isinstance(value.get("errorName"), str)
        and CLIENT_DIAGNOSTIC_NAME_RE.fullmatch(value["errorName"]) is not None
        and isinstance(value.get("source"), str)
        and (
            value["source"] == ""
            or CLIENT_DIAGNOSTIC_SOURCE_RE.fullmatch(value["source"]) is not None
        )
    )


def record_client_diagnostic(payload: dict) -> None:
    if not valid_client_diagnostic_payload(payload):
        raise ValueError("invalid client diagnostic")
    directory = os.path.dirname(CLIENT_DIAGNOSTIC_FILE)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    record = {
        "sourceSha": payload["sourceSha"],
        "stage": payload["stage"],
        "errorName": payload["errorName"],
        "source": payload["source"],
        "observedEpoch": max(0, int(time.time())),
    }
    temporary = f"{CLIENT_DIAGNOSTIC_FILE}.tmp.{os.getpid()}.{threading.get_ident()}"
    with open(temporary, "w", encoding="utf-8") as handle:
        os.fchmod(handle.fileno(), 0o600)
        json.dump(record, handle, separators=(",", ":"), sort_keys=True, allow_nan=False)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, CLIENT_DIAGNOSTIC_FILE)


def read_client_diagnostic() -> dict:
    try:
        with open(CLIENT_DIAGNOSTIC_FILE, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(payload, dict):
        return {}
    candidate = {
        "sourceSha": payload.get("sourceSha"),
        "stage": payload.get("stage"),
        "errorName": payload.get("errorName"),
        "source": payload.get("source"),
    }
    if not valid_client_diagnostic_payload(candidate):
        return {}
    observed_epoch = payload.get("observedEpoch")
    if not isinstance(observed_epoch, int) or observed_epoch < 0:
        return {}
    return {**candidate, "observedEpoch": observed_epoch}


def valid_preference_record(value: object) -> bool:
    if not isinstance(value, dict) or len(value) > 128:
        return False
    for preference_id, preference_value in value.items():
        if not isinstance(preference_id, str) or not PREFERENCE_ID_RE.fullmatch(preference_id):
            return False
        if preference_value is None or isinstance(preference_value, (str, bool, int)):
            if isinstance(preference_value, str) and len(preference_value) > 4096:
                return False
            continue
        if isinstance(preference_value, float) and math.isfinite(preference_value):
            continue
        return False
    return True


def read_preferences() -> dict:
    try:
        with open(PREFERENCES_FILE, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except FileNotFoundError:
        return {}
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if valid_preference_record(payload) else {}


def write_preferences(preferences: dict) -> None:
    if not valid_preference_record(preferences):
        raise ValueError("invalid preference record")
    directory = os.path.dirname(PREFERENCES_FILE)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    temporary = f"{PREFERENCES_FILE}.tmp.{os.getpid()}.{threading.get_ident()}"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(preferences, handle, separators=(",", ":"), sort_keys=True, allow_nan=False)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, PREFERENCES_FILE)
    try:
        directory_fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    except OSError:
        return
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def read_keyboard_layout_id() -> str:
    try:
        info = os.lstat(KEYBOARD_LAYOUT_FILE)
        if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
            return DEFAULT_KEYBOARD_LAYOUT_ID
        with open(KEYBOARD_LAYOUT_FILE, "r", encoding="utf-8") as handle:
            layout_id = handle.read(64).strip()
    except (FileNotFoundError, OSError, UnicodeError):
        return DEFAULT_KEYBOARD_LAYOUT_ID
    return layout_id if layout_id in KEYBOARD_LAYOUT_ID_SET else DEFAULT_KEYBOARD_LAYOUT_ID


def write_keyboard_layout_id(layout_id: str) -> None:
    if layout_id not in KEYBOARD_LAYOUT_ID_SET:
        raise ValueError("invalid keyboard layout id")
    directory = os.path.dirname(KEYBOARD_LAYOUT_FILE)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    temporary = f"{KEYBOARD_LAYOUT_FILE}.tmp.{os.getpid()}.{threading.get_ident()}"
    try:
        with open(temporary, "w", encoding="utf-8") as handle:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(layout_id)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, KEYBOARD_LAYOUT_FILE)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
    try:
        directory_fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    except OSError:
        return
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def keyboard_layout_snapshot() -> dict:
    configured_layout_id = read_keyboard_layout_id()
    applied_layout_id = os.environ.get(
        "ORDAX_KEYBOARD_LAYOUT_ID",
        DEFAULT_KEYBOARD_LAYOUT_ID,
    )
    if applied_layout_id not in KEYBOARD_LAYOUT_ID_SET:
        applied_layout_id = DEFAULT_KEYBOARD_LAYOUT_ID
    return {
        "configuredLayoutId": configured_layout_id,
        "appliedLayoutId": applied_layout_id,
        "supportedLayoutIds": list(KEYBOARD_LAYOUT_IDS),
        "restartRequired": configured_layout_id != applied_layout_id,
    }


def initial_first_run_state() -> dict:
    return {
        "schema": "ordax.first-run-state/1",
        "completed": False,
        "locale": "pt-BR",
        "timeZone": "America/Bahia",
        "accountMode": None,
    }


def valid_first_run_state(value: object) -> bool:
    if not isinstance(value, dict) or set(value) != {
        "schema", "completed", "locale", "timeZone", "accountMode"
    }:
        return False
    if value.get("schema") != "ordax.first-run-state/1":
        return False
    if not isinstance(value.get("completed"), bool):
        return False
    if value.get("locale") not in FIRST_RUN_LOCALES:
        return False
    if value.get("timeZone") not in FIRST_RUN_TIME_ZONES:
        return False
    account_mode = value.get("accountMode")
    if value["completed"]:
        return account_mode in FIRST_RUN_ACCOUNT_MODES
    return account_mode is None


def read_first_run_state() -> dict:
    try:
        with open(FIRST_RUN_FILE, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except FileNotFoundError:
        return initial_first_run_state()
    except (OSError, json.JSONDecodeError):
        return initial_first_run_state()
    return payload if valid_first_run_state(payload) else initial_first_run_state()


def write_first_run_state(state_value: dict) -> None:
    if not valid_first_run_state(state_value):
        raise ValueError("invalid first-run state")
    directory = os.path.dirname(FIRST_RUN_FILE)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    temporary = f"{FIRST_RUN_FILE}.tmp.{os.getpid()}.{threading.get_ident()}"
    try:
        with open(temporary, "w", encoding="utf-8") as handle:
            os.fchmod(handle.fileno(), 0o600)
            json.dump(state_value, handle, separators=(",", ":"), sort_keys=True, allow_nan=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, FIRST_RUN_FILE)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
    try:
        directory_fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    except OSError:
        return
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def valid_device_display_name(value: object) -> bool:
    if not isinstance(value, str):
        return False
    normalized = " ".join(value.strip().split())
    return (
        1 <= len(normalized) <= 120
        and all(ord(char) >= 32 and char != "\x7f" for char in normalized)
    )


def normalize_device_display_name(value: str) -> str:
    if not valid_device_display_name(value):
        raise ValueError("invalid device display name")
    return " ".join(value.strip().split())


def initial_device_profile() -> dict:
    return {
        "schema": "ordax.device-profile/1",
        "devicePublicId": f"ordax-{secrets.token_hex(16)}",
        "displayName": "Meu OrdaX",
    }


def valid_device_profile(value: object) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == {"schema", "devicePublicId", "displayName"}
        and value.get("schema") == "ordax.device-profile/1"
        and isinstance(value.get("devicePublicId"), str)
        and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{7,159}", value["devicePublicId"]) is not None
        and valid_device_display_name(value.get("displayName"))
    )


def write_device_profile(profile: dict) -> None:
    if not valid_device_profile(profile):
        raise ValueError("invalid device profile")
    directory = os.path.dirname(DEVICE_PROFILE_FILE)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    temporary = f"{DEVICE_PROFILE_FILE}.tmp.{os.getpid()}.{threading.get_ident()}"
    try:
        flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(temporary, flags, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(profile, handle, separators=(",", ":"), sort_keys=True, allow_nan=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, DEVICE_PROFILE_FILE)
        os.chmod(DEVICE_PROFILE_FILE, 0o600)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
    try:
        directory_fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    except OSError:
        return
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def read_device_profile() -> dict:
    try:
        st = os.stat(DEVICE_PROFILE_FILE, follow_symlinks=False)
        if not stat.S_ISREG(st.st_mode) or st.st_mode & 0o077:
            raise ValueError("device profile permissions are unsafe")
        with open(DEVICE_PROFILE_FILE, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if not valid_device_profile(payload):
            raise ValueError("device profile is invalid")
        return payload
    except FileNotFoundError:
        profile = initial_device_profile()
        write_device_profile(profile)
        return profile


def valid_local_session_secret(value: object) -> bool:
    return (
        isinstance(value, str)
        and LOCAL_SESSION_SECRET_MIN_CHARS <= len(value) <= LOCAL_SESSION_SECRET_MAX_CHARS
        and "\x00" not in value
        and bool(value.strip())
    )


def derive_local_session_verifier(secret: str, salt: bytes) -> bytes:
    if not valid_local_session_secret(secret):
        raise ValueError("invalid local session secret")
    if not isinstance(salt, bytes) or len(salt) != 32:
        raise ValueError("invalid local session salt")
    return hashlib.scrypt(
        secret.encode("utf-8"),
        salt=salt,
        n=LOCAL_SESSION_SCRYPT_N,
        r=LOCAL_SESSION_SCRYPT_R,
        p=LOCAL_SESSION_SCRYPT_P,
        maxmem=LOCAL_SESSION_SCRYPT_MAXMEM,
        dklen=LOCAL_SESSION_SCRYPT_DKLEN,
    )


def valid_local_session_credential(value: object) -> bool:
    if not isinstance(value, dict) or set(value) != {
        "schema", "kdf", "n", "r", "p", "saltHex", "verifierHex"
    }:
        return False
    if value.get("schema") != "ordax.local-session-credential/1" or value.get("kdf") != "scrypt":
        return False
    if (
        value.get("n") != LOCAL_SESSION_SCRYPT_N
        or value.get("r") != LOCAL_SESSION_SCRYPT_R
        or value.get("p") != LOCAL_SESSION_SCRYPT_P
    ):
        return False
    salt_hex = value.get("saltHex")
    verifier_hex = value.get("verifierHex")
    return (
        isinstance(salt_hex, str)
        and re.fullmatch(r"[0-9a-f]{64}", salt_hex) is not None
        and isinstance(verifier_hex, str)
        and re.fullmatch(r"[0-9a-f]{64}", verifier_hex) is not None
    )


def read_local_session_credential() -> dict | None:
    try:
        with open(LOCAL_SESSION_CREDENTIAL_FILE, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except FileNotFoundError:
        return None
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("local session credential is unreadable") from exc
    if not valid_local_session_credential(payload):
        raise ValueError("local session credential is invalid")
    return payload


def write_local_session_credential(secret: str) -> None:
    if not valid_local_session_secret(secret):
        raise ValueError("invalid local session secret")
    salt = secrets.token_bytes(32)
    verifier = derive_local_session_verifier(secret, salt)
    payload = {
        "schema": "ordax.local-session-credential/1",
        "kdf": "scrypt",
        "n": LOCAL_SESSION_SCRYPT_N,
        "r": LOCAL_SESSION_SCRYPT_R,
        "p": LOCAL_SESSION_SCRYPT_P,
        "saltHex": salt.hex(),
        "verifierHex": verifier.hex(),
    }
    directory = os.path.dirname(LOCAL_SESSION_CREDENTIAL_FILE)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    temporary = (
        f"{LOCAL_SESSION_CREDENTIAL_FILE}.tmp."
        f"{os.getpid()}.{threading.get_ident()}"
    )
    descriptor = os.open(
        temporary,
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0),
        0o600,
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", closefd=True) as handle:
            json.dump(payload, handle, separators=(",", ":"), sort_keys=True, allow_nan=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, LOCAL_SESSION_CREDENTIAL_FILE)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
    try:
        directory_fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    except OSError:
        return
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def verify_local_session_secret(secret: str) -> bool:
    credential = read_local_session_credential()
    if credential is None or not valid_local_session_secret(secret):
        return False
    salt = bytes.fromhex(credential["saltHex"])
    expected = bytes.fromhex(credential["verifierHex"])
    actual = derive_local_session_verifier(secret, salt)
    return hmac.compare_digest(actual, expected)


def remove_local_session_credential() -> None:
    try:
        os.unlink(LOCAL_SESSION_CREDENTIAL_FILE)
    except FileNotFoundError:
        return
    directory = os.path.dirname(LOCAL_SESSION_CREDENTIAL_FILE)
    try:
        directory_fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    except OSError:
        return
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def local_session_snapshot(server) -> dict:
    credential_configured = os.path.isfile(LOCAL_SESSION_CREDENTIAL_FILE)
    locked = bool(server.local_session_locked and credential_configured)
    return {
        "schema": "ordax.local-session/1",
        "state": "locked" if locked else "unlocked",
        "credentialConfigured": credential_configured,
        "canLock": credential_configured,
        "protectionScope": "surface-session-not-storage-encryption",
    }


def valid_component_state_payload(value: object) -> bool:
    return (
        value is None
        or (
            isinstance(value, str)
            and len(value.encode("utf-8")) <= MAX_COMPONENT_STATE_PAYLOAD
        )
    )


def read_component_state_payload() -> str | None:
    try:
        with open(COMPONENT_STATE_FILE, "rb") as handle:
            raw = handle.read(MAX_COMPONENT_STATE_PAYLOAD + 1)
    except FileNotFoundError:
        return None
    if len(raw) > MAX_COMPONENT_STATE_PAYLOAD:
        raise ValueError("component state payload exceeds maximum size")
    return raw.decode("utf-8", errors="strict")


def write_component_state_payload(payload: str | None) -> None:
    if not valid_component_state_payload(payload):
        raise ValueError("invalid component state payload")
    directory = os.path.dirname(COMPONENT_STATE_FILE)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    if payload is None:
        try:
            os.unlink(COMPONENT_STATE_FILE)
        except FileNotFoundError:
            return
    else:
        temporary = f"{COMPONENT_STATE_FILE}.tmp.{os.getpid()}.{threading.get_ident()}"
        try:
            descriptor = os.open(
                temporary,
                os.O_WRONLY
                | os.O_CREAT
                | os.O_EXCL
                | getattr(os, "O_NOFOLLOW", 0)
                | getattr(os, "O_CLOEXEC", 0),
                0o600,
            )
            with os.fdopen(descriptor, "w", encoding="utf-8", closefd=True) as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, COMPONENT_STATE_FILE)
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
    try:
        directory_fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    except OSError:
        return
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)

def valid_sync_state_payload(value: object) -> bool:
    return (
        value is None
        or (
            isinstance(value, str)
            and len(value.encode("utf-8")) <= MAX_SYNC_STATE_PAYLOAD
        )
    )


def read_sync_state_payload() -> str | None:
    try:
        with open(SYNC_STATE_FILE, "r", encoding="utf-8") as handle:
            payload = handle.read(MAX_SYNC_STATE_PAYLOAD + 1)
    except FileNotFoundError:
        return None
    except (OSError, UnicodeError):
        return None
    return payload if valid_sync_state_payload(payload) else None


def write_sync_state_payload(payload: str | None) -> None:
    if not valid_sync_state_payload(payload):
        raise ValueError("invalid sync state payload")
    directory = os.path.dirname(SYNC_STATE_FILE)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    if payload is None:
        try:
            os.unlink(SYNC_STATE_FILE)
        except FileNotFoundError:
            return
    else:
        temporary = f"{SYNC_STATE_FILE}.tmp.{os.getpid()}.{threading.get_ident()}"
        try:
            with open(temporary, "w", encoding="utf-8") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, SYNC_STATE_FILE)
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
    try:
        directory_fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    except OSError:
        return
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def valid_sync_checkpoint(value: object) -> bool:
    if value is None:
        return True
    if not isinstance(value, dict) or set(value) != {"subjectId", "cursor", "revisions"}:
        return False
    subject_id = value.get("subjectId")
    cursor = value.get("cursor")
    revisions = value.get("revisions")
    if not isinstance(subject_id, str) or not (1 <= len(subject_id) <= 200):
        return False
    if isinstance(cursor, bool) or not isinstance(cursor, int) or cursor < 0 or cursor > 9007199254740991:
        return False
    if not isinstance(revisions, dict) or len(revisions) > 64:
        return False
    for object_id, revision in revisions.items():
        if not isinstance(object_id, str) or not (1 <= len(object_id) <= 240):
            return False
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0 or revision > 9007199254740991:
            return False
    return True


def read_sync_checkpoint() -> dict | None:
    try:
        with open(SYNC_CHECKPOINT_FILE, "r", encoding="utf-8") as handle:
            value = json.load(handle)
    except FileNotFoundError:
        return None
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    return value if valid_sync_checkpoint(value) else None


def write_sync_checkpoint(value: dict | None) -> None:
    if not valid_sync_checkpoint(value):
        raise ValueError("invalid sync checkpoint")
    directory = os.path.dirname(SYNC_CHECKPOINT_FILE)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    if value is None:
        try:
            os.unlink(SYNC_CHECKPOINT_FILE)
        except FileNotFoundError:
            return
    else:
        temporary = f"{SYNC_CHECKPOINT_FILE}.tmp.{os.getpid()}.{threading.get_ident()}"
        try:
            with open(temporary, "w", encoding="utf-8") as handle:
                os.fchmod(handle.fileno(), 0o600)
                json.dump(value, handle, separators=(",", ":"), sort_keys=True, allow_nan=False)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, SYNC_CHECKPOINT_FILE)
            os.chmod(SYNC_CHECKPOINT_FILE, 0o600)
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
    try:
        directory_fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    except OSError:
        return
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def valid_diagnostic_journal_payload(value: object) -> bool:
    return (
        value is None
        or (
            isinstance(value, str)
            and len(value.encode("utf-8")) <= MAX_DIAGNOSTIC_JOURNAL_PAYLOAD
        )
    )


def read_diagnostic_journal_payload() -> str | None:
    try:
        with open(DIAGNOSTIC_JOURNAL_FILE, "rb") as handle:
            raw = handle.read(MAX_DIAGNOSTIC_JOURNAL_PAYLOAD + 1)
    except FileNotFoundError:
        return None
    if len(raw) > MAX_DIAGNOSTIC_JOURNAL_PAYLOAD:
        raise ValueError("diagnostic journal payload exceeds maximum size")
    return raw.decode("utf-8", errors="strict")


def write_diagnostic_journal_payload(payload: str | None) -> None:
    if not valid_diagnostic_journal_payload(payload):
        raise ValueError("invalid diagnostic journal payload")

    directory = os.path.dirname(DIAGNOSTIC_JOURNAL_FILE)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    if payload is None:
        try:
            os.unlink(DIAGNOSTIC_JOURNAL_FILE)
        except FileNotFoundError:
            pass
    else:
        encoded = payload.encode("utf-8")
        temporary = (
            f"{DIAGNOSTIC_JOURNAL_FILE}.tmp.{os.getpid()}.{threading.get_ident()}"
        )
        descriptor = None
        try:
            descriptor = os.open(
                temporary,
                os.O_WRONLY
                | os.O_CREAT
                | os.O_EXCL
                | getattr(os, "O_NOFOLLOW", 0)
                | getattr(os, "O_CLOEXEC", 0),
                0o600,
            )
            with os.fdopen(descriptor, "wb", closefd=True) as handle:
                descriptor = None
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, DIAGNOSTIC_JOURNAL_FILE)
        finally:
            if descriptor is not None:
                os.close(descriptor)
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass

    try:
        directory_fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    except OSError:
        return
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def parse_meminfo(text: str) -> tuple[int, int]:
    fields: dict[str, int] = {}
    for line in text.splitlines():
        if ":" not in line:
            continue
        name, raw_value = line.split(":", 1)
        parts = raw_value.strip().split()
        if not parts:
            continue
        try:
            value = int(parts[0])
        except ValueError:
            continue
        if value < 0:
            continue
        unit = parts[1] if len(parts) > 1 else ""
        if unit not in {"", "kB"}:
            continue
        fields[name] = value * 1024 if unit == "kB" else value

    total = fields.get("MemTotal")
    available = fields.get("MemAvailable")
    if total is None or available is None or available > total:
        raise ValueError("required memory metrics are unavailable")
    return total, available


def read_system_metrics(user_root: str, proc_root: str = "/proc") -> dict:
    with open(os.path.join(proc_root, "uptime"), "r", encoding="utf-8") as handle:
        uptime_parts = handle.read().strip().split()
    if not uptime_parts:
        raise ValueError("uptime metric is unavailable")
    uptime_value = float(uptime_parts[0])
    if not math.isfinite(uptime_value) or uptime_value < 0:
        raise ValueError("uptime metric is invalid")

    with open(os.path.join(proc_root, "meminfo"), "r", encoding="utf-8") as handle:
        memory_total, memory_available = parse_meminfo(handle.read())

    os.makedirs(user_root, mode=0o700, exist_ok=True)
    storage = os.statvfs(user_root)
    block_size = storage.f_frsize or storage.f_bsize
    storage_total = max(0, int(storage.f_blocks) * int(block_size))
    storage_free = max(0, int(storage.f_bavail) * int(block_size))
    storage_free = min(storage_free, storage_total)

    return {
        "uptimeSeconds": max(0, int(uptime_value)),
        "memoryTotalBytes": memory_total,
        "memoryAvailableBytes": memory_available,
        "userStorageTotalBytes": storage_total,
        "userStorageFreeBytes": storage_free,
    }


def _optional_release_sha(path: str) -> str | None:
    try:
        value = read_small_text(path, 128).strip()
    except OSError:
        return None
    if not value:
        return None
    if re.fullmatch(r"[0-9a-f]{40}", value) is None:
        raise ValueError(f"invalid portable release identity at {path}")
    return value


def read_recovery_status(
    state_root: str | None = None,
    esp_root: str = "/ordax-esp",
    environment: dict[str, str] | None = None,
) -> dict:
    env = os.environ if environment is None else environment
    layout = env.get("ORDAX_STABLE_LAYOUT", "")
    if layout != "portable-v2":
        raise ValueError("recovery status is only available for portable-v2 Stable runtime")

    root = state_root or env.get("ORDAX_PORTABLE_STATE_ROOT", "/state")
    activation_root = os.path.join(root, "ordax", "portable-release")
    running_source = env.get("ORDAX_SOURCE_SHA", "").strip()
    if re.fullmatch(r"[0-9a-f]{40}", running_source) is None:
        raise ValueError("running Stable source identity is unavailable")
    boot_slot = env.get("ORDAX_BOOT_SLOT", "unknown").strip()
    if boot_slot not in {"current", "known-good", "candidate"}:
        boot_slot = "unknown"

    current = _optional_release_sha(os.path.join(activation_root, "current"))
    known_good = _optional_release_sha(os.path.join(activation_root, "known-good"))
    candidate = _optional_release_sha(os.path.join(activation_root, "candidate"))
    transaction_present = os.path.isfile(
        os.path.join(activation_root, "activation-transaction.json")
    )

    recovery_entry = os.path.join(
        esp_root,
        "loader",
        "entries",
        "ordax-portable-recovery.conf",
    )
    if not os.path.exists(esp_root):
        recovery_entry_status = "unavailable"
    elif not os.path.isfile(recovery_entry):
        recovery_entry_status = "missing"
    else:
        try:
            recovery_text = read_small_text(recovery_entry, 8192)
        except OSError:
            recovery_entry_status = "invalid"
        else:
            required = (
                "linux /ordax/vmlinuz",
                "initrd /ordax/initrd.gz",
                "rdinit=/sbin/ordax-portable-init",
                "ordax.mode=recovery",
            )
            recovery_entry_status = (
                "verified"
                if all(marker in recovery_text for marker in required)
                else "invalid"
            )

    return {
        "schema": "ordax.recovery-status/1",
        "layout": "portable-v2",
        "bootSlot": boot_slot,
        "runningSourceSha": running_source,
        "currentSha": current,
        "knownGoodSha": known_good,
        "candidateSha": candidate,
        "transactionPresent": transaction_present,
        "recoveryEntryStatus": recovery_entry_status,
        "policy": "local-read-only",
        "automaticNetwork": False,
        "automaticMutation": False,
    }


def read_power_supply_percent(path: str) -> int | None:
    raw_capacity = read_small_text(os.path.join(path, "capacity"), 16)
    try:
        capacity = int(raw_capacity)
    except ValueError:
        capacity = -1
    if 0 <= capacity <= 100:
        return capacity

    for current_name, full_names in (
        ("energy_now", ("energy_full", "energy_full_design")),
        ("charge_now", ("charge_full", "charge_full_design")),
    ):
        raw_current = read_small_text(os.path.join(path, current_name), 32)
        try:
            current = int(raw_current)
        except ValueError:
            continue
        if current < 0:
            continue
        for full_name in full_names:
            raw_full = read_small_text(os.path.join(path, full_name), 32)
            try:
                full = int(raw_full)
            except ValueError:
                continue
            if full <= 0:
                continue
            return max(0, min(100, int(round((current * 100) / full))))
    return None


def read_power_status(sys_class_power_supply: str = "/sys/class/power_supply") -> dict:
    try:
        names = sorted(os.listdir(sys_class_power_supply))
    except FileNotFoundError:
        return {"battery": None, "externalPower": None}
    except OSError as exc:
        raise ValueError("power supply inventory is unavailable") from exc

    batteries = []
    external_online = []
    for name in names[:64]:
        path = os.path.join(sys_class_power_supply, name)
        if not os.path.isdir(path):
            continue
        supply_type = read_small_text(os.path.join(path, "type"), 64).strip().lower()
        if supply_type == "battery":
            present = read_small_text(os.path.join(path, "present"), 8)
            if present == "0":
                continue
            capacity = read_power_supply_percent(path)
            if capacity is None:
                continue
            raw_status = read_small_text(os.path.join(path, "status"), 64).strip().lower()
            state = {
                "charging": "charging",
                "discharging": "discharging",
                "full": "full",
                "not charging": "not-charging",
            }.get(raw_status, "unknown")
            batteries.append({"percent": capacity, "state": state})
            continue

        raw_online = read_small_text(os.path.join(path, "online"), 8)
        if raw_online == "1":
            external_online.append(True)
        elif raw_online == "0":
            external_online.append(False)

    if batteries:
        percent = int(round(sum(item["percent"] for item in batteries) / len(batteries)))
        states = {item["state"] for item in batteries}
        if "charging" in states:
            state = "charging"
        elif states == {"full"}:
            state = "full"
        elif "discharging" in states:
            state = "discharging"
        elif "not-charging" in states:
            state = "not-charging"
        else:
            state = "unknown"
        battery = {"percent": percent, "state": state}
    else:
        battery = None

    external_power = (
        True
        if any(external_online)
        else (False if external_online else None)
    )
    return {
        "battery": battery,
        "externalPower": external_power,
    }


def parse_wireless_signals(text: str) -> dict[str, int]:
    signals: dict[str, int] = {}
    for raw_line in text.splitlines()[2:]:
        if ":" not in raw_line:
            continue
        interface_name, values = raw_line.split(":", 1)
        interface_name = interface_name.strip()
        if not NETWORK_INTERFACE_RE.fullmatch(interface_name):
            continue
        fields = values.split()
        if len(fields) < 3:
            continue
        try:
            level = float(fields[2].rstrip("."))
        except ValueError:
            continue
        if not math.isfinite(level):
            continue
        signal_dbm = int(level)
        if -200 <= signal_dbm <= 0:
            signals[interface_name] = signal_dbm
    return signals


def read_network_status(
    sys_class_net: str = "/sys/class/net",
    proc_net_wireless: str = "/proc/net/wireless",
) -> dict:
    try:
        with open(proc_net_wireless, "r", encoding="utf-8") as handle:
            wireless_signals = parse_wireless_signals(handle.read(65536))
    except (OSError, UnicodeError):
        wireless_signals = {}

    interfaces = []
    try:
        names = sorted(os.listdir(sys_class_net))
    except OSError as exc:
        raise ValueError("network interface inventory is unavailable") from exc

    for name in names[:64]:
        if name == "lo" or not NETWORK_INTERFACE_RE.fullmatch(name):
            continue
        interface_path = os.path.join(sys_class_net, name)
        if not os.path.isdir(interface_path):
            continue

        is_wifi = os.path.isdir(os.path.join(interface_path, "wireless"))
        interface_type = read_small_text(os.path.join(interface_path, "type"), 32)
        kind = "wifi" if is_wifi else ("ethernet" if interface_type == "1" else "other")

        carrier = read_small_text(os.path.join(interface_path, "carrier"), 8)
        operstate = read_small_text(os.path.join(interface_path, "operstate"), 32)
        if carrier == "1":
            link_state = "connected"
        elif carrier == "0":
            link_state = "disconnected"
        elif operstate == "up":
            link_state = "connected"
        elif operstate in {"down", "dormant", "notpresent", "lowerlayerdown"}:
            link_state = "disconnected"
        else:
            link_state = "unknown"

        interfaces.append(
            {
                "name": name,
                "kind": kind,
                "state": link_state,
                "signalDbm": wireless_signals.get(name) if is_wifi else None,
            }
        )

    return {"interfaces": interfaces}


def valid_wifi_ssid(value: object) -> bool:
    if not isinstance(value, str) or not value:
        return False
    try:
        encoded = value.encode("utf-8")
    except UnicodeError:
        return False
    return (
        1 <= len(encoded) <= 32
        and "\x00" not in value
        and not any(ord(character) < 32 for character in value)
    )


def valid_wifi_password(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        encoded = value.encode("utf-8")
    except UnicodeError:
        return False
    return (
        8 <= len(encoded) <= 63
        and "\x00" not in value
        and not any(ord(character) < 32 for character in value)
    )


def derive_wpa_psk(ssid: str, password: str) -> str:
    if not valid_wifi_ssid(ssid) or not valid_wifi_password(password):
        raise ValueError("invalid Wi-Fi credentials")
    return hashlib.pbkdf2_hmac(
        "sha1",
        password.encode("utf-8"),
        ssid.encode("utf-8"),
        4096,
        dklen=32,
    ).hex()


def decode_wpa_ssid_line(line: str) -> str | None:
    value = line.strip()
    if not value.startswith("ssid="):
        return None
    raw = value[5:].strip()
    if len(raw) >= 2 and raw[0] == '"' and raw[-1] == '"':
        decoded_characters = []
        escaped = False
        for character in raw[1:-1]:
            if escaped:
                decoded_characters.append(character)
                escaped = False
            elif character == "\\":
                escaped = True
            else:
                decoded_characters.append(character)
        if escaped:
            return None
        decoded = "".join(decoded_characters)
        return decoded if valid_wifi_ssid(decoded) else None
    if not raw or len(raw) % 2 != 0 or any(character not in "0123456789abcdefABCDEF" for character in raw):
        return None
    try:
        decoded = bytes.fromhex(raw).decode("utf-8")
    except (ValueError, UnicodeError):
        return None
    return decoded if valid_wifi_ssid(decoded) else None


def parse_iw_link(text: str) -> str | None:
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line.startswith("SSID:"):
            continue
        ssid = line[5:].strip()
        return ssid if valid_wifi_ssid(ssid) else None
    return None


def parse_iw_scan(text: str, *, current_ssid: str | None, saved_ssid: str | None) -> list[dict]:
    networks: dict[str, dict] = {}
    block: list[str] = []

    def consume(lines: list[str]) -> None:
        if not lines:
            return
        ssid = None
        signal_dbm = None
        supports_psk = False
        for raw_line in lines:
            line = raw_line.strip()
            if line.startswith("SSID:"):
                candidate = line[5:].strip()
                if valid_wifi_ssid(candidate):
                    ssid = candidate
            elif line.startswith("signal:"):
                raw_signal = line[7:].strip().split(" ", 1)[0]
                try:
                    signal_value = float(raw_signal)
                except ValueError:
                    continue
                if math.isfinite(signal_value) and -200 <= signal_value <= 0:
                    signal_dbm = int(round(signal_value))
            elif "Authentication suites:" in line and "PSK" in line.split(":", 1)[-1].split():
                supports_psk = True

        if ssid is None or signal_dbm is None or not supports_psk:
            return
        existing = networks.get(ssid)
        if existing is not None and existing["signalDbm"] >= signal_dbm:
            return
        networks[ssid] = {
            "ssid": ssid,
            "signalDbm": signal_dbm,
            "security": "wpa-psk",
            "connected": ssid == current_ssid,
            "saved": ssid == saved_ssid,
        }

    for raw_line in text.splitlines():
        if raw_line.startswith("BSS "):
            consume(block)
            block = [raw_line]
        elif block:
            block.append(raw_line)
    consume(block)

    return sorted(
        networks.values(),
        key=lambda entry: (not entry["connected"], not entry["saved"], -entry["signalDbm"], entry["ssid"].casefold()),
    )[:MAX_NETWORKS]


def network_broker_paths(session_dir: str) -> dict[str, str]:
    return {
        "control": os.path.join(session_dir, "network-control"),
        "request": os.path.join(session_dir, "network-request"),
        "response": os.path.join(session_dir, "network-response"),
        "scan": os.path.join(session_dir, "network-scan.raw"),
        "link": os.path.join(session_dir, "network-link.raw"),
        "saved": os.path.join(session_dir, "network-saved-ssid"),
    }


def network_broker_available(paths: dict[str, str]) -> bool:
    try:
        metadata = os.stat(paths["control"])
    except OSError:
        return False
    return (
        stat.S_ISFIFO(metadata.st_mode)
        and metadata.st_uid == os.geteuid()
        and stat.S_IMODE(metadata.st_mode) == 0o600
        and os.access(paths["control"], os.W_OK)
    )


def _read_bounded_bytes(path: str, max_bytes: int) -> bytes:
    try:
        with open(path, "rb") as handle:
            payload = handle.read(max_bytes + 1)
    except OSError:
        return b""
    return payload if len(payload) <= max_bytes else b""


def build_network_management_snapshot(paths: dict[str, str], wifi_interface: str) -> dict:
    if not NETWORK_INTERFACE_RE.fullmatch(wifi_interface):
        raise ValueError("invalid Wi-Fi interface")
    link_payload = _read_bounded_bytes(paths["link"], 64 * 1024)
    scan_payload = _read_bounded_bytes(paths["scan"], MAX_NETWORK_SCAN_BYTES)
    saved_payload = _read_bounded_bytes(paths["saved"], 1024)
    try:
        link_text = link_payload.decode("utf-8")
        scan_text = scan_payload.decode("utf-8")
        saved_text = saved_payload.decode("utf-8")
    except UnicodeError as exc:
        raise ValueError("invalid network broker output") from exc

    current_ssid = parse_iw_link(link_text)
    saved_ssid = None
    for line in saved_text.splitlines()[:1]:
        saved_ssid = decode_wpa_ssid_line(line)
    return {
        "wifiInterface": wifi_interface,
        "currentSsid": current_ssid,
        "savedSsid": saved_ssid,
        "networks": parse_iw_scan(
            scan_text,
            current_ssid=current_ssid,
            saved_ssid=saved_ssid,
        ),
    }


def queue_network_broker_request(
    paths: dict[str, str],
    action: str,
    *,
    ssid: str | None = None,
    password: str | None = None,
    timeout_seconds: float = 20.0,
) -> dict:
    if action not in {"status", "scan", "connect", "disconnect", "forget", "reconnect"}:
        raise ValueError("unsupported network action")
    if not network_broker_available(paths):
        raise FileNotFoundError("network broker unavailable")

    request_id = secrets.token_hex(12)
    lines = [request_id, action]
    if action == "connect":
        if not valid_wifi_ssid(ssid) or not valid_wifi_password(password):
            raise ValueError("invalid Wi-Fi credentials")
        lines.extend([ssid.encode("utf-8").hex(), derive_wpa_psk(ssid, password)])
    payload = ("\n".join(lines) + "\n").encode("ascii")
    request_dir = os.path.dirname(paths["request"])
    temporary = f'{paths["request"]}.tmp.{os.getpid()}.{threading.get_ident()}'
    with open(temporary, "wb") as handle:
        os.fchmod(handle.fileno(), 0o600)
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, paths["request"])

    try:
        try:
            os.unlink(paths["response"])
        except FileNotFoundError:
            pass

        descriptor = os.open(
            paths["control"],
            os.O_WRONLY
            | getattr(os, "O_NONBLOCK", 0)
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            metadata = os.fstat(descriptor)
            if (
                not stat.S_ISFIFO(metadata.st_mode)
                or metadata.st_uid != os.geteuid()
                or stat.S_IMODE(metadata.st_mode) != 0o600
            ):
                raise PermissionError("network broker boundary is not private")
            if os.write(descriptor, b"request\n") != len(b"request\n"):
                raise OSError("short write to network broker")
        finally:
            os.close(descriptor)

        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            response = read_small_text(paths["response"], 512)
            if response:
                fields = response.split("\t")
                if len(fields) == 4 and fields[0] == request_id:
                    _, outcome, wifi_interface, detail = fields
                    if outcome == "ok":
                        return build_network_management_snapshot(paths, wifi_interface)
                    error = RuntimeError(detail or "network-action-failed")
                    error.network_detail = detail
                    raise error
            time.sleep(0.05)
        raise TimeoutError("network broker response timed out")
    finally:
        try:
            os.unlink(paths["request"])
        except FileNotFoundError:
            pass


def native_install_broker_paths(session_dir: str) -> dict[str, str]:
    return {
        "control": os.path.join(session_dir, "native-install-control"),
        "request": os.path.join(session_dir, "native-install-request"),
        "response": os.path.join(session_dir, "native-install-response"),
        "snapshot": os.path.join(session_dir, "native-install-targets.json"),
    }


def native_install_broker_available(paths: dict[str, str]) -> bool:
    try:
        metadata = os.stat(paths["control"])
    except OSError:
        return False
    return (
        stat.S_ISFIFO(metadata.st_mode)
        and metadata.st_uid == os.geteuid()
        and stat.S_IMODE(metadata.st_mode) == 0o600
        and os.access(paths["control"], os.W_OK)
    )


def sanitize_native_install_snapshot(payload: object) -> dict:
    if (
        not isinstance(payload, dict)
        or payload.get("$schema") != "prototype-ordax.creator-native-targets/1"
        or payload.get("mode") != "read-only-native-install-target-discovery"
        or payload.get("physical_write") is not False
    ):
        raise ValueError("invalid Native install discovery envelope")
    targets = payload.get("targets")
    if not isinstance(targets, list) or len(targets) > MAX_NATIVE_INSTALL_TARGETS:
        raise ValueError("invalid Native install target set")

    sanitized = []
    seen_tokens = set()
    for target in targets:
        if not isinstance(target, dict):
            raise ValueError("invalid Native install target")
        token = target.get("confirmation_token")
        physical_bytes = target.get("physical_bytes")
        logical_sector_bytes = target.get("logical_sector_bytes")
        model = target.get("model", "")
        transport = target.get("transport", "")
        removable = target.get("removable")
        read_only = target.get("read_only")
        source_boot_media = target.get("source_boot_media")
        eligible = target.get("eligible")
        if (
            not isinstance(token, str)
            or re.fullmatch(r"[0-9a-f]{64}", token) is None
            or token in seen_tokens
            or isinstance(physical_bytes, bool)
            or not isinstance(physical_bytes, int)
            or physical_bytes <= 0
            or physical_bytes > 1 << 60
            or logical_sector_bytes != 512
            or not isinstance(model, str)
            or len(model) > 200
            or any(ord(character) < 32 for character in model)
            or not isinstance(transport, str)
            or len(transport) > 32
            or any(ord(character) < 32 for character in transport)
            or not isinstance(removable, bool)
            or not isinstance(read_only, bool)
            or not isinstance(source_boot_media, bool)
            or not isinstance(eligible, bool)
            or eligible != (not read_only and not source_boot_media)
        ):
            raise ValueError("invalid Native install target fields")
        seen_tokens.add(token)
        sanitized.append(
            {
                "targetId": token,
                "confirmationToken": token,
                "model": model,
                "transport": transport,
                "physicalBytes": physical_bytes,
                "removable": removable,
                "readOnly": read_only,
                "sourceBootMedia": source_boot_media,
                "eligible": eligible,
            }
        )
    return {
        "schema": "ordax.native-install-targets/1",
        "physicalWriteAllowed": False,
        "targets": sanitized,
    }


def read_native_install_snapshot(path: str) -> dict:
    raw = _read_bounded_bytes(path, MAX_NATIVE_INSTALL_SNAPSHOT_BYTES)
    if not raw:
        raise ValueError("Native install broker snapshot is unavailable")
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Native install broker snapshot is invalid") from exc
    return sanitize_native_install_snapshot(payload)


def queue_native_install_broker_request(
    paths: dict[str, str],
    *,
    timeout_seconds: float = 6.0,
) -> dict:
    if not native_install_broker_available(paths):
        raise FileNotFoundError("Native install broker unavailable")
    request_id = secrets.token_hex(12)
    temporary = f'{paths["request"]}.tmp.{os.getpid()}.{threading.get_ident()}'
    with open(temporary, "w", encoding="ascii") as handle:
        os.fchmod(handle.fileno(), 0o600)
        handle.write(f"{request_id}\nlist\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, paths["request"])
    try:
        try:
            os.unlink(paths["response"])
        except FileNotFoundError:
            pass
        descriptor = os.open(
            paths["control"],
            os.O_WRONLY
            | getattr(os, "O_NONBLOCK", 0)
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            metadata = os.fstat(descriptor)
            if (
                not stat.S_ISFIFO(metadata.st_mode)
                or metadata.st_uid != os.geteuid()
                or stat.S_IMODE(metadata.st_mode) != 0o600
            ):
                raise PermissionError("Native install broker boundary is not private")
            if os.write(descriptor, b"request\n") != len(b"request\n"):
                raise OSError("short write to Native install broker")
        finally:
            os.close(descriptor)

        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            response = read_small_text(paths["response"], 512)
            if response:
                fields = response.split("\t")
                if len(fields) == 3 and fields[0] == request_id:
                    _, outcome, detail = fields
                    if outcome == "ok":
                        return read_native_install_snapshot(paths["snapshot"])
                    raise RuntimeError(detail or "native-install-discovery-failed")
            time.sleep(0.05)
        raise TimeoutError("Native install broker response timed out")
    finally:
        try:
            os.unlink(paths["request"])
        except FileNotFoundError:
            pass


def _bounded_history_lines(path: str, max_entries: int) -> list[str]:
    try:
        with open(path, "rb") as handle:
            payload = handle.read(MAX_UPDATE_HISTORY_BYTES + 1)
    except OSError:
        return []
    if len(payload) > MAX_UPDATE_HISTORY_BYTES:
        return []
    try:
        text = payload.decode("utf-8")
    except UnicodeError:
        return []
    return text.splitlines()[-max_entries:]


def _history_text(value: str, max_length: int) -> str | None:
    if not value or len(value) > max_length or any(ord(character) < 32 for character in value):
        return None
    return value


def _history_version(value: str) -> int | None:
    try:
        number = int(value)
    except ValueError:
        return None
    return number if 1 <= number <= 1_000_000 else None


def _history_duration(value: str) -> int | None:
    try:
        seconds = int(value)
    except ValueError:
        return None
    return seconds if 0 <= seconds <= 3600 else None


def read_release_history(path: str = RELEASE_HISTORY_FILE) -> list[dict]:
    releases = []
    for line in _bounded_history_lines(path, MAX_RELEASE_HISTORY_ENTRIES):
        fields = line.split("\t")
        if len(fields) != 4:
            continue
        version = _history_version(fields[0])
        released_at = _history_text(fields[1], 64)
        source_sha = fields[2]
        title = _history_text(fields[3], 200)
        if version is None or released_at is None or not valid_commit_sha(source_sha) or title is None:
            continue
        releases.append(
            {
                "deliveryNumber": version,
                "versionNumber": version,
                "sourceSha": source_sha,
                "releasedAt": released_at,
                "title": title,
            }
        )
    return releases


def read_application_history(path: str = UPDATE_HISTORY_FILE) -> list[dict]:
    applications = []
    valid_modes = {"none", "reload", "surface-restart", "supervisor-restart", "initial"}
    valid_results = {"applied", "rolled-back"}
    for line in _bounded_history_lines(path, MAX_APPLICATION_HISTORY_ENTRIES):
        fields = line.split("\t")
        if len(fields) != 7:
            continue
        version = _history_version(fields[0])
        applied_at = _history_text(fields[1], 64)
        source_sha = fields[2]
        apply_mode = fields[3]
        result = fields[4]
        apply_duration = _history_duration(fields[5])
        stage_duration = _history_duration(fields[6])
        if (
            version is None
            or applied_at is None
            or not valid_commit_sha(source_sha)
            or apply_mode not in valid_modes
            or result not in valid_results
            or apply_duration is None
            or stage_duration is None
        ):
            continue
        applications.append(
            {
                "deliveryNumber": version,
                "versionNumber": version,
                "sourceSha": source_sha,
                "appliedAt": applied_at,
                "applyMode": apply_mode,
                "result": result,
                "applyDurationSeconds": apply_duration,
                "stageDurationSeconds": stage_duration,
            }
        )
    applications.reverse()
    return applications


def read_update_history() -> dict:
    return {
        "releases": read_release_history(RELEASE_HISTORY_FILE),
        "applications": read_application_history(UPDATE_HISTORY_FILE),
    }


def valid_logical_file_path(value: object) -> bool:
    if not isinstance(value, str) or not value.startswith("/") or len(value) > 4096:
        return False
    if value != "/" and value.endswith("/"):
        return False
    if value == "/":
        return True
    parts = value.split("/")[1:]
    return bool(parts) and all(valid_file_name(part) for part in parts)


def valid_file_name(value: object) -> bool:
    return (
        isinstance(value, str)
        and 0 < len(value) <= 255
        and value not in {".", "..", TRASH_ROOT_NAME}
        and "/" not in value
        and "\0" not in value
        and not any(ord(character) < 32 for character in value)
    )


def _directory_open_flags() -> int:
    return (
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0)
    )


def open_user_directory(user_root: str, logical_path: str) -> int:
    if not valid_logical_file_path(logical_path):
        raise ValueError("invalid logical file-space path")
    os.makedirs(user_root, mode=0o700, exist_ok=True)
    descriptor = os.open(user_root, _directory_open_flags())
    try:
        for segment in logical_path.split("/")[1:]:
            if not segment:
                continue
            next_descriptor = os.open(segment, _directory_open_flags(), dir_fd=descriptor)
            os.close(descriptor)
            descriptor = next_descriptor
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def list_user_directory(user_root: str, logical_path: str) -> dict:
    descriptor = open_user_directory(user_root, logical_path)
    try:
        entries = []
        with os.scandir(descriptor) as iterator:
            for entry in iterator:
                if not valid_file_name(entry.name) or entry.is_symlink():
                    continue
                try:
                    metadata = entry.stat(follow_symlinks=False)
                    if entry.is_dir(follow_symlinks=False):
                        kind = "directory"
                        size = 0
                    elif entry.is_file(follow_symlinks=False):
                        kind = "file"
                        size = metadata.st_size
                    else:
                        continue
                    modified_at = max(0, int(metadata.st_mtime_ns // 1_000_000))
                except OSError:
                    continue
                entries.append(
                    {
                        "name": entry.name,
                        "kind": kind,
                        "size": max(0, int(size)),
                        "modifiedAt": modified_at,
                    }
                )
        entries.sort(key=lambda item: (item["kind"] != "directory", item["name"].casefold(), item["name"]))
        return {"path": logical_path, "entries": entries[:MAX_FILE_ENTRIES]}
    finally:
        os.close(descriptor)


class FileSpaceTextTooLargeError(Exception):
    pass


class FileSpaceTextEncodingError(Exception):
    pass


class FileSpaceCopyTooLargeError(Exception):
    pass


class FileSpaceCopyChangedError(Exception):
    pass


class FileSpaceCrossDeviceMoveError(Exception):
    pass


class FileSpaceExportTooLargeError(Exception):
    pass


class FileSpaceExportChangedError(Exception):
    pass


class FileSpaceImagePreviewTypeError(Exception):
    pass


class FileSpaceMediaPreviewTypeError(Exception):
    pass


class FileSpaceDocumentPreviewTypeError(Exception):
    pass


class FileSpaceImportTooLargeError(Exception):
    pass


class FileSpaceImportIncompleteError(Exception):
    pass


class FileSpaceTrashCrossDeviceError(Exception):
    pass


def _trash_directories(user_root: str) -> tuple[int, int]:
    os.makedirs(user_root, mode=0o700, exist_ok=True)
    root_fd = os.open(user_root, _directory_open_flags())
    trash_fd = None
    files_fd = None
    info_fd = None
    try:
        try:
            os.mkdir(TRASH_ROOT_NAME, mode=0o700, dir_fd=root_fd)
        except FileExistsError:
            pass
        trash_fd = os.open(
            TRASH_ROOT_NAME,
            _directory_open_flags(),
            dir_fd=root_fd,
        )
        for name in (TRASH_FILES_NAME, TRASH_INFO_NAME):
            try:
                os.mkdir(name, mode=0o700, dir_fd=trash_fd)
            except FileExistsError:
                pass
        files_fd = os.open(
            TRASH_FILES_NAME,
            _directory_open_flags(),
            dir_fd=trash_fd,
        )
        info_fd = os.open(
            TRASH_INFO_NAME,
            _directory_open_flags(),
            dir_fd=trash_fd,
        )
        return files_fd, info_fd
    except Exception:
        if files_fd is not None:
            os.close(files_fd)
        if info_fd is not None:
            os.close(info_fd)
        raise
    finally:
        if trash_fd is not None:
            os.close(trash_fd)
        os.close(root_fd)


def _trash_info_name(trash_id: str) -> str:
    if not isinstance(trash_id, str) or TRASH_ID_RE.fullmatch(trash_id) is None:
        raise ValueError("invalid trash id")
    return f"{trash_id}.json"


def _valid_trash_metadata(value: object, expected_id: str | None = None) -> bool:
    if not isinstance(value, dict) or set(value) != {
        "schema",
        "id",
        "name",
        "kind",
        "size",
        "modifiedAt",
        "originalPath",
        "trashedAt",
    }:
        return False
    trash_id = value.get("id")
    if not isinstance(trash_id, str) or TRASH_ID_RE.fullmatch(trash_id) is None:
        return False
    if expected_id is not None and trash_id != expected_id:
        return False
    name = value.get("name")
    original_path = value.get("originalPath")
    if not valid_file_name(name) or not valid_logical_file_path(original_path):
        return False
    if original_path == "/" or original_path.rsplit("/", 1)[-1] != name:
        return False
    if value.get("kind") not in {"file", "directory"}:
        return False
    size = value.get("size")
    modified_at = value.get("modifiedAt")
    trashed_at = value.get("trashedAt")
    if not isinstance(size, int) or isinstance(size, bool) or size < 0:
        return False
    if not isinstance(modified_at, int) or isinstance(modified_at, bool) or modified_at < 0:
        return False
    if not isinstance(trashed_at, int) or isinstance(trashed_at, bool) or trashed_at < 0:
        return False
    return value.get("schema") == "ordax.trash-entry/1"


def _write_trash_metadata(info_fd: int, payload: dict) -> None:
    if not _valid_trash_metadata(payload):
        raise ValueError("invalid trash metadata")
    name = _trash_info_name(payload["id"])
    descriptor = os.open(
        name,
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0),
        0o600,
        dir_fd=info_fd,
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", closefd=True) as handle:
            json.dump(payload, handle, separators=(",", ":"), sort_keys=True, allow_nan=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.fsync(info_fd)
    except Exception:
        try:
            os.unlink(name, dir_fd=info_fd)
        except OSError:
            pass
        raise


def _read_trash_metadata(info_fd: int, trash_id: str) -> dict:
    name = _trash_info_name(trash_id)
    descriptor = os.open(
        name,
        os.O_RDONLY
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0),
        dir_fd=info_fd,
    )
    try:
        raw = os.read(descriptor, MAX_TRASH_INFO_BYTES + 1)
        if len(raw) > MAX_TRASH_INFO_BYTES:
            raise ValueError("trash metadata exceeds maximum size")
        payload = json.loads(raw.decode("utf-8", errors="strict"))
    finally:
        os.close(descriptor)
    if not _valid_trash_metadata(payload, trash_id):
        raise ValueError("invalid trash metadata")
    return payload


def _trash_payload_snapshot(files_fd: int, trash_id: str) -> tuple[str, int, int]:
    metadata = os.stat(trash_id, dir_fd=files_fd, follow_symlinks=False)
    if stat.S_ISLNK(metadata.st_mode):
        raise ValueError("trash payload cannot be a symbolic link")
    if stat.S_ISDIR(metadata.st_mode):
        kind = "directory"
        size = 0
    elif stat.S_ISREG(metadata.st_mode):
        kind = "file"
        size = max(0, int(metadata.st_size))
    else:
        raise ValueError("unsupported trash payload kind")
    modified_at = max(0, int(metadata.st_mtime_ns // 1_000_000))
    return kind, size, modified_at


def list_user_trash(user_root: str) -> dict:
    files_fd, info_fd = _trash_directories(user_root)
    entries = []
    try:
        with os.scandir(info_fd) as iterator:
            for item in iterator:
                if item.is_symlink() or not item.is_file(follow_symlinks=False):
                    continue
                if not item.name.endswith(".json"):
                    continue
                trash_id = item.name[:-5]
                if TRASH_ID_RE.fullmatch(trash_id) is None:
                    continue
                try:
                    payload = _read_trash_metadata(info_fd, trash_id)
                    kind, size, modified_at = _trash_payload_snapshot(files_fd, trash_id)
                except (OSError, UnicodeError, ValueError, json.JSONDecodeError):
                    continue
                if payload["kind"] != kind:
                    continue
                entries.append(
                    {
                        "id": trash_id,
                        "name": payload["name"],
                        "kind": kind,
                        "size": size,
                        "modifiedAt": modified_at,
                        "originalPath": payload["originalPath"],
                        "trashedAt": payload["trashedAt"],
                    }
                )
        entries.sort(key=lambda value: (-value["trashedAt"], value["name"].casefold(), value["id"]))
        return {"entries": entries[:MAX_FILE_ENTRIES]}
    finally:
        os.close(info_fd)
        os.close(files_fd)


def trash_user_entry(user_root: str, logical_path: str, name: str) -> dict:
    if not valid_logical_file_path(logical_path) or not valid_file_name(name):
        raise ValueError("invalid trash source")
    source_fd = open_user_directory(user_root, logical_path)
    files_fd = None
    info_fd = None
    metadata_name = None
    try:
        source_meta = os.stat(name, dir_fd=source_fd, follow_symlinks=False)
        if stat.S_ISLNK(source_meta.st_mode):
            raise ValueError("symbolic links cannot be trashed")
        if stat.S_ISDIR(source_meta.st_mode):
            kind = "directory"
            size = 0
        elif stat.S_ISREG(source_meta.st_mode):
            kind = "file"
            size = max(0, int(source_meta.st_size))
        else:
            raise ValueError("unsupported trash source kind")
        modified_at = max(0, int(source_meta.st_mtime_ns // 1_000_000))
        original_path = f"/{name}" if logical_path == "/" else f"{logical_path}/{name}"

        files_fd, info_fd = _trash_directories(user_root)
        trash_id = ""
        for _ in range(16):
            candidate = secrets.token_hex(16)
            try:
                os.stat(candidate, dir_fd=files_fd, follow_symlinks=False)
            except FileNotFoundError:
                try:
                    os.stat(_trash_info_name(candidate), dir_fd=info_fd, follow_symlinks=False)
                except FileNotFoundError:
                    trash_id = candidate
                    break
        if not trash_id:
            raise RuntimeError("could not allocate trash id")

        payload = {
            "schema": "ordax.trash-entry/1",
            "id": trash_id,
            "name": name,
            "kind": kind,
            "size": size,
            "modifiedAt": modified_at,
            "originalPath": original_path,
            "trashedAt": max(0, int(time.time() * 1000)),
        }
        _write_trash_metadata(info_fd, payload)
        metadata_name = _trash_info_name(trash_id)
        try:
            _renameat2_noreplace_between(source_fd, name, files_fd, trash_id)
        except OSError as exc:
            try:
                os.unlink(metadata_name, dir_fd=info_fd)
                os.fsync(info_fd)
            except OSError:
                pass
            if exc.errno == errno.EXDEV:
                raise FileSpaceTrashCrossDeviceError(
                    "trash move crossed a filesystem boundary"
                ) from exc
            raise
        os.fsync(files_fd)
        os.fsync(source_fd)
        return list_user_directory(user_root, logical_path)
    finally:
        if info_fd is not None:
            os.close(info_fd)
        if files_fd is not None:
            os.close(files_fd)
        os.close(source_fd)


def restore_user_trash_entry(user_root: str, trash_id: str) -> dict:
    if not isinstance(trash_id, str) or TRASH_ID_RE.fullmatch(trash_id) is None:
        raise ValueError("invalid trash id")
    files_fd, info_fd = _trash_directories(user_root)
    destination_fd = None
    try:
        payload = _read_trash_metadata(info_fd, trash_id)
        payload_kind, _size, _modified_at = _trash_payload_snapshot(files_fd, trash_id)
        if payload_kind != payload["kind"]:
            raise ValueError("trash payload kind mismatch")
        original_path = payload["originalPath"]
        parent_path, name = original_path.rsplit("/", 1)
        parent_path = parent_path or "/"
        destination_fd = open_user_directory(user_root, parent_path)
        try:
            _renameat2_noreplace_between(files_fd, trash_id, destination_fd, name)
        except OSError as exc:
            if exc.errno == errno.EXDEV:
                raise FileSpaceTrashCrossDeviceError(
                    "trash restore crossed a filesystem boundary"
                ) from exc
            raise
        os.fsync(destination_fd)
        os.fsync(files_fd)
        try:
            os.unlink(_trash_info_name(trash_id), dir_fd=info_fd)
            os.fsync(info_fd)
        except OSError:
            # The user data is already restored. A stale metadata record is
            # harmless because list_user_trash() requires the payload too.
            pass
        return list_user_trash(user_root)
    finally:
        if destination_fd is not None:
            os.close(destination_fd)
        os.close(info_fd)
        os.close(files_fd)


def read_user_text_file(
    user_root: str,
    logical_path: str,
    max_bytes: int = MAX_TEXT_FILE_BYTES,
) -> dict:
    if not valid_logical_file_path(logical_path) or logical_path == "/":
        raise ValueError("invalid text-file path")
    parent_path, name = logical_path.rsplit("/", 1)
    parent_path = parent_path or "/"
    if not valid_file_name(name):
        raise ValueError("invalid text-file name")

    parent_descriptor = open_user_directory(user_root, parent_path)
    descriptor = None
    try:
        descriptor = os.open(
            name,
            os.O_RDONLY
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_CLOEXEC", 0),
            dir_fd=parent_descriptor,
        )
    finally:
        os.close(parent_descriptor)

    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError("text-file preview requires a regular file")
        if metadata.st_size > max_bytes:
            raise FileSpaceTextTooLargeError("text file exceeds preview limit")

        content = bytearray()
        while len(content) <= max_bytes:
            remaining = max_bytes + 1 - len(content)
            chunk = os.read(descriptor, min(65536, remaining))
            if not chunk:
                break
            content.extend(chunk)
            if len(content) > max_bytes:
                raise FileSpaceTextTooLargeError("text file exceeds preview limit")

        try:
            text = bytes(content).decode("utf-8", errors="strict")
        except UnicodeDecodeError as exc:
            raise FileSpaceTextEncodingError("text file is not valid UTF-8") from exc
        if "\0" in text:
            raise FileSpaceTextEncodingError("text file contains NUL bytes")
        return {"path": logical_path, "size": len(content), "text": text}
    finally:
        os.close(descriptor)


def read_user_export_file(
    user_root: str,
    logical_path: str,
    max_bytes: int = MAX_FILE_EXPORT_BYTES,
) -> tuple[str, bytes]:
    if not valid_logical_file_path(logical_path) or logical_path == "/":
        raise ValueError("invalid export path")
    parent_path, name = logical_path.rsplit("/", 1)
    parent_path = parent_path or "/"
    if not valid_file_name(name):
        raise ValueError("invalid export name")

    parent_descriptor = open_user_directory(user_root, parent_path)
    descriptor = None
    try:
        descriptor = os.open(
            name,
            os.O_RDONLY
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_CLOEXEC", 0),
            dir_fd=parent_descriptor,
        )
    finally:
        os.close(parent_descriptor)

    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("file export requires a regular file")
        if before.st_size > max_bytes:
            raise FileSpaceExportTooLargeError("file exceeds export limit")

        content = bytearray()
        while len(content) <= max_bytes:
            remaining = max_bytes + 1 - len(content)
            chunk = os.read(descriptor, min(65536, remaining))
            if not chunk:
                break
            content.extend(chunk)
            if len(content) > max_bytes:
                raise FileSpaceExportTooLargeError("file exceeded export limit during read")

        after = os.fstat(descriptor)
        before_identity = (
            before.st_dev,
            before.st_ino,
            before.st_size,
            before.st_mtime_ns,
            before.st_ctime_ns,
        )
        after_identity = (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
            after.st_ctime_ns,
        )
        if before_identity != after_identity or len(content) != after.st_size:
            raise FileSpaceExportChangedError("file changed while being exported")
        return name, bytes(content)
    finally:
        os.close(descriptor)


def read_user_image_preview(
    user_root: str,
    logical_path: str,
    max_bytes: int = MAX_IMAGE_PREVIEW_BYTES,
) -> tuple[str, str, bytes]:
    if not valid_logical_file_path(logical_path) or logical_path == "/":
        raise ValueError("invalid image preview path")
    requested_name = logical_path.rsplit("/", 1)[-1]
    extension = os.path.splitext(requested_name)[1].lower()
    mime = IMAGE_PREVIEW_TYPES.get(extension)
    if mime is None:
        raise FileSpaceImagePreviewTypeError("unsupported image preview type")

    name, payload = read_user_export_file(
        user_root,
        logical_path,
        max_bytes=max_bytes,
    )
    return name, mime, payload


def read_user_media_preview(
    user_root: str,
    logical_path: str,
    max_bytes: int = MAX_MEDIA_PREVIEW_BYTES,
) -> tuple[str, str, bytes]:
    if not valid_logical_file_path(logical_path) or logical_path == "/":
        raise ValueError("invalid media preview path")
    requested_name = logical_path.rsplit("/", 1)[-1]
    extension = os.path.splitext(requested_name)[1].lower()
    mime = MEDIA_PREVIEW_TYPES.get(extension)
    if mime is None:
        raise FileSpaceMediaPreviewTypeError("unsupported media preview type")

    name, payload = read_user_export_file(
        user_root,
        logical_path,
        max_bytes=max_bytes,
    )
    return name, mime, payload


def read_user_document_preview(
    user_root: str,
    logical_path: str,
    max_bytes: int = MAX_DOCUMENT_PREVIEW_BYTES,
) -> tuple[str, str, bytes]:
    if not valid_logical_file_path(logical_path) or logical_path == "/":
        raise ValueError("invalid document preview path")
    requested_name = logical_path.rsplit("/", 1)[-1]
    extension = os.path.splitext(requested_name)[1].lower()
    mime = DOCUMENT_PREVIEW_TYPES.get(extension)
    if mime is None:
        raise FileSpaceDocumentPreviewTypeError("unsupported document preview type")

    name, payload = read_user_export_file(
        user_root,
        logical_path,
        max_bytes=max_bytes,
    )
    return name, mime, payload


def import_user_file(
    user_root: str,
    logical_path: str,
    name: str,
    source,
    length: int,
    max_bytes: int = MAX_FILE_IMPORT_BYTES,
) -> dict:
    if not valid_logical_file_path(logical_path):
        raise ValueError("invalid import directory path")
    if not valid_file_name(name):
        raise ValueError("invalid import name")
    if isinstance(length, bool) or not isinstance(length, int) or length < 0:
        raise ValueError("invalid import length")
    if length > max_bytes:
        raise FileSpaceImportTooLargeError("import exceeds size limit")

    directory_fd = open_user_directory(user_root, logical_path)
    destination_fd = None
    destination_created = False
    try:
        destination_fd = os.open(
            name,
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_CLOEXEC", 0),
            0o600,
            dir_fd=directory_fd,
        )
        destination_created = True

        remaining = length
        while remaining > 0:
            chunk = source.read(min(65536, remaining))
            if not chunk:
                raise FileSpaceImportIncompleteError(
                    "import body ended before declared content length"
                )
            if len(chunk) > remaining:
                chunk = chunk[:remaining]

            view = memoryview(chunk)
            while view:
                written = os.write(destination_fd, view)
                if written <= 0:
                    raise OSError(errno.EIO, "import write made no progress")
                view = view[written:]
            remaining -= len(chunk)

        os.fsync(destination_fd)
        os.close(destination_fd)
        destination_fd = None
        os.fsync(directory_fd)
        return list_user_directory(user_root, logical_path)
    except Exception:
        if destination_fd is not None:
            os.close(destination_fd)
            destination_fd = None
        if destination_created:
            try:
                os.unlink(name, dir_fd=directory_fd)
                os.fsync(directory_fd)
            except FileNotFoundError:
                pass
        raise
    finally:
        if destination_fd is not None:
            os.close(destination_fd)
        os.close(directory_fd)


def _file_identity(metadata) -> tuple[int, int, int, int, int]:
    return (
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_size,
        metadata.st_mtime_ns,
        metadata.st_ctime_ns,
    )


def _remove_copy_destination(destination_directory_fd: int, name: str) -> None:
    try:
        os.unlink(name, dir_fd=destination_directory_fd)
    except FileNotFoundError:
        return
    os.fsync(destination_directory_fd)


def _copy_open_regular_file(
    source_fd: int,
    source_before,
    destination_directory_fd: int,
    new_name: str,
    max_bytes: int = MAX_FILE_COPY_BYTES,
):
    if not stat.S_ISREG(source_before.st_mode):
        raise ValueError("file copy requires a regular source file")
    if source_before.st_size > max_bytes:
        raise FileSpaceCopyTooLargeError("source file exceeds copy limit")

    destination_fd = None
    destination_created = False
    try:
        destination_fd = os.open(
            new_name,
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_CLOEXEC", 0),
            0o600,
            dir_fd=destination_directory_fd,
        )
        destination_created = True

        copied = 0
        while True:
            remaining = max_bytes + 1 - copied
            chunk = os.read(source_fd, min(65536, remaining))
            if not chunk:
                break
            copied += len(chunk)
            if copied > max_bytes:
                raise FileSpaceCopyTooLargeError(
                    "source file exceeded copy limit during read"
                )

            view = memoryview(chunk)
            while view:
                written = os.write(destination_fd, view)
                if written <= 0:
                    raise OSError(errno.EIO, "copy write made no progress")
                view = view[written:]

        source_after = os.fstat(source_fd)
        if (
            _file_identity(source_before) != _file_identity(source_after)
            or copied != source_after.st_size
        ):
            raise FileSpaceCopyChangedError("source changed while being copied")

        os.fsync(destination_fd)
        os.close(destination_fd)
        destination_fd = None
        os.fsync(destination_directory_fd)
        return source_after
    except Exception:
        if destination_fd is not None:
            os.close(destination_fd)
            destination_fd = None
        if destination_created:
            _remove_copy_destination(destination_directory_fd, new_name)
        raise
    finally:
        if destination_fd is not None:
            os.close(destination_fd)


def _renameat2_noreplace_between(
    source_directory_fd: int,
    old_name: str,
    destination_directory_fd: int,
    new_name: str,
) -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    renameat2 = getattr(libc, "renameat2", None)
    if renameat2 is None:
        raise OSError(errno.ENOSYS, "renameat2 is unavailable")
    renameat2.argtypes = [
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_uint,
    ]
    renameat2.restype = ctypes.c_int
    result = renameat2(
        source_directory_fd,
        os.fsencode(old_name),
        destination_directory_fd,
        os.fsencode(new_name),
        RENAME_NOREPLACE,
    )
    if result == 0:
        return
    error_number = ctypes.get_errno()
    if error_number == errno.EEXIST:
        raise FileExistsError(error_number, os.strerror(error_number), new_name)
    raise OSError(error_number, os.strerror(error_number), new_name)


def _renameat2_noreplace(directory_fd: int, old_name: str, new_name: str) -> None:
    _renameat2_noreplace_between(directory_fd, old_name, directory_fd, new_name)


def rename_user_entry(
    user_root: str,
    logical_path: str,
    name: str,
    new_name: str,
) -> dict:
    if not valid_logical_file_path(logical_path):
        raise ValueError("invalid rename directory path")
    if not valid_file_name(name) or not valid_file_name(new_name):
        raise ValueError("invalid rename name")
    if name == new_name:
        return list_user_directory(user_root, logical_path)

    descriptor = open_user_directory(user_root, logical_path)
    try:
        metadata = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
        if stat.S_ISLNK(metadata.st_mode):
            raise ValueError("symbolic links cannot be renamed through file-space")
        if not (stat.S_ISREG(metadata.st_mode) or stat.S_ISDIR(metadata.st_mode)):
            raise ValueError("unsupported file-space entry kind")
        _renameat2_noreplace(descriptor, name, new_name)
    finally:
        os.close(descriptor)
    return list_user_directory(user_root, logical_path)


def move_user_entry(
    user_root: str,
    source_path: str,
    name: str,
    destination_path: str,
    max_bytes: int = MAX_FILE_COPY_BYTES,
) -> dict:
    if not valid_logical_file_path(source_path):
        raise ValueError("invalid move source path")
    if not valid_logical_file_path(destination_path):
        raise ValueError("invalid move destination path")
    if not valid_file_name(name):
        raise ValueError("invalid move name")
    if source_path == destination_path:
        return list_user_directory(user_root, source_path)

    source_entry_path = (
        f"/{name}" if source_path == "/" else f"{source_path}/{name}"
    )
    if (
        destination_path == source_entry_path
        or destination_path.startswith(f"{source_entry_path}/")
    ):
        raise ValueError("cannot move a directory into itself")

    source_directory_fd = open_user_directory(user_root, source_path)
    destination_directory_fd = None
    source_fd = None
    try:
        metadata = os.stat(name, dir_fd=source_directory_fd, follow_symlinks=False)
        if stat.S_ISLNK(metadata.st_mode):
            raise ValueError("symbolic links cannot be moved through file-space")
        if not (stat.S_ISREG(metadata.st_mode) or stat.S_ISDIR(metadata.st_mode)):
            raise ValueError("unsupported file-space entry kind")

        source_before = None
        if stat.S_ISREG(metadata.st_mode):
            source_fd = os.open(
                name,
                os.O_RDONLY
                | getattr(os, "O_NOFOLLOW", 0)
                | getattr(os, "O_CLOEXEC", 0),
                dir_fd=source_directory_fd,
            )
            source_before = os.fstat(source_fd)
            if _file_identity(source_before)[:2] != _file_identity(metadata)[:2]:
                raise FileSpaceCopyChangedError(
                    "source changed while preparing cross-device move"
                )

        destination_directory_fd = open_user_directory(user_root, destination_path)
        try:
            _renameat2_noreplace_between(
                source_directory_fd,
                name,
                destination_directory_fd,
                name,
            )
        except OSError as exc:
            if exc.errno != errno.EXDEV:
                raise
            if source_fd is None or source_before is None:
                raise FileSpaceCrossDeviceMoveError(
                    "cross-device directory move is not supported"
                ) from exc

            source_after = _copy_open_regular_file(
                source_fd,
                source_before,
                destination_directory_fd,
                name,
                max_bytes=max_bytes,
            )
            current = os.stat(
                name,
                dir_fd=source_directory_fd,
                follow_symlinks=False,
            )
            if _file_identity(current) != _file_identity(source_after):
                _remove_copy_destination(destination_directory_fd, name)
                raise FileSpaceCopyChangedError(
                    "source path changed before cross-device move commit"
                )

            try:
                os.unlink(name, dir_fd=source_directory_fd)
            except Exception:
                _remove_copy_destination(destination_directory_fd, name)
                raise
            try:
                os.fsync(source_directory_fd)
            except OSError:
                # The destination is already durable and the source name is gone.
                # Do not delete the only remaining copy merely because directory
                # durability could not be confirmed by this filesystem.
                pass
        else:
            os.fsync(destination_directory_fd)
            os.fsync(source_directory_fd)
    finally:
        if source_fd is not None:
            os.close(source_fd)
        if destination_directory_fd is not None:
            os.close(destination_directory_fd)
        os.close(source_directory_fd)

    return list_user_directory(user_root, destination_path)


def copy_user_file(
    user_root: str,
    source_path: str,
    name: str,
    destination_path: str,
    new_name: str,
    max_bytes: int = MAX_FILE_COPY_BYTES,
) -> dict:
    if not valid_logical_file_path(source_path):
        raise ValueError("invalid copy source path")
    if not valid_logical_file_path(destination_path):
        raise ValueError("invalid copy destination path")
    if not valid_file_name(name) or not valid_file_name(new_name):
        raise ValueError("invalid copy name")
    if source_path == destination_path and name == new_name:
        raise FileExistsError(errno.EEXIST, os.strerror(errno.EEXIST), new_name)

    source_directory_fd = open_user_directory(user_root, source_path)
    destination_directory_fd = None
    source_fd = None
    try:
        source_fd = os.open(
            name,
            os.O_RDONLY
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_CLOEXEC", 0),
            dir_fd=source_directory_fd,
        )
        source_before = os.fstat(source_fd)

        destination_directory_fd = open_user_directory(user_root, destination_path)
        _copy_open_regular_file(
            source_fd,
            source_before,
            destination_directory_fd,
            new_name,
            max_bytes=max_bytes,
        )
    finally:
        if source_fd is not None:
            os.close(source_fd)
        if destination_directory_fd is not None:
            os.close(destination_directory_fd)
        os.close(source_directory_fd)

    return list_user_directory(user_root, destination_path)


def create_user_directory(user_root: str, logical_path: str, name: str) -> dict:
    if not valid_file_name(name):
        raise ValueError("invalid directory name")
    descriptor = open_user_directory(user_root, logical_path)
    try:
        os.mkdir(name, mode=0o700, dir_fd=descriptor)
    finally:
        os.close(descriptor)
    return list_user_directory(user_root, logical_path)


def ensure_standard_user_directories(user_root: str) -> tuple[str, ...]:
    descriptor = open_user_directory(user_root, "/")
    ready = []
    try:
        for name in STANDARD_USER_DIRECTORIES:
            try:
                os.mkdir(name, mode=0o700, dir_fd=descriptor)
            except FileExistsError:
                try:
                    child = os.open(name, _directory_open_flags(), dir_fd=descriptor)
                except OSError:
                    continue
                else:
                    os.close(child)
            ready.append(name)
    finally:
        os.close(descriptor)
    return tuple(ready)


def requested_profile_content_parameters(request_target: str) -> tuple[str, str | None]:
    parsed = urlsplit(request_target)
    if parsed.path != PROFILE_CONTENT_CONTEXT_PATH or parsed.fragment:
        raise ValueError("not a Profile content context request")
    query = parse_qs(parsed.query, keep_blank_values=True, strict_parsing=True)
    if not set(query).issubset({"spaceId", "query"}) or set(query) == set():
        raise ValueError("Profile content context query fields are invalid")
    if len(query.get("spaceId", [])) != 1 or len(query.get("query", [])) > 1:
        raise ValueError("Profile content context requires one Space and at most one query")
    space_id = query["spaceId"][0].strip()
    if not space_id or len(space_id) > 160 or "\0" in space_id:
        raise ValueError("Profile content context Space id is invalid")
    relevance_query = query.get("query", [None])[0]
    if relevance_query is not None:
        relevance_query = relevance_query.strip()
        if not relevance_query or len(relevance_query) > 256 or "\0" in relevance_query:
            raise ValueError("Profile content retrieval query is invalid")
    return space_id, relevance_query


def requested_profile_content_space_id(request_target: str) -> str:
    # Retained read-only helper for existing Native callers.
    return requested_profile_content_parameters(request_target)[0]


def requested_file_path(request_target: str, endpoint: str = FILES_PATH) -> str:
    parsed = urlsplit(request_target)
    if parsed.path != endpoint:
        raise ValueError("not a file-space request")
    query = parse_qs(parsed.query, keep_blank_values=True, strict_parsing=True)
    if set(query) != {"path"} or len(query["path"]) != 1:
        raise ValueError("file-space request requires exactly one path")
    logical_path = query["path"][0]
    if not valid_logical_file_path(logical_path):
        raise ValueError("invalid file-space path")
    return logical_path


def requested_file_import_target(request_target: str) -> tuple[str, str]:
    parsed = urlsplit(request_target)
    if parsed.path != FILE_IMPORT_PATH:
        raise ValueError("not a file import request")
    query = parse_qs(parsed.query, keep_blank_values=True, strict_parsing=True)
    if set(query) != {"path", "name"}:
        raise ValueError("file import requires path and name")
    if len(query["path"]) != 1 or len(query["name"]) != 1:
        raise ValueError("file import requires one path and one name")
    logical_path = query["path"][0]
    name = query["name"][0]
    if not valid_logical_file_path(logical_path) or not valid_file_name(name):
        raise ValueError("invalid file import target")
    return logical_path, name


def valid_surface_heartbeat_payload(value: object) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == {"sourceSha"}
        and valid_commit_sha(value.get("sourceSha"))
    )


def record_surface_heartbeat(source_sha: str) -> None:
    if not valid_commit_sha(source_sha):
        raise ValueError("invalid Surface heartbeat SHA")
    directory = os.path.dirname(SURFACE_HEARTBEAT_FILE)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    temporary = f"{SURFACE_HEARTBEAT_FILE}.tmp.{os.getpid()}.{threading.get_ident()}"
    boot_id = read_small_text(BOOT_ID_FILE, 128)
    if len(boot_id) != 32 or any(
        character not in "0123456789abcdef" for character in boot_id
    ):
        raise ValueError("invalid current boot id")
    payload = {
        "sourceSha": source_sha,
        "bootId": boot_id,
        "observedEpoch": max(0, int(time.time())),
    }
    try:
        with open(temporary, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, separators=(",", ":"), sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, SURFACE_HEARTBEAT_FILE)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def record_surface_health(source_sha: str) -> None:
    directory = os.path.dirname(HEALTH_STATE_FILE)
    os.makedirs(directory, exist_ok=True)
    temporary = f"{HEALTH_STATE_FILE}.tmp.{os.getpid()}.{threading.get_ident()}"
    with open(temporary, "w", encoding="utf-8") as handle:
        handle.write(source_sha)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, HEALTH_STATE_FILE)


class ProfileConsentUnavailableError(RuntimeError):
    pass


class NativeHostServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        server_address,
        handler_class,
        *,
        user_root: str,
        power_request_path: str,
        network_session_dir: str,
        product_mode: str | None = None,
        distribution_profile: str = "owner-development",
        native_install_capability: str = "disabled",
        component_channel_bin: str = DEFAULT_COMPONENT_CHANNEL_BIN,
        component_trust_path: str = DEFAULT_COMPONENT_TRUST_PATH,
        component_slot_root: str = DEFAULT_COMPONENT_SLOT_ROOT,
        store_catalog_envelope_path: str = DEFAULT_STORE_CATALOG_ENVELOPE_PATH,
        store_catalog_watermark_path: str = DEFAULT_STORE_CATALOG_WATERMARK_PATH,
        store_catalog_base_origin: str = "",
        store_artifact_root: str = DEFAULT_STORE_ARTIFACT_ROOT,
        store_artifact_base_origin: str = "",
        account_gateway_origin: str = "",
    ):
        super().__init__(server_address, handler_class)
        self.power_token = secrets.token_urlsafe(32)
        self.network_token = secrets.token_urlsafe(32)
        self.diagnostic_token = secrets.token_urlsafe(32)
        self.health_token = secrets.token_urlsafe(32)
        self.power_request_path = power_request_path
        self.supported_actions = supported_power_actions(power_request_path)
        self.network_paths = network_broker_paths(network_session_dir)
        self.network_lock = threading.Lock()
        self.native_install_paths = native_install_broker_paths(network_session_dir)
        self.native_install_lock = threading.Lock()
        self.file_trash_lock = threading.Lock()
        self.local_session_lock = threading.Lock()
        self.local_session_locked = os.path.isfile(LOCAL_SESSION_CREDENTIAL_FILE)
        self.local_session_failures = 0
        self.local_session_retry_after = 0.0
        self.user_root = user_root
        self.product_mode = product_mode if product_mode in {"usb", "native-disk"} else None
        self.distribution_profile = (
            distribution_profile
            if distribution_profile in {"owner-development", "stable-mvp"}
            else "unknown"
        )
        self.native_install_capability = (
            native_install_capability
            if native_install_capability in {"disabled", "post-mvp-preview"}
            else "disabled"
        )
        self.native_install_available = (
            self.distribution_profile == "owner-development"
            and self.native_install_capability == "post-mvp-preview"
            and self.product_mode == "usb"
            and native_install_broker_available(self.native_install_paths)
        )
        self.native_install_token = (
            secrets.token_urlsafe(32) if self.native_install_available else ""
        )
        self.profile_activation_available = self.distribution_profile in {"owner-development", "stable-mvp"}
        self.profile_activation_token = (
            secrets.token_urlsafe(32) if self.profile_activation_available else ""
        )
        self.profile_activation_lock = threading.Lock()
        self.profile_human_consent_authority = (
            ProfileHumanConsentAuthority()
            if self.profile_activation_available
            else None
        )
        self.profile_human_consent_coordinator = (
            ProfileHumanConsentCoordinator(self.profile_human_consent_authority)
            if self.profile_human_consent_authority is not None
            else None
        )
        self.component_channel_bin = component_channel_bin
        self.component_trust_path = component_trust_path
        self.component_slot_root = component_slot_root
        self.component_slot_lock = threading.Lock()
        self.store_catalog_envelope_path = store_catalog_envelope_path
        self.store_catalog_watermark_path = store_catalog_watermark_path
        self.store_catalog_base_origin = (
            normalize_catalog_base_origin(store_catalog_base_origin)
            if store_catalog_base_origin
            else ""
        )
        self.store_catalog_lock = threading.Lock()
        self.store_lifecycle_lock = threading.Lock()
        self.store_artifact_root = store_artifact_root
        self.store_artifact_base_origin = (
            normalize_https_base_origin(store_artifact_base_origin)
            if store_artifact_base_origin
            else ""
        )
        self.component_slot_read_available = component_slot_reader_available(
            helper_path=self.component_channel_bin,
            trust_path=self.component_trust_path,
            distribution_profile=self.distribution_profile,
            product_mode=self.product_mode,
        )
        self.account_gateway = None
        if account_gateway_origin:
            try:
                self.account_gateway = NativeAccountGateway(
                    account_gateway_origin,
                    ACCOUNT_SESSION_FILE,
                )
            except (TypeError, ValueError):
                self.account_gateway = None

    def resolve_profile_human_consent(
        self,
        *,
        permission_diff: dict,
        permission_diff_sha256: str,
        expected_revision: int,
        space_id: str,
        space_kind: str,
        profile: dict,
    ) -> dict:
        coordinator = self.profile_human_consent_coordinator
        if coordinator is None:
            raise ProfileConsentUnavailableError("Native Profile consent coordinator is unavailable")
        request = coordinator.prepare(
            permission_diff=permission_diff,
            permission_diff_sha256=permission_diff_sha256,
            expected_revision=expected_revision,
            space_id=space_id,
            space_kind=space_kind,
            profile=profile,
        )
        try:
            decision = request_native_decision(request)
        except (ConnectionError, OSError, TimeoutError, TypeError, ValueError, PermissionError) as exc:
            try:
                coordinator.decide({
                    "schema": "ordax.profile-human-consent-decision/1",
                    "requestId": request["requestId"],
                    "approved": False,
                })
            except (PermissionError, ValueError):
                pass
            raise ProfileConsentUnavailableError(
                "Trusted Native Profile consent presenter is unavailable"
            ) from exc
        receipt = coordinator.decide(decision)
        if receipt is None:
            raise PermissionError("Profile activation was rejected by the user")
        return receipt


class NativeHostHandler(SimpleHTTPRequestHandler):
    server_version = "OrdaXNativeHost/1"

    def _request_is_trusted(self) -> bool:
        if request_is_trusted(self.headers, self.server.server_address, self.path):
            return True
        self._empty(403)
        return False

    def end_headers(self) -> None:
        if not urlsplit(self.path).path.startswith("/__ordax/native/"):
            self.send_header("Cache-Control", "no-store, max-age=0")
            self.send_header("Pragma", "no-cache")
        super().end_headers()

    def _write_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _write_download(self, name: str, payload: bytes) -> None:
        encoded_name = quote(name, safe="")
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{encoded_name}")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(payload)

    def _write_image_preview(self, mime: str, payload: bytes) -> None:
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(payload)

    def _write_media_preview(self, mime: str, payload: bytes) -> None:
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(payload)

    def _write_document_preview(self, mime: str, payload: bytes) -> None:
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(payload)

    def _empty(self, status: int) -> None:
        self.send_response(status)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def _read_json_body(self, max_bytes: int = MAX_CONTROL_BODY) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if length <= 0 or length > max_bytes:
            return None
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            return None
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None
        return payload if isinstance(payload, dict) else None

    def _read_account_credentials(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if length <= 0 or length > MAX_ACCOUNT_CREDENTIAL_BODY:
            return None
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        try:
            raw = self.rfile.read(length).decode("utf-8")
            if content_type == "application/json":
                payload = json.loads(raw)
                return payload if isinstance(payload, dict) else None
            if content_type == "application/x-www-form-urlencoded":
                parsed = parse_qs(raw, keep_blank_values=True, strict_parsing=False)
                return {
                    key: values[-1]
                    for key, values in parsed.items()
                    if values
                }
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
            return None
        return None

    def do_OPTIONS(self) -> None:  # noqa: N802
        if not self._request_is_trusted():
            return
        if self.path.startswith("/__ordax/native/"):
            self._empty(403)
            return
        # Deliberately no CORS headers. Cross-origin callers cannot use the
        # native control/state APIs through browser preflight.
        self._empty(405)

    def do_GET(self) -> None:  # noqa: N802
        if not self._request_is_trusted():
            return
        parsed_path = urlsplit(self.path).path
        if parsed_path in {ACCOUNT_SESSION_PATH, ACCOUNT_REGISTRATION_POLICY_PATH, ACCOUNT_EXPORT_PATH, ACCOUNT_SPACES_PATH, ACCOUNT_MEMORY_ENTITLEMENT_PATH, ACCOUNT_SYNC_OBJECTS_PATH, ACCOUNT_SYNC_SNAPSHOT_PATH, ACCOUNT_SYNC_CHANGES_PATH}:
            if self.client_address[0] != "127.0.0.1":
                self._empty(403)
                return
            if parsed_path == ACCOUNT_MEMORY_ENTITLEMENT_PATH and urlsplit(self.path).query:
                self._empty(400)
                return
            if self.server.account_gateway is None:
                if parsed_path == ACCOUNT_SESSION_PATH:
                    self._write_json(200, {
                        "$schema": "prototype-ordax.public-identity-session/1",
                        "authenticated": False,
                        "provider": "unconfigured",
                        "status": "anonymous",
                        "accountCloseEnabled": False,
                    })
                else:
                    self._empty(503)
                return
            try:
                if parsed_path == ACCOUNT_MEMORY_ENTITLEMENT_PATH:
                    reply = read_native_memory_cloud_entitlement(self.server.account_gateway)
                    if reply.payload is None:
                        self._empty(reply.status)
                        return
                    self._write_json(reply.status, reply.payload)
                    return
                if parsed_path == ACCOUNT_SESSION_PATH:
                    reply = self.server.account_gateway.session()
                elif parsed_path == ACCOUNT_REGISTRATION_POLICY_PATH:
                    reply = self.server.account_gateway.registration_policy()
                elif parsed_path == ACCOUNT_EXPORT_PATH:
                    reply = self.server.account_gateway.account_export()
                elif parsed_path == ACCOUNT_SPACES_PATH:
                    reply = self.server.account_gateway.spaces()
                elif parsed_path == ACCOUNT_SYNC_SNAPSHOT_PATH:
                    reply = self.server.account_gateway.sync_snapshot(urlsplit(self.path).query)
                elif parsed_path == ACCOUNT_SYNC_CHANGES_PATH:
                    reply = self.server.account_gateway.pull_sync_changes(urlsplit(self.path).query)
                else:
                    reply = self.server.account_gateway.list_sync_objects(urlsplit(self.path).query)
                if not reply.body:
                    self._empty(reply.status)
                    return
                payload = json.loads(reply.body.decode("utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError("gateway JSON object required")
                if parsed_path == ACCOUNT_REGISTRATION_POLICY_PATH:
                    payload["registrationEnabled"] = bool(
                        payload.get("registrationEnabled") is True
                        and ACCOUNT_REGISTRATION_ENABLED
                    )
            except NativeMemoryEntitlementProxyError:
                self._empty(503)
                return
            except (NativeAccountGatewayError, UnicodeError, json.JSONDecodeError, ValueError):
                self._empty(503)
                return
            self._write_json(reply.status, payload)
            return
        if parsed_path in {SESSION_PATH, MEMORY_PATH, FILES_PATH, TRASH_PATH, FILE_CONTENT_PATH, FILE_EXPORT_PATH, IMAGE_PREVIEW_PATH, MEDIA_PREVIEW_PATH, DOCUMENT_PREVIEW_PATH, METRICS_PATH, RECOVERY_STATUS_PATH, POWER_STATUS_PATH, HARDWARE_INVENTORY_PATH, NETWORK_STATUS_PATH, NETWORK_MANAGEMENT_PATH, KEYBOARD_LAYOUT_PATH, NATIVE_INSTALL_TARGETS_PATH, COMPONENT_RUNTIME_PATH, STORE_CATALOG_PATH, UPDATE_HISTORY_PATH, DIAGNOSTIC_JOURNAL_PATH} and self.client_address[0] != "127.0.0.1":
            self._empty(403)
            return
        if parsed_path.startswith(COMPONENT_MODULE_PREFIX) and self.client_address[0] != "127.0.0.1":
            self._empty(403)
            return
        if parsed_path in {SYNC_STATE_PATH, SYNC_CHECKPOINT_PATH, COMPONENT_STATE_PATH, PROFILE_COMPONENT_INVENTORY_PATH, PROFILE_CONTENT_CONTEXT_PATH, PROFILE_CONTENT_CONTEXT_CAPABILITY_PATH, FIRST_RUN_PATH, DEVICE_PROFILE_PATH, LOCAL_SESSION_PATH} and self.client_address[0] != "127.0.0.1":
            self._empty(403)
            return
        if parsed_path == METRICS_PATH:
            try:
                metrics = read_system_metrics(self.server.user_root)
            except (OSError, ValueError) as exc:
                print(f"ordax-native-host: could not read system metrics: {exc}", file=sys.stderr, flush=True)
                self._empty(503)
                return
            self._write_json(200, metrics)
            return
        if parsed_path == RECOVERY_STATUS_PATH:
            try:
                recovery_status = read_recovery_status()
            except (OSError, ValueError) as exc:
                print(
                    f"ordax-native-host: recovery status unavailable: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._empty(503)
                return
            self._write_json(200, recovery_status)
            return
        if parsed_path == POWER_STATUS_PATH:
            try:
                power_status = read_power_status()
            except (OSError, ValueError) as exc:
                print(f"ordax-native-host: could not read power status: {exc}", file=sys.stderr, flush=True)
                self._empty(503)
                return
            self._write_json(200, power_status)
            return
        if parsed_path == HARDWARE_INVENTORY_PATH:
            try:
                hardware_inventory = read_hardware_inventory()
            except (OSError, ValueError) as exc:
                print(
                    f"ordax-native-host: could not read hardware inventory: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._empty(503)
                return
            self._write_json(200, hardware_inventory)
            return
        if parsed_path == NETWORK_STATUS_PATH:
            try:
                network_status = read_network_status()
            except (OSError, ValueError) as exc:
                print(f"ordax-native-host: could not read network status: {exc}", file=sys.stderr, flush=True)
                self._empty(503)
                return
            self._write_json(200, network_status)
            return
        if parsed_path == NETWORK_MANAGEMENT_PATH:
            supplied_token = self.headers.get(NETWORK_TOKEN_HEADER, "")
            if not hmac.compare_digest(supplied_token, self.server.network_token):
                self._empty(403)
                return
            try:
                with self.server.network_lock:
                    snapshot = queue_network_broker_request(
                        self.server.network_paths,
                        "status",
                        timeout_seconds=4.0,
                    )
            except (FileNotFoundError, PermissionError, TimeoutError, OSError, RuntimeError, ValueError) as exc:
                print(f"ordax-native-host: network management status unavailable: {exc}", file=sys.stderr, flush=True)
                self._empty(503)
                return
            self._write_json(200, snapshot)
            return
        if parsed_path == NATIVE_INSTALL_TARGETS_PATH:
            if self.server.product_mode != "usb" or not self.server.native_install_available:
                self._empty(404)
                return
            supplied_token = self.headers.get(NATIVE_INSTALL_TOKEN_HEADER, "")
            if not hmac.compare_digest(supplied_token, self.server.native_install_token):
                self._empty(403)
                return
            try:
                with self.server.native_install_lock:
                    snapshot = queue_native_install_broker_request(
                        self.server.native_install_paths,
                        timeout_seconds=6.0,
                    )
            except (FileNotFoundError, PermissionError, TimeoutError, OSError, RuntimeError, ValueError) as exc:
                print(f"ordax-native-host: Native install discovery unavailable: {exc}", file=sys.stderr, flush=True)
                self._empty(503)
                return
            self._write_json(200, snapshot)
            return
        if parsed_path.startswith(COMPONENT_MODULE_PREFIX):
            if not self.server.component_slot_read_available:
                self._empty(404)
                return
            if urlsplit(self.path).query:
                self._empty(400)
                return
            try:
                request = parse_component_module_path(parsed_path)
                with self.server.component_slot_lock:
                    payload = read_component_runtime_file(
                        helper_path=self.server.component_channel_bin,
                        trust_path=self.server.component_trust_path,
                        component_id=request.component_id,
                        state=request.state,
                        version=request.version,
                        source_commit=request.source_commit,
                        requested_path=request.requested_path,
                        slot_root=self.server.component_slot_root,
                    )
            except ComponentSlotRequestError:
                self._empty(400)
                return
            except ComponentSlotUnavailableError as exc:
                print(
                    f"ordax-native-host: component slot reader unavailable: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._empty(503)
                return
            except ComponentSlotVerificationError as exc:
                print(
                    f"ordax-native-host: component slot verification failed safely: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._empty(409)
                return

            mime = "application/octet-stream"
            if request.requested_path.endswith((".mjs", ".js")):
                mime = "text/javascript; charset=utf-8"
            elif request.requested_path.endswith(".css"):
                mime = "text/css; charset=utf-8"
            elif request.requested_path.endswith(".json"):
                mime = "application/json; charset=utf-8"

            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(payload)
            return

        if parsed_path == STORE_CATALOG_PATH:
            if urlsplit(self.path).query:
                self._empty(400)
                return
            try:
                with self.server.store_catalog_lock:
                    if self.server.store_catalog_base_origin:
                        try:
                            acquire_and_promote_store_catalog(
                                base_origin=self.server.store_catalog_base_origin,
                                helper_path=Path(self.server.component_channel_bin),
                                trust_path=Path(self.server.component_trust_path),
                                envelope_path=Path(self.server.store_catalog_envelope_path),
                                watermark_path=Path(self.server.store_catalog_watermark_path),
                            )
                        except StoreCatalogAcquisitionError as exc:
                            print(
                                f"ordax-native-host: remote Store catalog refresh failed closed; retaining local catalog: {exc}",
                                file=sys.stderr,
                                flush=True,
                            )
                    snapshot = read_native_store_catalog_snapshot(
                        helper_path=Path(self.server.component_channel_bin),
                        trust_path=Path(self.server.component_trust_path),
                        envelope_path=Path(self.server.store_catalog_envelope_path),
                        watermark_path=Path(self.server.store_catalog_watermark_path),
                    )
            except StoreCatalogError as exc:
                print(
                    f"ordax-native-host: Store catalog read failed closed: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._write_json(
                    200,
                    {
                        "schema": "ordax.verified-app-store-catalog/1",
                        "state": "unavailable",
                        "sequence": None,
                        "catalogSha256": None,
                        "source": None,
                        "trust": None,
                        "entries": [],
                        "reason": "native-store-catalog-unavailable",
                        "authority": "none",
                    },
                )
                return
            self._write_json(200, snapshot)
            return

        if parsed_path == COMPONENT_RUNTIME_PATH:
            if not self.server.component_slot_read_available:
                self._empty(404)
                return
            try:
                query = parse_qs(
                    urlsplit(self.path).query,
                    keep_blank_values=True,
                    strict_parsing=True,
                )
            except ValueError:
                self._empty(400)
                return
            if set(query) != {"component", "state"}:
                self._empty(400)
                return
            if any(len(values) != 1 for values in query.values()):
                self._empty(400)
                return
            component_id = query["component"][0]
            state = query["state"][0]
            try:
                with self.server.component_slot_lock:
                    resolution = resolve_component_slot(
                        helper_path=self.server.component_channel_bin,
                        trust_path=self.server.component_trust_path,
                        component_id=component_id,
                        state=state,
                        slot_root=self.server.component_slot_root,
                    )
            except ComponentSlotRequestError:
                self._empty(400)
                return
            except ComponentSlotUnavailableError as exc:
                print(
                    f"ordax-native-host: component slot reader unavailable: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._empty(503)
                return
            except ComponentSlotVerificationError as exc:
                print(
                    f"ordax-native-host: component slot verification failed safely: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._empty(409)
                return
            self._write_json(
                200,
                {
                    "componentId": resolution.component_id,
                    "state": resolution.state,
                    "source": resolution.source,
                    "revision": resolution.revision,
                    "version": resolution.version,
                    "sourceCommit": resolution.source_commit,
                    "entrypoint": resolution.entrypoint,
                    "pendingHealth": resolution.pending_health,
                },
            )
            return

        if parsed_path == UPDATE_HISTORY_PATH:
            self._write_json(200, read_update_history())
            return
        if parsed_path == TRASH_PATH:
            try:
                with self.server.file_trash_lock:
                    trash = list_user_trash(self.server.user_root)
            except (OSError, UnicodeError, ValueError) as exc:
                print(
                    f"ordax-native-host: could not read user trash safely: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._empty(503)
                return
            self._write_json(200, trash)
            return
        if parsed_path == IMAGE_PREVIEW_PATH:
            try:
                logical_path = requested_file_path(self.path, IMAGE_PREVIEW_PATH)
                _name, mime, payload = read_user_image_preview(
                    self.server.user_root,
                    logical_path,
                )
            except FileSpaceExportTooLargeError:
                self._empty(413)
                return
            except FileSpaceExportChangedError:
                self._empty(412)
                return
            except FileSpaceImagePreviewTypeError:
                self._empty(415)
                return
            except ValueError:
                self._empty(400)
                return
            except (FileNotFoundError, NotADirectoryError):
                self._empty(404)
                return
            except PermissionError:
                self._empty(403)
                return
            except OSError as exc:
                print(f"ordax-native-host: could not preview user image: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._write_image_preview(mime, payload)
            return

        if parsed_path == MEDIA_PREVIEW_PATH:
            try:
                logical_path = requested_file_path(self.path, MEDIA_PREVIEW_PATH)
                _name, mime, payload = read_user_media_preview(
                    self.server.user_root,
                    logical_path,
                )
            except FileSpaceExportTooLargeError:
                self._empty(413)
                return
            except FileSpaceExportChangedError:
                self._empty(412)
                return
            except FileSpaceMediaPreviewTypeError:
                self._empty(415)
                return
            except ValueError:
                self._empty(400)
                return
            except (FileNotFoundError, NotADirectoryError):
                self._empty(404)
                return
            except PermissionError:
                self._empty(403)
                return
            except OSError as exc:
                print(f"ordax-native-host: could not preview user media: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._write_media_preview(mime, payload)
            return

        if parsed_path == DOCUMENT_PREVIEW_PATH:
            try:
                logical_path = requested_file_path(self.path, DOCUMENT_PREVIEW_PATH)
                _name, mime, payload = read_user_document_preview(
                    self.server.user_root,
                    logical_path,
                )
            except FileSpaceExportTooLargeError:
                self._empty(413)
                return
            except FileSpaceExportChangedError:
                self._empty(412)
                return
            except FileSpaceDocumentPreviewTypeError:
                self._empty(415)
                return
            except ValueError:
                self._empty(400)
                return
            except (FileNotFoundError, NotADirectoryError):
                self._empty(404)
                return
            except PermissionError:
                self._empty(403)
                return
            except OSError as exc:
                print(f"ordax-native-host: could not preview user document: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._write_document_preview(mime, payload)
            return

        if parsed_path == FILE_EXPORT_PATH:
            try:
                logical_path = requested_file_path(self.path, FILE_EXPORT_PATH)
                name, payload = read_user_export_file(self.server.user_root, logical_path)
            except FileSpaceExportTooLargeError:
                self._empty(413)
                return
            except FileSpaceExportChangedError:
                self._empty(412)
                return
            except ValueError:
                self._empty(400)
                return
            except (FileNotFoundError, NotADirectoryError):
                self._empty(404)
                return
            except PermissionError:
                self._empty(403)
                return
            except OSError as exc:
                print(f"ordax-native-host: could not export user file: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._write_download(name, payload)
            return

        if parsed_path == FILE_CONTENT_PATH:
            try:
                logical_path = requested_file_path(self.path, FILE_CONTENT_PATH)
                payload = read_user_text_file(self.server.user_root, logical_path)
            except FileSpaceTextTooLargeError:
                self._empty(413)
                return
            except FileSpaceTextEncodingError:
                self._empty(415)
                return
            except ValueError:
                self._empty(400)
                return
            except (FileNotFoundError, NotADirectoryError):
                self._empty(404)
                return
            except PermissionError:
                self._empty(403)
                return
            except OSError as exc:
                print(f"ordax-native-host: could not read user text file: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._write_json(200, payload)
            return
        if parsed_path == FILES_PATH:
            try:
                logical_path = requested_file_path(self.path)
                listing = list_user_directory(self.server.user_root, logical_path)
            except ValueError:
                self._empty(400)
                return
            except (FileNotFoundError, NotADirectoryError):
                self._empty(404)
                return
            except PermissionError:
                self._empty(403)
                return
            except OSError as exc:
                print(f"ordax-native-host: could not list user files: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._write_json(200, listing)
            return
        if self.path == SESSION_PATH:
            self._write_json(
                200,
                {
                    "token": self.server.power_token,
                    "networkToken": self.server.network_token,
                    "diagnosticToken": self.server.diagnostic_token,
                    "productMode": self.server.product_mode,
                    "nativeInstallAvailable": self.server.native_install_available,
                    "nativeInstallToken": self.server.native_install_token,
                    "profileActivationAvailable": self.server.profile_activation_available,
                    "profileActivationToken": self.server.profile_activation_token,
                    "componentSlotReadAvailable": self.server.component_slot_read_available,
                    "supportedActions": list(self.server.supported_actions),
                },
            )
            return
        if self.path == UPDATE_PATH:
            update_state = read_update_state()
            if update_state is None:
                update_state = {
                    "sourceSha": "unavailable",
                    "targetSha": "",
                    "status": "unavailable",
                    "phase": "error",
                    "applyMode": "none",
                    "attemptId": "",
                    "bootRefreshRequired": False,
                    "checkedAt": "unknown",
                    "lastAppliedSha": "",
                    "lastAppliedAt": "unknown",
                    "rejectedSha": "",
                    "lastError": "update-state-unavailable",
                }
                status = 503
            else:
                update_state = dict(update_state)
                status = 200
            update_state["healthToken"] = self.server.health_token
            self._write_json(status, update_state)
            return
        if self.path == PREFERENCES_PATH:
            self._write_json(200, read_preferences())
            return
        if parsed_path == KEYBOARD_LAYOUT_PATH:
            self._write_json(200, keyboard_layout_snapshot())
            return
        if parsed_path == FIRST_RUN_PATH:
            self._write_json(200, read_first_run_state())
            return
        if parsed_path == DEVICE_PROFILE_PATH:
            try:
                self._write_json(200, read_device_profile())
            except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
                print(f"ordax-native-host: could not read device profile: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
            return
        if parsed_path == LOCAL_SESSION_PATH:
            with self.server.local_session_lock:
                if not os.path.isfile(LOCAL_SESSION_CREDENTIAL_FILE):
                    self.server.local_session_locked = False
                snapshot = local_session_snapshot(self.server)
            self._write_json(200, snapshot)
            return
        if self.path == MEMORY_PATH:
            try:
                payload = read_memory_endpoint()
            except (OSError, UnicodeError, ValueError) as exc:
                print(
                    f"ordax-native-host: could not read Intelligence memory: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._empty(500)
                return
            self._write_json(200, payload)
            return
        if self.path == COMPONENT_STATE_PATH:
            try:
                payload = read_component_state_payload()
            except (OSError, UnicodeError, ValueError) as exc:
                print(
                    f"ordax-native-host: could not read component state: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._empty(500)
                return
            self._write_json(200, {"payload": payload})
            return
        if self.path == PROFILE_COMPONENT_INVENTORY_PATH:
            try:
                payload = read_profile_component_inventory()
            except (OSError, UnicodeError, ValueError) as exc:
                print(
                    f"ordax-native-host: could not read Profile component inventory: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._empty(500)
                return
            self._write_json(200, payload)
            return
        if self.path == PROFILE_ACTIVATION_STATE_PATH:
            try:
                payload = read_profile_activation_state()
            except (OSError, UnicodeError, ValueError) as exc:
                print(
                    f"ordax-native-host: could not read Profile activation state: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._empty(500)
                return
            self._write_json(200, payload)
            return
        if parsed_path == PROFILE_CONTENT_CONTEXT_CAPABILITY_PATH:
            self._write_json(
                200,
                {
                    "schema": "ordax.profile-content-context-capability/1",
                    "available": self.server.distribution_profile in {"owner-development", "stable-mvp"},
                },
            )
            return
        if parsed_path == PROFILE_CONTENT_CONTEXT_PATH:
            if self.server.distribution_profile not in {"owner-development", "stable-mvp"}:
                self._empty(404)
                return
            try:
                space_id, relevance_query = requested_profile_content_parameters(self.path)
                payload = read_active_profile_content_context(space_id, query=relevance_query)
            except (OSError, UnicodeError, ValueError) as exc:
                print(
                    f"ordax-native-host: Profile content context unavailable safely: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._empty(409)
                return
            self._write_json(200, payload)
            return
        if self.path == SYNC_STATE_PATH:
            self._write_json(200, {"payload": read_sync_state_payload()})
            return
        if self.path == SYNC_CHECKPOINT_PATH:
            self._write_json(200, {"checkpoint": read_sync_checkpoint()})
            return
        if self.path == DIAGNOSTIC_JOURNAL_PATH:
            try:
                payload = read_diagnostic_journal_payload()
            except (OSError, UnicodeError, ValueError) as exc:
                print(
                    f"ordax-native-host: could not read diagnostic journal: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._empty(500)
                return
            self._write_json(200, {"payload": payload})
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        if not self._request_is_trusted():
            return
        if self.client_address[0] != "127.0.0.1":
            self._empty(403)
            return

        parsed_path = urlsplit(self.path).path
        if parsed_path == STORE_LIFECYCLE_PATH:
            if urlsplit(self.path).query:
                self._empty(400)
                return
            payload = self._read_json_body(MAX_STORE_LIFECYCLE_BODY)
            if payload is None:
                self._empty(400)
                return
            try:
                plan = validate_lifecycle_plan(payload)
            except NativeAppLifecycleError:
                self._empty(400)
                return
            request_value = plan["request"]
            try:
                with self.server.store_lifecycle_lock:
                    if request_value["operation"] in {"install", "update"}:
                        if not self.server.store_artifact_base_origin:
                            self._empty(503)
                            return
                        acquire_lifecycle_plan_artifacts(
                            plan,
                            base_origin=self.server.store_artifact_base_origin,
                            artifact_root=self.server.store_artifact_root,
                            watermark_path=self.server.store_catalog_watermark_path,
                        )
                    execute_offline_lifecycle_plan(
                        plan,
                        artifact_root=self.server.store_artifact_root,
                        channel_bin=self.server.component_channel_bin,
                        trust_path=self.server.component_trust_path,
                        slot_root=self.server.component_slot_root,
                        watermark_path=self.server.store_catalog_watermark_path,
                    )
            except (AppArtifactAcquisitionError, NativeAppLifecycleError) as exc:
                print(
                    f"ordax-native-host: Store lifecycle failed closed: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._empty(503)
                return
            self._write_json(
                200,
                {
                    "schema": "ordax.app-lifecycle-request-result/1",
                    "requestId": request_value["requestId"],
                    "appId": request_value["appId"],
                    "operation": request_value["operation"],
                    "source": request_value["source"],
                    "state": "accepted",
                    "reason": None,
                    "authority": "none",
                },
            )
            return

        if parsed_path in {ACCOUNT_LOGIN_PATH, ACCOUNT_REGISTER_PATH, ACCOUNT_LOGOUT_PATH, ACCOUNT_CLOSE_PATH, ACCOUNT_SYNC_MUTATE_PATH, NETWORK_MESSAGE_SEND_PATH}:
            if self.server.account_gateway is None:
                self._empty(503)
                return
            try:
                if parsed_path == ACCOUNT_REGISTER_PATH and not ACCOUNT_REGISTRATION_ENABLED:
                    self._empty(503)
                    return
                if parsed_path in {ACCOUNT_LOGIN_PATH, ACCOUNT_REGISTER_PATH}:
                    payload = self._read_account_credentials()
                    expected_keys = (
                        {"email", "password"}
                        if parsed_path == ACCOUNT_LOGIN_PATH
                        else {"email", "password", "legalAcceptance"}
                    )
                    if payload is None or set(payload) != expected_keys:
                        self._empty(400)
                        return
                    email = payload.get("email")
                    password = payload.get("password")
                    if not isinstance(email, str) or not isinstance(password, str):
                        self._empty(400)
                        return
                    if parsed_path == ACCOUNT_REGISTER_PATH and payload.get("legalAcceptance") is not True:
                        self._empty(400)
                        return
                    reply = (
                        self.server.account_gateway.login(email, password)
                        if parsed_path == ACCOUNT_LOGIN_PATH
                        else self.server.account_gateway.register(email, password, legal_accepted=True)
                    )
                    if reply.status not in {200, 202, 303}:
                        self._empty(reply.status)
                        return
                    session_reply = self.server.account_gateway.session()
                    session_payload = json.loads(session_reply.body.decode("utf-8"))
                    if not isinstance(session_payload, dict):
                        raise ValueError("invalid session payload")
                    if parsed_path == ACCOUNT_REGISTER_PATH and not session_payload.get("authenticated"):
                        session_payload["confirmationRequired"] = True
                        self._write_json(202, session_payload)
                    else:
                        self._write_json(200, session_payload)
                    return
                if parsed_path == ACCOUNT_LOGOUT_PATH:
                    reply = self.server.account_gateway.logout()
                    if reply.status not in {200, 204, 303}:
                        self._empty(reply.status)
                        return
                    self._empty(204)
                    return
                if parsed_path == ACCOUNT_CLOSE_PATH:
                    payload = self._read_account_credentials()
                    if payload is None or set(payload) != {"password", "confirmation"}:
                        self._empty(400)
                        return
                    password = payload.get("password")
                    confirmation = payload.get("confirmation")
                    if not isinstance(password, str) or confirmation != "close-account":
                        self._empty(400)
                        return
                    reply = self.server.account_gateway.close_account(password, confirmation)
                    if not reply.body:
                        self._empty(reply.status)
                        return
                    response_payload = json.loads(reply.body.decode("utf-8"))
                    if not isinstance(response_payload, dict):
                        raise ValueError("invalid account close payload")
                    self._write_json(reply.status, response_payload)
                    return
                if parsed_path == NETWORK_MESSAGE_SEND_PATH:
                    body = self._read_json_body(MAX_NETWORK_MESSAGE_BODY)
                    if body is None or set(body) != {
                        "space_id",
                        "conversation_id",
                        "idempotency_key",
                        "body",
                    }:
                        self._empty(400)
                        return
                    raw = json.dumps(
                        body,
                        separators=(",", ":"),
                        ensure_ascii=False,
                    ).encode("utf-8")
                    reply = self.server.account_gateway.send_network_message(raw)
                    if not reply.body:
                        self._empty(reply.status)
                        return
                    response_payload = json.loads(reply.body.decode("utf-8"))
                    if not isinstance(response_payload, dict):
                        raise ValueError("invalid Network gateway payload")
                    self._write_json(reply.status, response_payload)
                    return
                body = self._read_json_body(MAX_ACCOUNT_SYNC_BODY)
                if body is None:
                    self._empty(400)
                    return
                raw = json.dumps(body, separators=(",", ":")).encode("utf-8")
                reply = self.server.account_gateway.mutate_sync(raw)
                if not reply.body:
                    self._empty(reply.status)
                    return
                response_payload = json.loads(reply.body.decode("utf-8"))
                if not isinstance(response_payload, dict):
                    raise ValueError("invalid sync payload")
                self._write_json(reply.status, response_payload)
                return
            except (NativeAccountGatewayError, UnicodeError, json.JSONDecodeError, ValueError):
                self._empty(503)
                return

        if parsed_path == PROFILE_ACTIVATION_COMMAND_PATH:
            if not self.server.profile_activation_available:
                self._empty(404)
                return
            supplied_token = self.headers.get(PROFILE_ACTIVATION_TOKEN_HEADER, "")
            if not hmac.compare_digest(
                supplied_token,
                self.server.profile_activation_token,
            ):
                self._empty(403)
                return
            payload = self._read_json_body(MAX_PROFILE_ACTIVATION_COMMAND_BODY)
            if payload is None:
                self._empty(400)
                return
            try:
                with self.server.profile_activation_lock:
                    response = execute_profile_activation_command(
                        payload,
                        distribution_profile=self.server.distribution_profile,
                        human_consent_authority=self.server.profile_human_consent_authority,
                        human_consent_resolver=self.server.resolve_profile_human_consent,
                    )
            except PermissionError as exc:
                print(
                    f"ordax-native-host: Profile activation denied safely: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._empty(403)
                return
            except ProfileConsentUnavailableError as exc:
                print(
                    f"ordax-native-host: Profile consent presenter unavailable: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._empty(503)
                return
            except RuntimeError as exc:
                print(
                    f"ordax-native-host: Profile activation revision conflict: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._empty(409)
                return
            except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
                print(
                    f"ordax-native-host: Profile activation command rejected: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._empty(400)
                return
            self._write_json(200, response)
            return

        if parsed_path == LOCAL_SESSION_PATH:
            payload = self._read_json_body(MAX_LOCAL_SESSION_BODY)
            if payload is None:
                self._empty(400)
                return
            action = payload.get("action")
            allowed_keys = {"action"} if action == "lock" else {"action", "secret"}
            if set(payload) != allowed_keys:
                self._empty(400)
                return
            secret = payload.get("secret")
            if action != "lock" and not valid_local_session_secret(secret):
                self._empty(400)
                return
            try:
                with self.server.local_session_lock:
                    credential = read_local_session_credential()
                    now = time.monotonic()
                    if action == "configure-credential":
                        if credential is not None or self.server.local_session_locked:
                            self._empty(409)
                            return
                        write_local_session_credential(secret)
                        self.server.local_session_locked = False
                        self.server.local_session_failures = 0
                        self.server.local_session_retry_after = 0.0
                    elif action == "remove-credential":
                        if credential is None:
                            self._empty(409)
                            return
                        if self.server.local_session_locked:
                            self._empty(423)
                            return
                        if not verify_local_session_secret(secret):
                            self._empty(401)
                            return
                        remove_local_session_credential()
                        self.server.local_session_locked = False
                        self.server.local_session_failures = 0
                        self.server.local_session_retry_after = 0.0
                    elif action == "lock":
                        if credential is None:
                            self._empty(409)
                            return
                        self.server.local_session_locked = True
                    elif action == "unlock":
                        if credential is None:
                            self._empty(409)
                            return
                        if now < self.server.local_session_retry_after:
                            self._empty(429)
                            return
                        if not verify_local_session_secret(secret):
                            self.server.local_session_failures = min(
                                8, self.server.local_session_failures + 1
                            )
                            delay = min(
                                30.0,
                                float((1 << min(5, self.server.local_session_failures)) - 1),
                            )
                            self.server.local_session_retry_after = now + delay
                            self._empty(401)
                            return
                        self.server.local_session_locked = False
                        self.server.local_session_failures = 0
                        self.server.local_session_retry_after = 0.0
                    else:
                        self._empty(400)
                        return
                    snapshot = local_session_snapshot(self.server)
            except (OSError, ValueError) as exc:
                print(
                    f"ordax-native-host: local session action failed safely: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._empty(503)
                return
            self._write_json(200, snapshot)
            return

        if parsed_path == FILE_IMPORT_PATH:
            try:
                logical_path, name = requested_file_import_target(self.path)
                raw_length = self.headers.get("Content-Length")
                if raw_length is None:
                    raise ValueError("file import requires Content-Length")
                length = int(raw_length)
                if length < 0:
                    raise ValueError("invalid file import Content-Length")
                if length > MAX_FILE_IMPORT_BYTES:
                    raise FileSpaceImportTooLargeError("import exceeds size limit")
                content_type = (
                    self.headers.get("Content-Type", "")
                    .split(";", 1)[0]
                    .strip()
                    .lower()
                )
                if content_type != "application/octet-stream":
                    raise ValueError("file import requires application/octet-stream")
                listing = import_user_file(
                    self.server.user_root,
                    logical_path,
                    name,
                    self.rfile,
                    length,
                )
            except FileSpaceImportTooLargeError:
                self._empty(413)
                return
            except FileSpaceImportIncompleteError:
                self._empty(400)
                return
            except ValueError:
                self._empty(400)
                return
            except FileExistsError:
                self._empty(409)
                return
            except (FileNotFoundError, NotADirectoryError):
                self._empty(404)
                return
            except PermissionError:
                self._empty(403)
                return
            except OSError as exc:
                print(f"ordax-native-host: file import failed safely: {exc}", file=sys.stderr, flush=True)
                self._empty(507 if exc.errno == errno.ENOSPC else 503)
                return
            self._write_json(201, listing)
            return

        if self.path == SURFACE_HEARTBEAT_PATH:
            payload = self._read_json_body(MAX_SURFACE_HEARTBEAT_BODY)
            if payload is None or not valid_surface_heartbeat_payload(payload):
                self._empty(400)
                return
            try:
                record_surface_heartbeat(payload["sourceSha"])
            except (OSError, ValueError) as exc:
                print(f"ordax-native-host: could not record Surface heartbeat: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._empty(204)
            return

        if self.path == HEALTH_PATH:
            supplied_token = self.headers.get(HEALTH_TOKEN_HEADER, "")
            if not hmac.compare_digest(supplied_token, self.server.health_token):
                self._empty(403)
                return
            payload = self._read_json_body()
            source_sha = payload.get("sourceSha") if payload else None
            if not valid_commit_sha(source_sha):
                self._empty(400)
                return
            update_state = read_update_state()
            if update_state is None or update_state.get("sourceSha") != source_sha:
                self._empty(409)
                return
            try:
                record_surface_health(source_sha)
            except OSError as exc:
                print(f"ordax-native-host: could not record Surface health: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._empty(204)
            return

        if self.path == CLIENT_DIAGNOSTIC_PATH:
            supplied_token = self.headers.get(DIAGNOSTIC_TOKEN_HEADER, "")
            if not hmac.compare_digest(supplied_token, self.server.diagnostic_token):
                self._empty(403)
                return
            payload = self._read_json_body(MAX_CLIENT_DIAGNOSTIC_BODY)
            if payload is None or not valid_client_diagnostic_payload(payload):
                self._empty(400)
                return
            try:
                record_client_diagnostic(payload)
            except (OSError, ValueError) as exc:
                print(f"ordax-native-host: could not record client diagnostic: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._empty(204)
            return

        if self.path == NETWORK_MANAGEMENT_PATH:
            supplied_token = self.headers.get(NETWORK_TOKEN_HEADER, "")
            if not hmac.compare_digest(supplied_token, self.server.network_token):
                self._empty(403)
                return
            payload = self._read_json_body(MAX_NETWORK_ACTION_BODY)
            if payload is None:
                self._empty(400)
                return
            action = payload.get("action")
            if action not in {"scan", "connect", "disconnect", "forget", "reconnect"}:
                self._empty(400)
                return
            try:
                with self.server.network_lock:
                    snapshot = queue_network_broker_request(
                        self.server.network_paths,
                        action,
                        ssid=payload.get("ssid"),
                        password=payload.get("password"),
                        timeout_seconds=24.0 if action in {"connect", "reconnect"} else 12.0,
                    )
            except ValueError:
                self._empty(400)
                return
            except RuntimeError as exc:
                detail = getattr(exc, "network_detail", "")
                self._empty(409 if detail in {"connect-failed", "reconnect-failed"} else 503)
                return
            except (FileNotFoundError, PermissionError, TimeoutError, OSError) as exc:
                print(f"ordax-native-host: network management action failed safely: {exc}", file=sys.stderr, flush=True)
                self._empty(503)
                return
            self._write_json(200, snapshot)
            return

        if parsed_path == KEYBOARD_LAYOUT_PATH:
            payload = self._read_json_body(MAX_KEYBOARD_LAYOUT_BODY)
            if (
                payload is None
                or set(payload) != {"layoutId"}
                or payload.get("layoutId") not in KEYBOARD_LAYOUT_ID_SET
            ):
                self._empty(400)
                return
            try:
                write_keyboard_layout_id(payload["layoutId"])
            except (OSError, ValueError) as exc:
                print(
                    f"ordax-native-host: could not persist keyboard layout: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._empty(500)
                return
            self._write_json(200, keyboard_layout_snapshot())
            return

        if parsed_path == DEVICE_PROFILE_PATH:
            payload = self._read_json_body(MAX_DEVICE_PROFILE_BODY)
            if payload is None or set(payload) != {"displayName"}:
                self._empty(400)
                return
            try:
                current = read_device_profile()
                updated = {
                    "schema": current["schema"],
                    "devicePublicId": current["devicePublicId"],
                    "displayName": normalize_device_display_name(payload["displayName"]),
                }
                write_device_profile(updated)
            except (OSError, UnicodeError, json.JSONDecodeError, ValueError, TypeError) as exc:
                print(f"ordax-native-host: could not persist device profile: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._write_json(200, updated)
            return

        if parsed_path == FIRST_RUN_PATH:
            payload = self._read_json_body(MAX_FIRST_RUN_BODY)
            if payload is None or not valid_first_run_state(payload):
                self._empty(400)
                return
            try:
                write_first_run_state(payload)
            except (OSError, ValueError) as exc:
                print(f"ordax-native-host: could not persist first-run state: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._empty(204)
            return

        if self.path == PREFERENCES_PATH:
            payload = self._read_json_body(MAX_PREFERENCE_BODY)
            if payload is None or not valid_preference_record(payload):
                self._empty(400)
                return
            try:
                write_preferences(payload)
            except (OSError, ValueError) as exc:
                print(f"ordax-native-host: could not persist preferences: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._empty(204)
            return

        if self.path == MEMORY_PATH:
            body = self._read_json_body(MAX_MEMORY_REQUEST_BODY_BYTES)
            if body is None:
                self._empty(400)
                return
            try:
                result = write_memory_endpoint(
                    json.dumps(body, separators=(",", ":")).encode("utf-8")
                )
            except MemoryEndpointRequestError as exc:
                self._empty(exc.status_code)
                return
            except OSError as exc:
                print(
                    f"ordax-native-host: could not persist Intelligence memory: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._empty(507 if exc.errno == errno.ENOSPC else 500)
                return
            except (UnicodeError, ValueError):
                self._empty(400)
                return
            self._write_json(200, result)
            return

        if self.path == COMPONENT_STATE_PATH:
            body = self._read_json_body(MAX_COMPONENT_STATE_BODY)
            if body is None or set(body) != {"payload"}:
                self._empty(400)
                return
            payload = body["payload"]
            if not valid_component_state_payload(payload):
                self._empty(400)
                return
            try:
                write_component_state_payload(payload)
            except OSError as exc:
                print(
                    f"ordax-native-host: could not persist component state: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._empty(507 if exc.errno == errno.ENOSPC else 500)
                return
            except ValueError:
                self._empty(400)
                return
            self._empty(204)
            return

        if self.path == SYNC_STATE_PATH:
            body = self._read_json_body(MAX_SYNC_STATE_BODY)
            payload = body.get("payload") if body is not None else object()
            if not valid_sync_state_payload(payload):
                self._empty(400)
                return
            try:
                write_sync_state_payload(payload)
            except (OSError, ValueError) as exc:
                print(f"ordax-native-host: could not persist sync state: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._empty(204)
            return

        if self.path == SYNC_CHECKPOINT_PATH:
            body = self._read_json_body(MAX_SYNC_CHECKPOINT_BODY)
            checkpoint = body.get("checkpoint") if body is not None else object()
            if not valid_sync_checkpoint(checkpoint):
                self._empty(400)
                return
            try:
                write_sync_checkpoint(checkpoint)
            except (OSError, ValueError) as exc:
                print(f"ordax-native-host: could not persist sync checkpoint: {exc}", file=sys.stderr, flush=True)
                self._empty(500)
                return
            self._empty(204)
            return

        if self.path == DIAGNOSTIC_JOURNAL_PATH:
            body = self._read_json_body(MAX_DIAGNOSTIC_JOURNAL_BODY)
            if body is None or set(body) != {"payload"}:
                self._empty(400)
                return
            payload = body["payload"]
            if not valid_diagnostic_journal_payload(payload):
                self._empty(400)
                return
            try:
                write_diagnostic_journal_payload(payload)
            except OSError as exc:
                print(
                    f"ordax-native-host: could not persist diagnostic journal: {exc}",
                    file=sys.stderr,
                    flush=True,
                )
                self._empty(507 if exc.errno == errno.ENOSPC else 500)
                return
            except ValueError:
                self._empty(400)
                return
            self._empty(204)
            return

        if self.path == FILES_PATH:
            payload = self._read_json_body(MAX_FILE_ACTION_BODY)
            if payload is None:
                self._empty(400)
                return
            action = payload.get("action")
            try:
                if action == "create-directory":
                    listing = create_user_directory(
                        self.server.user_root,
                        payload.get("path"),
                        payload.get("name"),
                    )
                    status = 201
                elif action == "rename-entry":
                    listing = rename_user_entry(
                        self.server.user_root,
                        payload.get("path"),
                        payload.get("name"),
                        payload.get("newName"),
                    )
                    status = 200
                elif action == "copy-file":
                    listing = copy_user_file(
                        self.server.user_root,
                        payload.get("sourcePath"),
                        payload.get("name"),
                        payload.get("destinationPath"),
                        payload.get("newName"),
                    )
                    status = 201
                elif action == "move-entry":
                    listing = move_user_entry(
                        self.server.user_root,
                        payload.get("sourcePath"),
                        payload.get("name"),
                        payload.get("destinationPath"),
                    )
                    status = 200
                elif action == "trash-entry":
                    if set(payload) != {"action", "path", "name"}:
                        self._empty(400)
                        return
                    with self.server.file_trash_lock:
                        listing = trash_user_entry(
                            self.server.user_root,
                            payload.get("path"),
                            payload.get("name"),
                        )
                    status = 200
                elif action == "restore-trash-entry":
                    if set(payload) != {"action", "id"}:
                        self._empty(400)
                        return
                    with self.server.file_trash_lock:
                        listing = restore_user_trash_entry(
                            self.server.user_root,
                            payload.get("id"),
                        )
                    status = 200
                else:
                    self._empty(400)
                    return
            except FileSpaceCopyTooLargeError:
                self._empty(413)
                return
            except FileSpaceCopyChangedError:
                self._empty(412)
                return
            except (FileSpaceCrossDeviceMoveError, FileSpaceTrashCrossDeviceError):
                self._empty(422)
                return
            except ValueError:
                self._empty(400)
                return
            except FileExistsError:
                self._empty(409)
                return
            except (FileNotFoundError, NotADirectoryError):
                self._empty(404)
                return
            except PermissionError:
                self._empty(403)
                return
            except OSError as exc:
                print(f"ordax-native-host: file-space mutation failed safely: {exc}", file=sys.stderr, flush=True)
                self._empty(507 if exc.errno == errno.ENOSPC else 503)
                return
            self._write_json(status, listing)
            return

        if self.path != POWER_PATH:
            self._empty(404)
            return

        supplied_token = self.headers.get(TOKEN_HEADER, "")
        if not hmac.compare_digest(supplied_token, self.server.power_token):
            self._empty(403)
            return

        payload = self._read_json_body()
        if payload is None:
            self._empty(400)
            return
        action = payload.get("action")
        if action not in self.server.supported_actions:
            self._empty(409)
            return

        try:
            queue_power_action(self.server.power_request_path, action)
        except (OSError, ValueError) as exc:
            print(
                f"ordax-native-host: could not queue host power action {action}: {exc}",
                file=sys.stderr,
                flush=True,
            )
            self._empty(503)
            return
        self._write_json(202, {"accepted": True, "action": action})

    def log_message(self, fmt: str, *args) -> None:
        print(f"ordax-native-host: {self.address_string()} - {fmt % args}", file=sys.stderr, flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    parser.add_argument("--directory", default="/srv/ordax-system")
    parser.add_argument("--user-root", default="/var/lib/ordax-user")
    parser.add_argument("--power-request", default=DEFAULT_POWER_REQUEST_PATH)
    parser.add_argument("--network-session-dir", default=DEFAULT_NETWORK_SESSION_DIR)
    parser.add_argument("--product-mode", required=True, choices=("usb", "native-disk"))
    parser.add_argument(
        "--distribution-profile",
        default="owner-development",
        choices=("owner-development", "stable-mvp"),
    )
    parser.add_argument(
        "--native-install-capability",
        default="disabled",
        choices=("disabled", "post-mvp-preview"),
    )
    parser.add_argument("--telemetry-config", default="")
    parser.add_argument("--component-channel-bin", default=DEFAULT_COMPONENT_CHANNEL_BIN)
    parser.add_argument("--component-trust", default=DEFAULT_COMPONENT_TRUST_PATH)
    parser.add_argument("--component-slot-root", default=DEFAULT_COMPONENT_SLOT_ROOT)
    parser.add_argument("--store-catalog-envelope", default=DEFAULT_STORE_CATALOG_ENVELOPE_PATH)
    parser.add_argument("--store-catalog-watermark", default=DEFAULT_STORE_CATALOG_WATERMARK_PATH)
    parser.add_argument("--store-catalog-base-origin", default="")
    parser.add_argument("--store-artifact-root", default=DEFAULT_STORE_ARTIFACT_ROOT)
    parser.add_argument("--store-artifact-base-origin", default="")
    parser.add_argument("--account-gateway-origin", default="")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        expected_surface_authority((args.bind, args.port))
    except ValueError as exc:
        print(f"ordax-native-host: refusing unsafe bind: {exc}", file=sys.stderr, flush=True)
        return 2
    try:
        standard_directories = ensure_standard_user_directories(args.user_root)
    except OSError as exc:
        standard_directories = ()
        print(
            f"ordax-native-host: could not provision standard user directories: {exc}",
            file=sys.stderr,
            flush=True,
        )
    if len(standard_directories) != len(STANDARD_USER_DIRECTORIES):
        missing = sorted(set(STANDARD_USER_DIRECTORIES) - set(standard_directories))
        print(
            "ordax-native-host: standard user directories unavailable: %s" % ",".join(missing),
            file=sys.stderr,
            flush=True,
        )
    handler = partial(NativeHostHandler, directory=args.directory)
    server = NativeHostServer(
        (args.bind, args.port),
        handler,
        user_root=args.user_root,
        power_request_path=args.power_request,
        network_session_dir=args.network_session_dir,
        product_mode=args.product_mode,
        distribution_profile=args.distribution_profile,
        native_install_capability=args.native_install_capability,
        component_channel_bin=args.component_channel_bin,
        component_trust_path=args.component_trust,
        component_slot_root=args.component_slot_root,
        store_catalog_envelope_path=args.store_catalog_envelope,
        store_catalog_watermark_path=args.store_catalog_watermark,
        store_catalog_base_origin=args.store_catalog_base_origin,
        store_artifact_root=args.store_artifact_root,
        store_artifact_base_origin=args.store_artifact_base_origin,
        account_gateway_origin=args.account_gateway_origin,
    )
    telemetry_started = start_telemetry_heartbeat(args.telemetry_config)
    print(
        "ordax-native-host: serving %s on %s:%d; user root=%s; power actions=%s; recovery-generation=%d; telemetry=%s"
        % (
            args.directory,
            args.bind,
            args.port,
            args.user_root,
            ",".join(server.supported_actions) or "none",
            SURFACE_HOST_RECOVERY_GENERATION,
            "enabled" if telemetry_started else "disabled",
        ),
        file=sys.stderr,
        flush=True,
    )
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
