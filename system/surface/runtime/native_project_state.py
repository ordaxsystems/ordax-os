#!/usr/bin/env python3
"""Private revisioned Native state owner for the canonical Projects catalog.

This module does not route HTTP or switch the Surface Project runtime. It owns
only durable device-local Project catalog records on top of the shared private
partitioned JSON primitive.
"""

from __future__ import annotations

import re

from native_partitioned_json_state import (
    MAX_SAFE_REVISION,
    compare_and_swap_partitioned_json_record,
    read_partitioned_json_record,
)

RECORD_SCHEMA = "ordax.native-project-store-record/1"
FORMAT_VERSION = 1
DEFAULT_PROJECT_STATE_ROOT = "/var/lib/ordax/projects"
PROJECT_PARTITION_STEM = "catalog"
MAX_PROJECT_RECORD_BYTES = 1024 * 1024
MAX_PROJECTS = 32
MAX_PROJECT_NAME_LENGTH = 80

_PROJECT_ID_RE = re.compile(r"^project-([1-9][0-9]*)$")
_RESERVED_PATH_SEGMENTS = frozenset((".ordax-trash",))


def _safe_integer(value: object, label: str, *, minimum: int = 0) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < minimum
        or value > MAX_SAFE_REVISION
    ):
        raise ValueError(f"{label} is invalid")
    return value


def _project_id(value: object) -> tuple[str, int]:
    if not isinstance(value, str):
        raise ValueError("Project id is invalid")
    match = _PROJECT_ID_RE.fullmatch(value)
    if match is None:
        raise ValueError("Project id is invalid")
    ordinal = int(match.group(1))
    if ordinal < 1 or ordinal > MAX_SAFE_REVISION:
        raise ValueError("Project id ordinal is invalid")
    return value, ordinal


def _project_name(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("Project name is invalid")
    normalized = value.strip()
    if (
        not normalized
        or len(normalized) > MAX_PROJECT_NAME_LENGTH
        or any(ord(character) < 0x20 or ord(character) == 0x7F for character in normalized)
    ):
        raise ValueError("Project name is invalid")
    return normalized


def _logical_path(value: object, *, allow_root: bool = True) -> str:
    if not isinstance(value, str) or "\x00" in value or not value.startswith("/"):
        raise ValueError("Project logical path is invalid")
    if value != "/" and value.endswith("/"):
        raise ValueError("Project logical path is invalid")
    if value == "/":
        if allow_root:
            return value
        raise ValueError("Project path must identify a folder below the logical root")
    parts = value.split("/")[1:]
    if any(
        not part
        or part in {".", ".."}
        or part in _RESERVED_PATH_SEGMENTS
        for part in parts
    ):
        raise ValueError("Project logical path contains an invalid segment")
    return value


def _project_entry(value: object) -> tuple[dict, int]:
    expected_keys = {"id", "name", "path", "createdAt", "lastOpenedAt", "lastFilePath"}
    if not isinstance(value, dict) or set(value) != expected_keys:
        raise ValueError("Project entry shape is invalid")
    project_id, ordinal = _project_id(value.get("id"))
    name = _project_name(value.get("name"))
    path = _logical_path(value.get("path"), allow_root=False)
    created_at = _safe_integer(value.get("createdAt"), "Project createdAt")
    last_opened_at = _safe_integer(value.get("lastOpenedAt"), "Project lastOpenedAt")
    if last_opened_at < created_at:
        raise ValueError("Project lastOpenedAt cannot precede createdAt")

    raw_last_file = value.get("lastFilePath")
    if raw_last_file is None:
        last_file_path = None
    else:
        last_file_path = _logical_path(raw_last_file)
        if last_file_path == path or not last_file_path.startswith(f"{path}/"):
            raise ValueError("Project lastFilePath must be inside the project folder")

    return ({
        "id": project_id,
        "name": name,
        "path": path,
        "createdAt": created_at,
        "lastOpenedAt": last_opened_at,
        "lastFilePath": last_file_path,
    }, ordinal)


def validate_project_store_state(value: object) -> dict:
    if not isinstance(value, dict) or set(value) != {"nextOrdinal", "projects"}:
        raise ValueError("Project store state shape is invalid")
    projects_value = value.get("projects")
    if not isinstance(projects_value, list) or len(projects_value) > MAX_PROJECTS:
        raise ValueError("Project store projects are invalid or unbounded")

    projects: list[dict] = []
    ids: set[str] = set()
    paths: set[str] = set()
    highest_ordinal = 0
    for raw_project in projects_value:
        project, ordinal = _project_entry(raw_project)
        if project["id"] in ids:
            raise ValueError("Project ids must be unique")
        if project["path"] in paths:
            raise ValueError("Project paths must be unique")
        ids.add(project["id"])
        paths.add(project["path"])
        highest_ordinal = max(highest_ordinal, ordinal)
        projects.append(project)

    next_ordinal = _safe_integer(value.get("nextOrdinal"), "Project store nextOrdinal", minimum=1)
    if next_ordinal <= highest_ordinal:
        raise ValueError("Project store nextOrdinal must exceed all project ids")
    return {"nextOrdinal": next_ordinal, "projects": projects}


def _validate_record(value: object) -> dict:
    expected_keys = {"$schema", "revision", "formatVersion", "state"}
    if not isinstance(value, dict) or set(value) != expected_keys:
        raise ValueError("Native Project record shape is invalid")
    if value.get("$schema") != RECORD_SCHEMA:
        raise ValueError("Native Project record schema is incompatible")
    revision = _safe_integer(value.get("revision"), "Native Project record revision", minimum=1)
    if value.get("formatVersion") != FORMAT_VERSION:
        raise ValueError("Native Project store format version is incompatible")
    state = validate_project_store_state(value.get("state"))
    return {
        "$schema": RECORD_SCHEMA,
        "revision": revision,
        "formatVersion": FORMAT_VERSION,
        "state": state,
    }


def read_project_record(root: str = DEFAULT_PROJECT_STATE_ROOT) -> dict | None:
    return read_partitioned_json_record(
        root,
        PROJECT_PARTITION_STEM,
        max_record_bytes=MAX_PROJECT_RECORD_BYTES,
        validate_record=_validate_record,
        label="Projects Native",
    )


def compare_and_swap_project_state(
    expected_revision: object,
    state: object,
    root: str = DEFAULT_PROJECT_STATE_ROOT,
) -> dict | None:
    expected = _safe_integer(
        expected_revision,
        "Projects expected revision",
        minimum=0,
    )
    if expected >= MAX_SAFE_REVISION:
        raise ValueError("Projects expected revision is invalid")
    record = {
        "$schema": RECORD_SCHEMA,
        "revision": expected + 1,
        "formatVersion": FORMAT_VERSION,
        "state": validate_project_store_state(state),
    }
    return compare_and_swap_partitioned_json_record(
        root,
        PROJECT_PARTITION_STEM,
        expected,
        record,
        max_record_bytes=MAX_PROJECT_RECORD_BYTES,
        validate_record=_validate_record,
        label="Projects Native",
    )


def project_exists(project_id: object, root: str = DEFAULT_PROJECT_STATE_ROOT) -> bool:
    normalized_id, _ordinal = _project_id(project_id)
    record = read_project_record(root)
    if record is None:
        return False
    return any(project["id"] == normalized_id for project in record["state"]["projects"])
