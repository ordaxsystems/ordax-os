#!/usr/bin/env python3
"""Compile and receipt the canonical OrdaX Web Surface with locked, bundled dependencies."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import subprocess
import tempfile
from pathlib import Path, PurePosixPath

TOOLS = Path(__file__).resolve().parents[1]
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

from source_graph import (
    SourceGraphError,
    discover_graph as discover_source_graph,
    require_source_path,
)

ROOT = Path(__file__).resolve().parents[2]
ENTRYPOINT = PurePosixPath("system/composition/web/index.html")
MANIFEST_NAME = "web-client-manifest.json"
SCHEMA = "prototype-ordax.web-client-bundle/1"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
MANIFEST_FIELDS = frozenset({
    "$schema", "status", "source_commit", "source_graph_entrypoint",
    "entrypoint", "mount_path", "remote_runtime_dependencies",
    "framework_runtime_dependency", "framework_runtime_delivery",
    "node_required_at_client", "source_inputs", "files",
})

class BundleError(RuntimeError):
    pass


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_bundle_path(value: object) -> str:
    """A receipt has exactly one lexical name for each packaged file."""
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise BundleError("unsafe Web bundle path")
    path = PurePosixPath(value)
    if (
        path.is_absolute() or not path.parts or ".." in path.parts
        or path.as_posix() != value
    ):
        raise BundleError(f"non-canonical Web bundle path: {value!r}")
    return value


def validate_bundle_manifest(manifest: object) -> tuple[dict[str, dict], set[str]]:
    """Validate the producer's ONE receipt shape before reading any assets."""
    if not isinstance(manifest, dict) or set(manifest) != MANIFEST_FIELDS:
        raise BundleError("Web client manifest fields are not canonical")
    if manifest["$schema"] != SCHEMA or manifest["status"] != "candidate":
        raise BundleError("unexpected Web client manifest schema or status")
    if not isinstance(manifest["source_commit"], str) or not SHA40_RE.fullmatch(manifest["source_commit"]):
        raise BundleError("manifest source_commit is invalid")
    if (manifest["entrypoint"] != "index.html"
            or manifest["source_graph_entrypoint"] != ENTRYPOINT.as_posix()):
        raise BundleError("Web client source/compiled entrypoint mismatch")
    mount = manifest["mount_path"]
    if not isinstance(mount, str) or not re.fullmatch(r"/(?:[a-z0-9-]+/)*", mount):
        raise BundleError("invalid Web mount path")
    if (manifest["remote_runtime_dependencies"] is not False
            or manifest["framework_runtime_dependency"] is not True
            or manifest["framework_runtime_delivery"] != "bundled-local-assets"
            or manifest["node_required_at_client"] is not False):
        raise BundleError("Web client framework/runtime policy is invalid")

    source_inputs = manifest["source_inputs"]
    if not isinstance(source_inputs, list) or not source_inputs:
        raise BundleError("Web source input records are missing")
    source_names: set[str] = set()
    for record in source_inputs:
        if not isinstance(record, dict) or set(record) != {"path", "sha256"}:
            raise BundleError("Web source input record is malformed")
        name = canonical_bundle_path(record["path"])
        if name in source_names:
            raise BundleError("Web source input paths must be unique")
        source_names.add(name)
        digest = record["sha256"]
        if not isinstance(digest, str) or not SHA256_RE.fullmatch(digest):
            raise BundleError("Web source input hash is invalid")
    if ENTRYPOINT.as_posix() not in source_names:
        raise BundleError("Web client source entrypoint is not bound by receipt")

    records = manifest["files"]
    if not isinstance(records, list) or not records:
        raise BundleError("Web client file records are missing")
    expected: dict[str, dict] = {}
    for record in records:
        if not isinstance(record, dict) or set(record) != {"path", "sha256", "size"}:
            raise BundleError("Web client file record is malformed")
        name = canonical_bundle_path(record["path"])
        if name == MANIFEST_NAME or name in expected:
            raise BundleError("Web client file paths must be unique and exclude the receipt")
        digest, size = record["sha256"], record["size"]
        if not isinstance(digest, str) or not SHA256_RE.fullmatch(digest):
            raise BundleError("Web client file hash is invalid")
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            raise BundleError("Web client file size is invalid")
        expected[name] = record
    if "index.html" not in expected:
        raise BundleError("Web client compiled entrypoint is not bound by receipt")
    return expected, source_names


def discover_graph(root: Path = ROOT) -> list[PurePosixPath]:
    """Build inputs owned by Surface, thin composition, shared boot/i18n and one lock."""
    inputs = {
        ENTRYPOINT,
        PurePosixPath("system/composition/web/main.tsx"),
        PurePosixPath("system/composition/web/auth-entry-gate.mjs"),
        PurePosixPath("package.json"), PurePosixPath("package-lock.json"),
        PurePosixPath("tools/surface-web/package.json"),
        PurePosixPath("tools/surface-web/vite.config.ts"),
        PurePosixPath("tools/surface-web/dependency-styles.mjs"),
        PurePosixPath("tools/surface-web/tsconfig.json"),
        PurePosixPath("docs/evidence/web-layout-reference-2026-10-10.json"),
        PurePosixPath("docs/evidence/web-central-reference-2026-10-11.json"),
        PurePosixPath("system/surface/ui/brand/ordax-symbol.png"),
        PurePosixPath("system/services/local-ai/source-lock.json"),
        PurePosixPath("third_party/licenses/Inter-OFL-1.1.txt"),
    }
    for subtree in ("system/surface/workspace",):
        try:
            require_source_path(root, PurePosixPath(subtree), directory=True)
        except SourceGraphError as exc:
            raise BundleError(f"untrusted Web source directory: {exc}") from exc
        inputs.update(PurePosixPath(p.relative_to(root).as_posix())
                      for p in (root / subtree).rglob("*") if p.is_file())
    for entry in ("system/surface/ui/boot-screen.mjs", "system/surface/ui/boot-screen.css",
                  "system/surface/ui/tokens.css", "system/services/i18n/surface.mjs",
                  "system/surface/ui/notification-center-controls.mjs", "system/surface/ui/notification-center.css",
                  "system/contracts/app-store.mjs", "system/services/local-ai/model-candidate.generated.mjs",
                  "system/composition/web/account-session.mjs",
                  "system/adapters/web/preferences.mjs",
                  "system/services/preferences/runtime.mjs",
                  "system/services/spaces/authorized-view.mjs"):
        inputs.update(discover_source_graph(root, PurePosixPath(entry),
                                           allowed_prefixes=("system",)))
    for relative in inputs:
        try:
            require_source_path(root, relative)
        except SourceGraphError as exc:
            raise BundleError(f"missing or linked Web input: {relative}: {exc}") from exc
    root_package = json.loads((root / "package.json").read_text(encoding="utf-8"))
    lock = json.loads((root / "package-lock.json").read_text(encoding="utf-8"))
    for group in ("dependencies", "devDependencies"):
        if root_package.get(group, {}) != lock["packages"][""].get(group, {}):
            raise BundleError(f"root package/lock mismatch: {group}")
    if (root / "tools/web2-preview").exists():
        raise BundleError("test workspace must be removed after canonical cutover")
    return sorted(inputs, key=str)


def compile_frontend(root: Path = ROOT, mount_path: str = "/") -> Path:
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if npm is None:
        raise BundleError("Node/npm are required only on the build host")
    result = subprocess.run([npm, "run", "build", "--workspace", "tools/surface-web", "--", "--base", mount_path],
                            cwd=root, check=False)
    if result.returncode:
        raise BundleError("canonical Web typecheck/build failed")
    compiled = root / "out/web-ui"
    if not (compiled / "index.html").is_file():
        raise BundleError("canonical frontend build did not emit index.html")
    return compiled


def build_bundle(out_dir: Path, source_commit: str, root: Path = ROOT, mount_path: str = "/") -> dict:
    if not SHA40_RE.fullmatch(source_commit):
        raise BundleError("source commit must be a full lowercase 40-hex Git SHA")
    if not re.fullmatch(r"/(?:[a-z0-9-]+/)*", mount_path):
        raise BundleError("mount path must be a bounded same-origin directory")
    if out_dir.exists() and any(out_dir.iterdir()):
        raise BundleError(f"refusing to replace non-empty output directory: {out_dir}")

    graph = discover_graph(root)
    compiled = compile_frontend(root, mount_path)
    out_dir.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".ordax-web-client-", dir=out_dir.parent))
    try:
        for source in compiled.rglob("*"):
            if source.is_symlink():
                raise BundleError(f"linked compiled asset: {source}")
            if source.is_file():
                destination = stage / source.relative_to(compiled)
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, destination)
        shutil.copyfile(root / "third_party/licenses/Inter-OFL-1.1.txt", stage / "Inter-LICENSE.txt")

        records = []
        for path in sorted((p for p in stage.rglob("*") if p.is_file()), key=lambda item: item.relative_to(stage).as_posix()):
            relative = path.relative_to(stage).as_posix()
            payload = path.read_bytes()
            records.append({"path": relative, "sha256": sha256_bytes(payload), "size": len(payload)})

        manifest = {
            "$schema": SCHEMA,
            "status": "candidate",
            "source_commit": source_commit,
            "source_graph_entrypoint": ENTRYPOINT.as_posix(),
            "entrypoint": "index.html",
            "mount_path": mount_path,
            "remote_runtime_dependencies": False,
            "framework_runtime_dependency": True,
            "framework_runtime_delivery": "bundled-local-assets",
            "node_required_at_client": False,
            "source_inputs": [{"path": str(path), "sha256": sha256_bytes((root / path).read_bytes())} for path in graph],
            "files": records,
        }
        (stage / MANIFEST_NAME).write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )

        if out_dir.exists():
            out_dir.rmdir()
        os.replace(stage, out_dir)
        stage = None
        return manifest
    finally:
        if stage is not None:
            shutil.rmtree(stage, ignore_errors=True)


def verify_bundle(out_dir: Path) -> dict:
    # A bundle whose directory, receipt, asset, or any nested directory is a
    # symlink is NOT the immutable output the canonical compiler produced.
    # Path.is_file() follows links and must never be an attestation primitive.
    if not out_dir.is_dir() or out_dir.is_symlink():
        raise BundleError("Web client bundle root is not a real directory")
    manifest_path = out_dir / MANIFEST_NAME
    if not manifest_path.is_file() or manifest_path.is_symlink():
        raise BundleError(f"missing or linked {MANIFEST_NAME}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected, _source_names = validate_bundle_manifest(manifest)

    actual: dict[str, Path] = {}
    for path in out_dir.rglob("*"):
        relative = path.relative_to(out_dir).as_posix()
        if path.is_symlink():
            raise BundleError(f"linked Web bundle path: {relative}")
        if path.is_dir():
            continue
        if not path.is_file():
            raise BundleError(f"non-regular Web bundle path: {relative}")
        if relative == MANIFEST_NAME:
            continue
        actual[relative] = path
    if set(actual) != set(expected):
        raise BundleError(f"bundle file set mismatch: expected={sorted(expected)} actual={sorted(actual)}")

    for relative, path in actual.items():
        payload = path.read_bytes()
        record = expected[relative]
        if len(payload) != record["size"] or sha256_bytes(payload) != record["sha256"]:
            raise BundleError(f"bundle integrity mismatch: {relative}")

    index_text = (out_dir / "index.html").read_text(encoding="utf-8")
    if "../" in index_text or "http://" in index_text or "https://" in index_text:
        raise BundleError("root index contains a forbidden external/traversal reference")
    return manifest


def command_check() -> int:
    graph = discover_graph(ROOT)
    print("WEB_CLIENT_SOURCE_GRAPH=PASS")
    print(f"WEB_CLIENT_SOURCE_FILE_COUNT={len(graph)}")
    return 0


def command_build(args: argparse.Namespace) -> int:
    manifest = build_bundle(Path(args.out_dir), args.source_commit, mount_path=args.mount_path)
    print("WEB_CLIENT_BUILD=PASS")
    print(f"WEB_CLIENT_FILE_COUNT={len(manifest['files'])}")
    return 0


def command_verify(args: argparse.Namespace) -> int:
    manifest = verify_bundle(Path(args.out_dir))
    print("WEB_CLIENT_VERIFY=PASS")
    print(f"WEB_CLIENT_SOURCE_COMMIT={manifest['source_commit']}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    build = sub.add_parser("build")
    build.add_argument("--out-dir", default="out/web-client")
    build.add_argument("--source-commit", required=True)
    build.add_argument("--mount-path", default="/")
    verify = sub.add_parser("verify")
    verify.add_argument("--out-dir", default="out/web-client")
    args = parser.parse_args(argv)

    try:
        if args.command == "check":
            return command_check()
        if args.command == "build":
            return command_build(args)
        return command_verify(args)
    except (BundleError, SourceGraphError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"WEB_CLIENT_ERROR={exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
