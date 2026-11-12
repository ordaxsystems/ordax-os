"""Shared local source-graph discovery for OrdaX zero-dependency artifacts."""

from __future__ import annotations

import posixpath
import re
import stat
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


def require_source_path(
    root: Path, relative: PurePosixPath, *, directory: bool = False
) -> Path:
    """Reject links in *any* source path component before reading or packaging.

    A regular leaf beneath a directory symlink is not canonical OS source.
    The same check covers generated Web input inventories and component
    source-graph traversal, without creating a second source authority.
    """
    if relative.is_absolute() or not relative.parts or ".." in relative.parts:
        raise SourceGraphError(f"unsafe source path: {relative}")
    current = root
    for index, part in enumerate(relative.parts):
        current = current / part
        try:
            mode = current.lstat().st_mode
        except OSError as exc:
            raise SourceGraphError(f"missing source dependency: {relative}") from exc
        if stat.S_ISLNK(mode):
            raise SourceGraphError(f"linked source path is forbidden: {relative}")
        must_be_directory = index < len(relative.parts) - 1 or directory
        if must_be_directory and not stat.S_ISDIR(mode):
            raise SourceGraphError(f"source ancestor is not a directory: {relative}")
        if not must_be_directory and not stat.S_ISREG(mode):
            raise SourceGraphError(f"source dependency is not a regular file: {relative}")
    return current


def iter_trusted_source_files(
    root: Path,
    subtree: PurePosixPath,
    *,
    ignored_dirs: frozenset[str] = frozenset(),
):
    """Enumerate only regular, real source files; reject hidden linked nodes.

    Path.rglob()/is_file() may ignore symlinked directories or follow linked
    file bytes. A build or module-boundary receipt cannot attest a partial
    inventory while a noncanonical directory sits in its source tree.
    """
    if root.is_symlink():
        raise SourceGraphError("linked source root is forbidden")
    top = require_source_path(root, subtree, directory=True)
    pending = [top]
    while pending:
        directory = pending.pop()
        for path in sorted(directory.iterdir(), key=lambda item: item.name):
            if path.name in ignored_dirs:
                continue
            relative = PurePosixPath(path.relative_to(root).as_posix())
            try:
                mode = path.lstat().st_mode
            except OSError as exc:
                raise SourceGraphError(f"unreadable source path: {relative}") from exc
            if stat.S_ISLNK(mode):
                raise SourceGraphError(f"linked source path is forbidden: {relative}")
            if stat.S_ISDIR(mode):
                pending.append(path)
            elif stat.S_ISREG(mode):
                yield relative
            else:
                raise SourceGraphError(f"non-regular source path is forbidden: {relative}")


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
        if not any(
            str(current) == prefix or str(current).startswith(prefix + "/")
            for prefix in allowed_prefixes
        ):
            raise SourceGraphError(f"entrypoint escapes allowed source roots: {current}")
        file_path = require_source_path(root, current)
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
