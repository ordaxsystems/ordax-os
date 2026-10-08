#!/usr/bin/env python3
"""Read bounded Intelligence context from verified active Profile content.

This boundary is read-only and Owner/Development-only at the HTTP layer.
It never grants authority: Knowledge and Skill text are projected as ordinary
Intelligence context after the active component inventory/receipt and immutable
content-addressed slot are revalidated.
"""

from __future__ import annotations

import hashlib
import json
import os
import stat
import re
import unicodedata
from pathlib import Path

from native_profile_activation_state import (
    PROFILE_ACTIVATION_STATE_FILE,
    assert_activation_components_installed,
    read_profile_activation_state,
)
from native_profile_component_inventory import PROFILE_COMPONENT_INVENTORY_FILE
from native_profile_provisioning_executor import DEFAULT_RECEIPT_ROOT

PROFILE_CONTENT_CONTEXT_SCHEMA = "ordax.profile-content-context/1"
DEFAULT_PROFILE_CONTENT_ROOT = "/var/lib/ordax/profile-content"
CONTENT_FILE_NAME = "content.pack"

MAX_CONTEXT_ENTRIES = 8
MAX_CONTEXT_ITEM_CHARS = 8192
MAX_CONTEXT_TOTAL_CHARS = 32768
MAX_CONTENT_PACK_BYTES = 64 * 1024 * 1024
MAX_PACK_ENTRIES = 2048
MAX_ENTRY_TEXT_CHARS = 1024 * 1024
MAX_RETRIEVAL_QUERY_CHARS = 256
MAX_RETRIEVAL_QUERY_TERMS = 24

# A lexical baseline, not embeddings/RAG. Stopwords never grant relevance.
_RETRIEVAL_STOPWORDS = frozenset((
    "a", "as", "o", "os", "um", "uma", "uns", "umas",
    "de", "da", "das", "do", "dos", "em", "na", "nas", "no", "nos",
    "e", "ou", "para", "por", "com", "sem", "que", "qual", "quais",
    "como", "mais", "menos", "me", "meu", "minha", "sua", "seu",
    "eu", "voce", "preciso", "quero", "sobre", "the", "and", "for",
    "what", "which", "how", "with", "this", "that", "you",
))


def _fold_retrieval_text(value: str) -> str:
    # Accent-insensitive, local-only and independent of a model/provider.
    return "".join(
        char for char in unicodedata.normalize("NFKD", value.casefold())
        if not unicodedata.combining(char)
    )


def _retrieval_terms(query: str | None) -> tuple[str, ...]:
    if query is None:
        return ()
    query = _bounded_text(query, "Profile content retrieval query", MAX_RETRIEVAL_QUERY_CHARS)
    words = re.findall(r"[a-z0-9]{2,}", _fold_retrieval_text(query))
    unique = dict.fromkeys(
        word for word in words if word not in _RETRIEVAL_STOPWORDS
    )
    return tuple(list(unique)[:MAX_RETRIEVAL_QUERY_TERMS])


def _entry_relevance(text: str, title: str, entry_id: str, terms: tuple[str, ...]) -> int:
    if not terms:
        return 0
    body = _fold_retrieval_text(text)
    heading = _fold_retrieval_text(f"{title} {entry_id}")
    # Whole words avoid accidental substring matches; saturate frequency
    # so repetition/prompt injection cannot dominate deterministic ranking.
    body_counts = {}
    for word in re.findall(r"[a-z0-9]{2,}", body):
        if word in terms and body_counts.get(word, 0) < 3:
            body_counts[word] = body_counts.get(word, 0) + 1
    header_words = set(re.findall(r"[a-z0-9]{2,}", heading))
    score = sum(
        min(body_counts.get(term, 0), 3) * 2 + (8 if term in header_words else 0)
        for term in terms
    )
    return score + (12 if all(term in body_counts or term in header_words for term in terms) else 0)


_ALLOWED_KINDS = frozenset(("knowledge-pack", "skill-pack"))
_ALLOWED_MEDIA_TYPES = frozenset(("text/plain", "text/markdown", "application/json"))


def _bounded_text(value: object, label: str, maximum: int) -> str:
    if not isinstance(value, str) or "\0" in value:
        raise ValueError(f"{label} must be text")
    normalized = value.strip()
    if not normalized or len(normalized) > maximum:
        raise ValueError(f"{label} is outside bounds")
    return normalized


def _strict_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Profile content JSON contains duplicate keys")
        result[key] = value
    return result


def _strict_json(raw: bytes) -> object:
    try:
        return json.loads(
            raw.decode("utf-8", errors="strict"),
            object_pairs_hook=_strict_object,
            parse_constant=lambda value: (_ for _ in ()).throw(
                ValueError(f"Profile content JSON constant is invalid: {value}")
            ),
        )
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Profile content payload is invalid JSON") from exc


def _source(value: object, label: str) -> dict:
    if not isinstance(value, dict) or set(value) != {
        "uri", "revision", "license", "jurisdiction", "title"
    }:
        raise ValueError(f"{label} fields are incompatible")
    jurisdiction = value["jurisdiction"]
    if jurisdiction is not None:
        jurisdiction = _bounded_text(jurisdiction, f"{label}.jurisdiction", 80)
    return {
        "uri": _bounded_text(value["uri"], f"{label}.uri", 512),
        "revision": _bounded_text(value["revision"], f"{label}.revision", 160),
        "license": _bounded_text(value["license"], f"{label}.license", 120),
        "jurisdiction": jurisdiction,
        "title": _bounded_text(value["title"], f"{label}.title", 240),
    }


def _slot_content_path(component: dict, content_root: str) -> Path:
    root = Path(content_root)
    parts = (
        component["kind"],
        component["id"],
        "versions",
        component["version"],
        component["sha256"],
    )
    current = root
    for part in parts:
        current = current / part
    return current / CONTENT_FILE_NAME


def _read_immutable_content(component: dict, content_root: str) -> bytes:
    root = Path(content_root)
    try:
        root_info = os.lstat(root)
    except FileNotFoundError as exc:
        raise ValueError("Profile content root is missing") from exc
    if not stat.S_ISDIR(root_info.st_mode) or stat.S_ISLNK(root_info.st_mode):
        raise ValueError("Profile content root boundary is unsafe")

    current = root
    for part in (
        component["kind"],
        component["id"],
        "versions",
        component["version"],
        component["sha256"],
    ):
        current = current / part
        try:
            info = os.lstat(current)
        except FileNotFoundError as exc:
            raise ValueError("Active Profile content slot is missing") from exc
        if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
            raise ValueError("Active Profile content slot boundary is unsafe")

    path = _slot_content_path(component, content_root)
    try:
        info = os.lstat(path)
    except FileNotFoundError as exc:
        raise ValueError("Active Profile content payload is missing") from exc
    if (
        not stat.S_ISREG(info.st_mode)
        or stat.S_ISLNK(info.st_mode)
        or info.st_size <= 0
        or info.st_size > MAX_CONTENT_PACK_BYTES
        or stat.S_IMODE(info.st_mode) & 0o022
    ):
        raise ValueError("Active Profile content payload boundary is unsafe")

    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size != info.st_size:
            raise ValueError("Active Profile content payload changed during read")
        chunks = []
        remaining = MAX_CONTENT_PACK_BYTES + 1
        while remaining > 0:
            chunk = os.read(descriptor, min(65536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
    finally:
        os.close(descriptor)

    if len(raw) != info.st_size or len(raw) > MAX_CONTENT_PACK_BYTES:
        raise ValueError("Active Profile content payload size changed during read")
    if hashlib.sha256(raw).hexdigest() != component["sha256"]:
        raise ValueError("Active Profile content payload hash does not match activation")
    return raw


def _entry_provenance(component: dict, entry_id: str, revision: str) -> str:
    value = (
        f"profile-content:{component['kind']}:{component['id']}@{component['version']}:"
        f"{entry_id};revision={revision}"
    )
    if len(value) > 512:
        raise ValueError("Profile content provenance exceeds Intelligence bound")
    return value


def _relevant_excerpt(text: str, terms: tuple[str, ...]) -> str:
    if len(text) <= MAX_CONTEXT_ITEM_CHARS or not terms:
        return text[:MAX_CONTEXT_ITEM_CHARS].strip()
    # Scan source windows; never select just the first 8 KiB when a
    # matching paragraph appears later in a verified large entry.
    stride = MAX_CONTEXT_ITEM_CHARS // 2
    best_score = -1
    best_start = 0
    for start in range(0, len(text), stride):
        fragment = text[start:start + MAX_CONTEXT_ITEM_CHARS]
        score = _entry_relevance(fragment, "", "", terms)
        if score > best_score:
            best_score = score
            best_start = start
    selected = text[best_start:best_start + MAX_CONTEXT_ITEM_CHARS].strip()
    return selected


def _project_pack(
    component: dict, raw: bytes, query_terms: tuple[str, ...] = (),
) -> list[dict]:
    pack = _strict_json(raw)
    if (
        not isinstance(pack, dict)
        or set(pack) != {"schema", "kind", "entries"}
        or pack.get("schema") != "ordax.profile-content-pack/1"
        or pack.get("kind") != component["kind"]
    ):
        raise ValueError("Active Profile content pack identity is incompatible")
    entries = pack.get("entries")
    if not isinstance(entries, list) or not 1 <= len(entries) <= MAX_PACK_ENTRIES:
        raise ValueError("Active Profile content pack entries are outside bounds")

    projected = []
    ids = set()
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise ValueError(f"Profile content entry[{index}] must be an object")
        if component["kind"] == "knowledge-pack":
            expected = {"id", "mediaType", "content", "contentSha256", "source"}
            if set(entry) != expected or entry.get("mediaType") not in _ALLOWED_MEDIA_TYPES:
                raise ValueError(f"Knowledge entry[{index}] fields are incompatible")
            entry_id = _bounded_text(entry.get("id"), f"Knowledge entry[{index}].id", 128)
            text = _bounded_text(entry.get("content"), f"Knowledge entry[{index}].content", MAX_ENTRY_TEXT_CHARS)
            digest = _bounded_text(entry.get("contentSha256"), f"Knowledge entry[{index}].contentSha256", 64)
            if hashlib.sha256(text.encode("utf-8")).hexdigest() != digest:
                raise ValueError(f"Knowledge entry[{index}] content hash mismatch")
            if entry.get("mediaType") == "application/json":
                _strict_json(text.encode("utf-8"))
            source = _source(entry.get("source"), f"Knowledge entry[{index}].source")
        else:
            expected = {
                "id", "title", "instructions", "instructionsSha256",
                "authority", "toolIds", "source",
            }
            if set(entry) != expected:
                raise ValueError(f"Skill entry[{index}] fields are incompatible")
            if entry.get("authority") != "none" or entry.get("toolIds") != []:
                raise ValueError("Skill entry attempts to carry authority")
            entry_id = _bounded_text(entry.get("id"), f"Skill entry[{index}].id", 128)
            title = _bounded_text(entry.get("title"), f"Skill entry[{index}].title", 160)
            instructions = _bounded_text(
                entry.get("instructions"),
                f"Skill entry[{index}].instructions",
                MAX_ENTRY_TEXT_CHARS,
            )
            digest = _bounded_text(
                entry.get("instructionsSha256"),
                f"Skill entry[{index}].instructionsSha256",
                64,
            )
            if hashlib.sha256(instructions.encode("utf-8")).hexdigest() != digest:
                raise ValueError(f"Skill entry[{index}] instructions hash mismatch")
            text = f"Declarative skill: {title}\n{instructions}"
            source = _source(entry.get("source"), f"Skill entry[{index}].source")

        if entry_id in ids:
            raise ValueError("Profile content pack entry ids must be unique")
        ids.add(entry_id)
        relevance = _entry_relevance(text, source["title"], entry_id, query_terms)
        # Validate every entry and its digest even when it is not relevant.
        if query_terms and relevance == 0:
            continue
        clipped = _relevant_excerpt(text, query_terms)
        if not clipped:
            raise ValueError("Profile content projection produced empty text")
        component_tag = hashlib.sha256(
            f"{component['id']}@{component['version']}@{component['sha256']}".encode("utf-8")
        ).hexdigest()[:12]
        projected.append({
            "id": f"profile.{component_tag}.{entry_id}",
            "scope": "workspace",
            "text": clipped,
            "provenance": _entry_provenance(component, entry_id, source["revision"]),
            "_retrievalScore": relevance,
        })
    return projected


def read_active_profile_content_context(
    space_id: str,
    *,
    query: str | None = None,
    activation_state_path: str = PROFILE_ACTIVATION_STATE_FILE,
    inventory_path: str = PROFILE_COMPONENT_INVENTORY_FILE,
    receipt_root: str = DEFAULT_RECEIPT_ROOT,
    content_root: str = DEFAULT_PROFILE_CONTENT_ROOT,
) -> dict:
    space_id = _bounded_text(space_id, "Profile content Space id", 160)
    terms = _retrieval_terms(query)
    state = read_profile_activation_state(activation_state_path)
    row = next((entry for entry in state["spaces"] if entry["spaceId"] == space_id), None)
    if row is None or row["current"] is None:
        return {
            "schema": PROFILE_CONTENT_CONTEXT_SCHEMA,
            "spaceId": space_id,
            "profile": None,
            "entries": [],
        }

    activation = row["current"]
    assert_activation_components_installed(
        activation,
        inventory_path,
        receipt_root,
    )

    candidates = []
    for component in activation["components"]:
        if component["kind"] not in _ALLOWED_KINDS:
            continue
        candidates.extend(
            _project_pack(
                component, _read_immutable_content(component, content_root), terms,
            )
        )

    # Rank over every verified entry, not merely the first eight in a pack.
    # A stopword-only query cannot arbitrarily recommend unrelated content.
    if query is not None:
        if not terms:
            candidates = []
        candidates.sort(key=lambda item: (-item["_retrievalScore"], item["id"]))
    entries = []
    remaining_chars = MAX_CONTEXT_TOTAL_CHARS
    for entry in candidates:
        if len(entries) >= MAX_CONTEXT_ENTRIES or remaining_chars <= 0:
            break
        text = entry["text"]
        if len(text) > remaining_chars:
            if remaining_chars < 2:
                break
            clipped = text[: remaining_chars - 1].rstrip()
            if not clipped:
                break
            entry = {**entry, "text": f"{clipped}…"}
        entry = {key: value for key, value in entry.items() if key != "_retrievalScore"}
        entries.append(entry)
        remaining_chars -= len(entry["text"])

    return {
        "schema": PROFILE_CONTENT_CONTEXT_SCHEMA,
        "spaceId": space_id,
        "profile": dict(activation["profile"]),
        "entries": entries,
    }
