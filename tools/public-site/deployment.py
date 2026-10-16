#!/usr/bin/env python3
"""Compose independently verified portal and Web artifacts for one origin."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import shutil
import sys
import tempfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
RUNTIME_PATH = "/ordax/"
MANIFEST = "public-deployment-manifest.json"
SCHEMA = "prototype-ordax.public-deployment/1"
RECIPE_INPUTS = ("tools/public-site/deployment.py", "vercel.json", "docs/contracts/public-site-deployment.json")


def load_builder(name: str, relative: str):
    path = ROOT / relative
    if str(path.parent) not in sys.path:
        sys.path.insert(0, str(path.parent))
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PORTAL = load_builder("_ordax_deployment_portal", "tools/public-site/build.py")
WEB = load_builder("_ordax_deployment_web", "tools/surface-web/build.py")


class DeploymentError(ValueError):
    pass


def records(root: Path) -> list[dict]:
    rows = []
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise DeploymentError("linked deployment input")
        if path.is_file() and path.relative_to(root).as_posix() != MANIFEST:
            payload = path.read_bytes()
            rows.append({"path": path.relative_to(root).as_posix(), "sha256": hashlib.sha256(payload).hexdigest(), "size": len(payload)})
    return rows


def assemble(portal: Path, web: Path, output: Path) -> dict:
    public_manifest, web_manifest = PORTAL.verify_bundle(portal), WEB.verify_bundle(web)
    if public_manifest["source_commit"] != web_manifest["source_commit"]:
        raise DeploymentError("component commits differ")
    if web_manifest.get("mount_path") != RUNTIME_PATH:
        raise DeploymentError("Web must be compiled for the deployment mount")
    if (portal / RUNTIME_PATH.strip("/")).exists() or (portal / MANIFEST).exists():
        raise DeploymentError("portal owns a reserved deployment path")
    if output.exists():
        raise DeploymentError("deployment output already exists")
    # Reject links before copytree; neither component may redirect a deployment read.
    records(portal)
    records(web)
    shutil.copytree(portal, output)
    shutil.copytree(web, output / RUNTIME_PATH.strip("/"))
    manifest = {"$schema": SCHEMA, "source_commit": public_manifest["source_commit"],
                "portal_manifest": PORTAL.MANIFEST_NAME,
                "runtime_manifest": RUNTIME_PATH.strip("/") + "/" + WEB.MANIFEST_NAME,
                "runtime_path": RUNTIME_PATH, "files": records(output),
                "source_inputs": [{"path": path, "sha256": hashlib.sha256((ROOT / path).read_bytes()).hexdigest()} for path in RECIPE_INPUTS]}
    (output / MANIFEST).write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    verify(output)
    return manifest


def verify(output: Path) -> dict:
    manifest = json.loads((output / MANIFEST).read_text(encoding="utf-8"))
    if manifest.get("$schema") != SCHEMA or manifest.get("runtime_path") != RUNTIME_PATH:
        raise DeploymentError("invalid deployment identity or mount")
    if manifest.get("portal_manifest") != PORTAL.MANIFEST_NAME or manifest.get("runtime_manifest") != "ordax/" + WEB.MANIFEST_NAME:
        raise DeploymentError("invalid component manifest paths")
    if records(output) != manifest.get("files"):
        raise DeploymentError("deployment file integrity mismatch")
    if [row.get("path") for row in manifest.get("source_inputs", [])] != list(RECIPE_INPUTS):
        raise DeploymentError("deployment recipe provenance is missing")
    web = WEB.verify_bundle(output / "ordax")
    # The public builder must still verify an exact portal artifact. Reconstruct
    # only its declared files; do not widen that builder's accepted file set.
    portal_manifest = json.loads((output / PORTAL.MANIFEST_NAME).read_text(encoding="utf-8"))
    portal_paths = [PORTAL.MANIFEST_NAME] + [row["path"] for row in portal_manifest["files"]]
    with tempfile.TemporaryDirectory(prefix="ordax-verify-portal-") as temp:
        portal_root = Path(temp)
        for relative in portal_paths:
            path = PurePosixPath(relative)
            if path.is_absolute() or ".." in path.parts or "\\" in relative or ":" in relative or not path.parts or path.parts[0] == "ordax":
                raise DeploymentError("unsafe portal component path")
            destination = portal_root.joinpath(*path.parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(output.joinpath(*path.parts), destination)
        public = PORTAL.verify_bundle(portal_root)
    expected = set(portal_paths) | {"ordax/" + row["path"] for row in web["files"]} | {"ordax/" + WEB.MANIFEST_NAME}
    if {row["path"] for row in manifest["files"]} != expected:
        raise DeploymentError("deployment contains files outside its components")
    if web.get("mount_path") != RUNTIME_PATH or public["source_commit"] != web["source_commit"] or manifest["source_commit"] != web["source_commit"]:
        raise DeploymentError("component provenance or mount mismatch")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("build")
    build.add_argument("--source-commit", required=True)
    build.add_argument("--out-dir", default="out/public-deployment")
    check = sub.add_parser("verify")
    check.add_argument("--out-dir", default="out/public-deployment")
    args = parser.parse_args()
    try:
        output = Path(args.out_dir)
        if args.command == "build":
            if output.exists():
                raise DeploymentError("deployment output already exists")
            # Components are built by their existing owners, never imported by
            # each other's runtime or rewritten after verification.
            with tempfile.TemporaryDirectory(prefix="ordax-deployment-") as temp:
                stage = Path(temp)
                PORTAL.build_bundle(stage / "portal", args.source_commit)
                WEB.build_bundle(stage / "web", args.source_commit, mount_path=RUNTIME_PATH)
                assemble(stage / "portal", stage / "web", output)
        else:
            verify(output)
        print("PUBLIC_DEPLOYMENT=" + args.command.upper() + "_PASS")
        return 0
    except (ValueError, OSError, PORTAL.PublicSiteError, WEB.BundleError) as error:
        print(f"PUBLIC_DEPLOYMENT_ERROR={error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
