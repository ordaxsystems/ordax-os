"""Shared local source-graph discovery for OrdaX zero-dependency artifacts."""

from __future__ import annotations

import posixpath
import re
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath

JS_FROM_RE = re.compile(r"\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?[\"']([^\"']+)[\"']")
JS_CALL_RE = re.compile(r"\b(?:import|require(?:\.resolve)?)\s*\(\s*[\"']([^\"']+)[\"']\s*\)")
JS_URL_RE = re.compile(
    r"\bnew\s+URL\(\s*[\"']([^\"']+)[\"']\s*,\s*import\.meta\.url\s*\)"
)
CSS_IMPORT_RE = re.compile(
    r"@import\s+(?:url\()?\s*[\"']([^\"']+)[\"']",
    re.IGNORECASE,
)
CSS_URL_RE = re.compile(r"url\(\s*[\"']?([^\"')]+)", re.IGNORECASE)
REMOTE_PREFIXES = ("http://", "https://", "//", "data:", "javascript:")


class SourceGraphError(RuntimeError):
    pass


def _srcset_urls(value: str) -> list[str]:
    # HTML srcset separates candidates by a comma following a URL or its
    # descriptors. A URL itself may contain commas (notably data: URLs), so
    # a simple split(',') could lose an untrusted external dependency.
    urls: list[str] = []
    index = 0
    while index < len(value):
        while index < len(value) and (value[index].isspace() or value[index] == ","):
            index += 1
        if index >= len(value):
            break
        start = index
        while index < len(value) and not value[index].isspace():
            index += 1
        token = value[start:index]
        url = token.rstrip(",")
        if url:
            urls.append(url)
        if token.endswith(","):
            continue
        parentheses = 0
        while index < len(value):
            character = value[index]
            if character == "(":
                parentheses += 1
            elif character == ")" and parentheses:
                parentheses -= 1
            elif character == "," and parentheses == 0:
                index += 1
                break
            index += 1
    return urls


class _HTMLDependencies(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.urls: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for name, value in attrs:
            if value is None:
                continue
            if name in {"src", "href"}:
                self.urls.append(value)
            elif name in {"srcset", "imagesrcset"}:
                self.urls.extend(_srcset_urls(value))

    handle_startendtag = handle_starttag


def dependency_specifiers(path: PurePosixPath, text: str) -> list[str]:
    suffix = path.suffix.lower()
    if suffix in {".html", ".htm"}:
        parser = _HTMLDependencies()
        parser.feed(text)
        parser.close()
        return parser.urls
    if suffix in {".mjs", ".js", ".cjs"}:
        specs = (
            set(JS_FROM_RE.findall(text))
            | set(JS_CALL_RE.findall(text))
            | set(JS_URL_RE.findall(text))
        )
        return sorted(specs)
    if suffix == ".css":
        specs = set(CSS_IMPORT_RE.findall(text))
        for value in CSS_URL_RE.findall(text):
            if value.strip().startswith("#"):
                continue
            specs.add(value.strip())
        return sorted(specs)
    return []


def resolve_local(
    source: PurePosixPath,
    specifier: str,
    *,
    allowed_prefixes: tuple[str, ...] = ("system",),
) -> PurePosixPath | None:
    spec = specifier.strip().replace("\\", "/")
    if not spec or spec.startswith("#"):
        return None
    if spec.lower().startswith(REMOTE_PREFIXES):
        raise SourceGraphError(f"remote/runtime dependency is not allowed: {specifier}")
    if spec.startswith("/"):
        raise SourceGraphError(f"absolute dependency path is not allowed: {specifier}")
    if not spec.startswith("."):
        raise SourceGraphError(f"bare dependency is not allowed: {specifier}")

    candidate = posixpath.normpath(str(source.parent / PurePosixPath(spec)))
    if candidate == ".." or candidate.startswith("../") or candidate.startswith("/"):
        raise SourceGraphError(
            f"dependency escapes repository root: {source} -> {specifier}"
        )
    if not any(
        candidate == prefix or candidate.startswith(prefix + "/")
        for prefix in allowed_prefixes
    ):
        raise SourceGraphError(
            f"dependency is outside allowed source roots: {source} -> {candidate}"
        )
    return PurePosixPath(candidate)


def discover_graph(
    root: Path,
    entrypoint: PurePosixPath,
    *,
    allowed_prefixes: tuple[str, ...] = ("system",),
) -> list[PurePosixPath]:
    pending = [entrypoint]
    discovered: set[PurePosixPath] = set()

    while pending:
        current = pending.pop()
        if current in discovered:
            continue
        file_path = root / current
        if not file_path.is_file():
            raise SourceGraphError(f"missing source dependency: {current}")
        discovered.add(current)

        if file_path.suffix.lower() not in {".html", ".htm", ".mjs", ".js", ".cjs", ".css"}:
            continue
        text = file_path.read_text(encoding="utf-8")
        for specifier in dependency_specifiers(current, text):
            dependency = resolve_local(
                current,
                specifier,
                allowed_prefixes=allowed_prefixes,
            )
            if dependency is not None and dependency not in discovered:
                pending.append(dependency)

    return sorted(discovered, key=str)
