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
)

ROOT = Path(__file__).resolve().parents[2]
ENTRYPOINT = PurePosixPath("system/composition/web/index.html")
MANIFEST_NAME = "web-client-manifest.json"
SCHEMA = "prototype-ordax.web-client-bundle/1"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")

class BundleError(RuntimeError):
    pass


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def discover_graph(root: Path = ROOT) -> list[PurePosixPath]:
    """Build inputs owned by Surface, thin composition, shared boot/i18n and one lock."""
    inputs = {
        ENTRYPOINT, PurePosixPath("system/composition/web/main.tsx"),
        PurePosixPath("package.json"), PurePosixPath("package-lock.json"),
        PurePosixPath("tools/surface-web/package.json"),
        PurePosixPath("tools/surface-web/vite.config.ts"),
        PurePosixPath("tools/surface-web/tsconfig.json"),
        PurePosixPath("docs/evidence/web-layout-reference-2026-10-10.json"),
        PurePosixPath("docs/evidence/web-central-reference-2026-10-11.json"),
        PurePosixPath("system/surface/ui/brand/ordax-symbol.png"),
        PurePosixPath("system/services/local-ai/source-lock.json"),
        PurePosixPath("third_party/licenses/Inter-OFL-1.1.txt"),
    }
    for subtree in ("system/surface/workspace",):
        inputs.update(PurePosixPath(p.relative_to(root).as_posix())
                      for p in (root / subtree).rglob("*") if p.is_file())
    for entry in ("system/surface/ui/boot-screen.mjs", "system/surface/ui/boot-screen.css",
                  "system/surface/ui/tokens.css", "system/services/i18n/surface.mjs",
                  "system/contracts/app-store.mjs", "system/services/local-ai/model-candidate.generated.mjs"):
        inputs.update(discover_source_graph(root, PurePosixPath(entry),
                                           allowed_prefixes=("system",)))
    for relative in inputs:
        path = root / relative
        if not path.is_file() or path.is_symlink():
            raise BundleError(f"missing or linked Web input: {relative}")
    root_package = json.loads((root / "package.json").read_text(encoding="utf-8"))
    lock = json.loads((root / "package-lock.json").read_text(encoding="utf-8"))
    for group in ("dependencies", "devDependencies"):
        if root_package.get(group, {}) != lock["packages"][""].get(group, {}):
            raise BundleError(f"root package/lock mismatch: {group}")
    if (root / "tools/web2-preview").exists():
        raise BundleError("test workspace must be removed after canonical cutover")
    return sorted(inputs, key=str)


def compile_frontend(root: Path = ROOT) -> Path:
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if npm is None:
        raise BundleError("Node/npm are required only on the build host")
    result = subprocess.run([npm, "run", "build", "--workspace", "tools/surface-web"],
                            cwd=root, check=False)
    if result.returncode:
        raise BundleError("canonical Web typecheck/build failed")
    compiled = root / "out/web-ui"
    if not (compiled / "index.html").is_file():
        raise BundleError("canonical frontend build did not emit index.html")
    return compiled


def build_bundle(out_dir: Path, source_commit: str, root: Path = ROOT) -> dict:
    if not SHA40_RE.fullmatch(source_commit):
        raise BundleError("source commit must be a full lowercase 40-hex Git SHA")
    if out_dir.exists() and any(out_dir.iterdir()):
        raise BundleError(f"refusing to replace non-empty output directory: {out_dir}")

    graph = discover_graph(root)
    compiled = compile_frontend(root)
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
    manifest_path = out_dir / MANIFEST_NAME
    if not manifest_path.is_file():
        raise BundleError(f"missing {MANIFEST_NAME}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("$schema") != SCHEMA:
        raise BundleError("unexpected Web client manifest schema")
    if not SHA40_RE.fullmatch(str(manifest.get("source_commit", ""))):
        raise BundleError("manifest source_commit is invalid")
    if manifest.get("entrypoint") != "index.html" or not (out_dir / "index.html").is_file():
        raise BundleError("Web client root entrypoint is missing")
    if manifest.get("remote_runtime_dependencies") is not False:
        raise BundleError("Web client may not gain an undeclared remote runtime dependency")

    expected = {record["path"]: record for record in manifest.get("files", [])}
    actual = {
        path.relative_to(out_dir).as_posix(): path
        for path in out_dir.rglob("*")
        if path.is_file() and path.name != MANIFEST_NAME
    }
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
    manifest = build_bundle(Path(args.out_dir), args.source_commit)
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
    verify = sub.add_parser("verify")
    verify.add_argument("--out-dir", default="out/web-client")
    args = parser.parse_args(argv)

    try:
        if args.command == "check":
            return command_check()
        if args.command == "build":
            return command_build(args)
        return command_verify(args)
    except (BundleError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"WEB_CLIENT_ERROR={exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
