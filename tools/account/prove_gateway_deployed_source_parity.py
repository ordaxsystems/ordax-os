#!/usr/bin/env python3
"""Fail-closed, read-only Supabase Edge deployed-source parity proof.

Use the canonical repo import graph as SSOT. Read the deployed bundle from the
official Supabase Management API, never from the local checkout or /health.
No user sessions, credentials in output, or Edge Function writes.
"""
from __future__ import annotations

import argparse
from email.message import Message
from email.parser import BytesParser
from email.policy import default as email_default_policy
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import urllib.error
import urllib.request
import zipfile

SOURCE_ROOT = Path(__file__).resolve().parents[2] / "infra" / "supabase" / "functions"
MODES = ("ordax-account-gateway", "ordax-public-account-gateway")
IMPORT = re.compile(r"""(?:\bfrom\s*|\bimport\s*)["'](\.[^"']+)["']""")
PROJECT_REF = re.compile(r"^[a-z0-9]{20}$")
ALLOWED_SUFFIXES = (".mjs", ".js", ".ts", ".tsx", ".json")
MAX_REMOTE_BYTES = 12 * 1024 * 1024
MAX_FILES = 60


class ParityFailure(Exception):
    pass


def safe_path(value: str) -> str:
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise ParityFailure("remote-path-invalid")
    # The Management API archive may prefix source/; no traversal is allowed.
    if value.startswith("source/"):
        value = value[len("source/"):]
    # Supabase Management API returns function source under functions/ after
    # --use-api deploy. Strip exactly one known transport prefix, never an
    # arbitrary directory or an untrusted basename.
    if value.startswith("functions/"):
        value = value[len("functions/"):]
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or any(x in ("", ".") for x in value.split("/")):
        raise ParityFailure("remote-path-invalid")
    return path.as_posix()


def canonical_import_graph(function: str, root: Path = SOURCE_ROOT) -> dict[str, bytes]:
    if function not in MODES:
        raise ParityFailure("unreviewed-function")
    graph = {}
    pending = [function + "/index.ts"]
    root = root.resolve()
    while pending:
        relative = pending.pop()
        if relative in graph:
            continue
        path = (root / relative).resolve()
        if not path.is_relative_to(root) or path.suffix not in ALLOWED_SUFFIXES:
            raise ParityFailure("source-import-invalid")
        try:
            data = path.read_bytes()
            source = data.decode("utf-8")
        except (OSError, UnicodeError):
            raise ParityFailure("canonical-source-missing") from None
        graph[relative] = data
        if len(graph) > MAX_FILES:
            raise ParityFailure("source-imports-excessive")
        for raw in IMPORT.findall(source):
            # Only relative imports have filesystem authority. npm/jsr imports
            # are independently pinned by the reviewed runtime source.
            resolved = (path.parent / raw).resolve()
            if not resolved.is_relative_to(root):
                raise ParityFailure("source-import-outside-root")
            pending.append(resolved.relative_to(root).as_posix())
    if "_shared/account_transport_admission.mjs" not in graph:
        raise ParityFailure("canonical-transport-missing")
    if function == "ordax-account-gateway" and "_shared/account_local_signout.mjs" not in graph:
        raise ParityFailure("canonical-revocation-missing")
    return graph


def _multipart_source_payload(raw: bytes, content_type: str) -> bytes:
    """Normalize official Supabase Management API multipart source into files.

    The boundary comes from the trusted HTTPS response Content-Type, never from
    file content. No redirect, executable archive extraction or relaxed parity.
    Every part and filename is validated before handing it to extract_files.
    """
    if (len(raw) > MAX_REMOTE_BYTES or len(content_type) > 200
            or "\r" in content_type or "\n" in content_type):
        raise ParityFailure("remote-multipart-invalid")
    header = Message()
    header["Content-Type"] = content_type
    boundary = header.get_boundary()
    if (header.get_content_type() != "multipart/form-data"
            or not isinstance(boundary, str) or not 1 <= len(boundary) <= 70
            or not boundary.isascii()):
        raise ParityFailure("remote-multipart-invalid")
    marker = b"--" + boundary.encode("ascii")
    if not raw.startswith(marker + b"\r\n") or not raw.rstrip(b"\r\n").endswith(marker + b"--"):
        raise ParityFailure("remote-multipart-invalid")
    prefix = b"MIME-Version: 1.0\r\nContent-Type: " + content_type.encode("ascii") + b"\r\n\r\n"
    message = BytesParser(policy=email_default_policy).parsebytes(prefix + raw)
    if message.defects or not message.is_multipart():
        raise ParityFailure("remote-multipart-invalid")
    files: list[dict[str, str]] = []
    names: set[str] = set()
    metadata_count = 0
    for part in message.iter_parts():
        if (part.defects or part.is_multipart()
                or part.get_content_disposition() != "form-data"
                or not part.get_param("name", header="content-disposition")
                or part.get("Content-Transfer-Encoding", "").lower()
                   not in ("", "7bit", "8bit", "binary")):
            raise ParityFailure("remote-multipart-part-invalid")
        data = part.get_payload(decode=True)
        if not isinstance(data, bytes) or len(data) > MAX_REMOTE_BYTES:
            raise ParityFailure("remote-multipart-part-invalid")
        filename = part.get_filename()
        if filename is None:
            # Supabase includes one non-file JSON metadata part. It is not
            # executable authority and is never merged into source inventory.
            metadata_count += 1
            if metadata_count > 1:
                raise ParityFailure("remote-multipart-metadata-invalid")
            try:
                metadata = json.loads(data.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                raise ParityFailure("remote-multipart-metadata-invalid") from None
            if not isinstance(metadata, dict):
                raise ParityFailure("remote-multipart-metadata-invalid")
            continue
        name = safe_path(filename)
        if (name in names or PurePosixPath(name).suffix not in ALLOWED_SUFFIXES
                or len(files) >= MAX_FILES):
            raise ParityFailure("remote-multipart-file-invalid")
        try:
            content = data.decode("utf-8")
        except UnicodeDecodeError:
            raise ParityFailure("remote-multipart-file-invalid") from None
        names.add(name)
        files.append({"name": name, "content": content})
    if not files:
        raise ParityFailure("remote-source-empty")
    normalized = json.dumps({"files": files}, separators=(",", ":")).encode("utf-8")
    if len(normalized) > MAX_REMOTE_BYTES:
        raise ParityFailure("remote-bundle-size-invalid")
    return normalized


def extract_files(raw: bytes) -> dict[str, bytes]:
    if not raw or len(raw) > MAX_REMOTE_BYTES:
        raise ParityFailure("remote-bundle-size-invalid")
    result: dict[str, bytes] = {}
    if zipfile.is_zipfile(io.BytesIO(raw)):
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            members = [x for x in archive.infolist() if not x.is_dir()]
            if len(members) > MAX_FILES:
                raise ParityFailure("remote-file-count-excessive")
            for info in members:
                # Reject archive links; never extract to disk.
                if ((info.external_attr >> 16) & 0o170000) == 0o120000:
                    raise ParityFailure("remote-symlink-rejected")
                key = safe_path(info.filename)
                if key in result or info.file_size > MAX_REMOTE_BYTES:
                    raise ParityFailure("remote-duplicate-or-large-file")
                result[key] = archive.read(info)
    else:
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except (UnicodeError, ValueError):
            raise ParityFailure("remote-format-unrecognized") from None
        files = parsed.get("files") if isinstance(parsed, dict) else parsed
        if not isinstance(files, list) or len(files) > MAX_FILES:
            raise ParityFailure("remote-file-list-invalid")
        for item in files:
            if not isinstance(item, dict) or not {"name", "content"}.issubset(item):
                raise ParityFailure("remote-file-entry-invalid")
            key = safe_path(item["name"])
            value = item["content"]
            if key in result or not isinstance(value, str):
                raise ParityFailure("remote-file-entry-invalid")
            result[key] = value.encode("utf-8")
    if not result:
        raise ParityFailure("remote-source-empty")
    return result


def read_deployed_bundle(project: str, function: str, token: str, sender=None) -> bytes:
    if not PROJECT_REF.fullmatch(project) or function not in MODES or not token:
        raise ParityFailure("management-request-configuration-invalid")
    target = ("https://api.supabase.com/v1/projects/" + project +
              "/functions/" + function + "/body")
    request = urllib.request.Request(target, headers={
        "Authorization": "Bearer " + token,
        "Accept": "multipart/form-data, application/octet-stream, application/json",
        "Cache-Control": "no-store",
    }, method="GET")
    if sender is None:
        class RejectRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, url):
                return None
        sender = urllib.request.build_opener(RejectRedirect()).open
    try:
        with sender(request, timeout=15) as response:
            if response.status != 200 or response.geturl() != target:
                raise ParityFailure("management-response-invalid")
            raw = response.read(MAX_REMOTE_BYTES + 1)
            headers = getattr(response, "headers", None)
            content_type = headers.get("Content-Type", "") if headers is not None else ""
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ParityFailure("management-unavailable") from None
    if len(raw) > MAX_REMOTE_BYTES:
        raise ParityFailure("management-response-too-large")
    if content_type.lower().startswith("multipart/"):
        return _multipart_source_payload(raw, content_type)
    return raw


def prove(function: str, raw: bytes, *, mode: str, root: Path = SOURCE_ROOT) -> dict:
    canonical = canonical_import_graph(function, root)
    remote = extract_files(raw)
    # Non-source archive metadata may be generated by the Management API,
    # but no executable .ts/.mjs/.js file outside the reviewed import graph
    # is allowed, and every import must be present.
    remote_source = {path: body for path, body in remote.items()
                     if PurePosixPath(path).suffix in ALLOWED_SUFFIXES}
    required = set(canonical)
    if mode == "preflight":
        # The *old* release must be readable before we replace it. Its
        # import graph is expected to differ from main and must not be
        # rejected merely because a new file has not been deployed yet.
        prior_baseline = {function + "/index.ts", "_shared/account_transport_admission.mjs"}
        if not prior_baseline.issubset(remote_source):
            raise ParityFailure("prior-deployment-unreadable")
        inventory = set(remote_source)
    elif mode == "verify":
        if not required.issubset(remote_source):
            raise ParityFailure("deployed-import-missing")
        if set(remote_source) != required:
            raise ParityFailure("deployed-import-inventory-drift")
        if any(remote_source[path] != content for path, content in canonical.items()):
            raise ParityFailure("deployed-source-content-drift")
        inventory = required
    else:
        raise ParityFailure("proof-mode-invalid")
    digest = hashlib.sha256()
    for path in sorted(inventory):
        encoded = path.encode("utf-8")
        data = remote_source[path]
        digest.update(len(encoded).to_bytes(4, "big") + encoded)
        digest.update(len(data).to_bytes(8, "big") + data)
    return {"schema": "ordax.account-gateway-deployed-source-parity/1",
            "function": function, "mode": mode, "files": len(inventory),
            "status": "pass", "source_sha256": digest.hexdigest(),
            "subject_data_accessed": False, "deployment_mutated": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--function", required=True, choices=MODES)
    parser.add_argument("--mode", required=True, choices=("preflight", "verify"))
    args = parser.parse_args()
    try:
        data = read_deployed_bundle(
            os.getenv("SUPABASE_PROJECT_REF", ""),
            args.function, os.getenv("SUPABASE_ACCESS_TOKEN", ""))
        print(json.dumps(prove(args.function, data, mode=args.mode),
                         sort_keys=True))
        return 0
    except ParityFailure as exc:
        # No response bodies, tokens, account identifiers, or source text.
        print("ACCOUNT_GATEWAY_SOURCE_PARITY=FAILED reason=" + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
