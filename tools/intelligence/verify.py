#!/usr/bin/env python3
"""Verify OrdaX Intelligence bytes against the same OS Git commit, offline."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "docs/contracts/intelligence-source.json"
PORTS = ("ordax.intelligence/1", "ordax.model-router/1", "ordax.local-ai/1")
FACADES = (
    "system/services/intelligence/runtime.mjs",
    "system/services/intelligence/model-router.mjs",
    "system/services/local-ai/runtime.mjs",
    "system/services/local-ai/completion-stream.mjs",
    "system/services/local-ai/model-compatibility.mjs",
)
class IntelligenceIntegrityError(ValueError):
    pass

def git(*args: str) -> str:
    p = subprocess.run(("git", "-C", str(ROOT), *args), capture_output=True, text=True)
    if p.returncode:
        raise IntelligenceIntegrityError("OS Git object unavailable")
    return p.stdout.strip()

def commit() -> str:
    sha = git("rev-parse", "HEAD")
    if not re.fullmatch(r"[a-f0-9]{40}", sha):
        raise IntelligenceIntegrityError("invalid OS Git revision")
    return sha

def tracked() -> dict[str,str]:
    paths = git("ls-tree", "-r", "HEAD", "--", "system/intelligence/src",
                "system/intelligence/tools", *FACADES)
    blobs = {}
    for row in paths.splitlines():
        metadata, path = row.split("\t", 1)
        mode, typ, blob = metadata.split()
        if mode != "100644" or typ != "blob" or path in blobs:
            raise IntelligenceIntegrityError("Intelligence source contains untrusted Git entry")
        blobs[path] = blob
    if not all(name in blobs for name in FACADES):
        raise IntelligenceIntegrityError("missing canonical Native adapter")
    if not all(name in blobs for name in (
        "system/intelligence/src/index.mjs",
        "system/intelligence/src/contract-bindings.mjs",
        "system/intelligence/tools/inference-builder/build.py")):
        raise IntelligenceIntegrityError("incomplete Intelligence core")
    return blobs

def verify(root: Path, *, need_receipt=False) -> dict:
    root = root.resolve(strict=True)
    policy = json.loads(CONTRACT.read_text(encoding="utf-8"))
    if (policy.get("$schema") != "prototype-ordax.intelligence-source/2"
        or policy.get("status") != "canonical"
        or policy.get("source_repository") != "ordaxsystems/ordax-os"
        or policy.get("source_root") != "system/intelligence"
        or policy.get("source_revision") != "same-os-commit"
        or policy.get("public_ports") != list(PORTS)
        or policy.get("activation_authorized") is not False
        or policy.get("model_bytes_included") is not False
        or policy.get("engine_bytes_included") is not False):
        raise IntelligenceIntegrityError("canonical Intelligence source policy invalid")
    identities = tracked()
    h = hashlib.sha256()
    for path, blob in sorted(identities.items()):
        target = root / path
        ancestor = root
        for segment in Path(path).parts:
            ancestor = ancestor / segment
            if ancestor.is_symlink():
                raise IntelligenceIntegrityError("linked Intelligence path: " + path)
        if not target.is_file():
            raise IntelligenceIntegrityError("missing Intelligence file: " + path)
        payload = target.read_bytes()
        if len(payload) > 262144:
            raise IntelligenceIntegrityError("oversized Intelligence source: " + path)
        # Git normalizes checkout line endings on Windows; verify through the
        # committed clean filter and fingerprint canonical Git object bytes.
        result = subprocess.run(
            ("git", "-C", str(ROOT), "hash-object", "--path", path, str(target)),
            capture_output=True, text=True,
        )
        if result.returncode or result.stdout.strip() != blob:
            raise IntelligenceIntegrityError("Intelligence Git blob drift: " + path)
        canonical = subprocess.run(
            ("git", "-C", str(ROOT), "cat-file", "blob", blob),
            capture_output=True,
        )
        if canonical.returncode:
            raise IntelligenceIntegrityError("Intelligence canonical Git bytes unavailable")
        h.update(path.encode() + b"\0" + hashlib.sha256(canonical.stdout).digest())
    # No additional imported source or builder files can ride inside a
    # stage, even if none of the public facades imports them today.
    for prefix in ("system/intelligence/src", "system/intelligence/tools"):
        folder=root / prefix
        for item in folder.rglob("*"):
            name=item.relative_to(root).as_posix()
            if item.is_symlink() or (not item.is_file() and not item.is_dir()):
                raise IntelligenceIntegrityError("unsafe Intelligence staged entry: " + name)
            if item.is_file() and name not in identities:
                # Developer-only bytecode is excluded by Git archive. Never
                # allow extra files in a disposable release candidate.
                if root == ROOT.resolve() and "__pycache__" in item.parts and item.suffix == ".pyc":
                    continue
                raise IntelligenceIntegrityError("untracked Intelligence staged file: " + name)
    receipt = {
        "$schema":"ordax.intelligence-same-commit/1",
        "source_repository":"ordaxsystems/ordax-os",
        "source_commit":commit(),
        "source_root":"system/intelligence",
        "source_sha256":h.hexdigest(),
        "source_file_count":len(identities),
        "public_ports":list(PORTS),
        "model_included":False,
        "engine_included":False,
        "activation_authorized":False,
        "physical_apply_authorized":False,
    }
    if need_receipt:
        stored=root/"system/intelligence/source-provenance.json"
        if stored.is_symlink() or not stored.is_file() or json.loads(stored.read_text(encoding="utf-8")) != receipt:
            raise IntelligenceIntegrityError("Intelligence same-commit provenance missing or tampered")
    return receipt

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--root",type=Path,default=ROOT)
    ap.add_argument("--write-receipt",action="store_true")
    ap.add_argument("--require-receipt",action="store_true")
    args=ap.parse_args()
    record=verify(args.root,need_receipt=args.require_receipt)
    if args.write_receipt:
        if args.root.resolve() == ROOT.resolve():
            raise IntelligenceIntegrityError("refuse to generate staging receipt inside Git checkout")
        dst=args.root/"system/intelligence/source-provenance.json"
        if dst.is_symlink():
            raise IntelligenceIntegrityError("unsafe source receipt")
        dst.write_text(json.dumps(record,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(record,sort_keys=True))
if __name__=="__main__":
    main()
