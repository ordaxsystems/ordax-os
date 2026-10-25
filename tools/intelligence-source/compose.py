#!/usr/bin/env python3
"""Candidate Intelligence cutover in a disposable OS tree. Never touches a running OS."""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile

HERE=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location("ordax_intelligence_source_materializer",HERE/"materialize.py")
assert SPEC and SPEC.loader
source=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(source)

WRAPPERS={
"system/services/intelligence/model-router.mjs": """import * as localAi from "../../contracts/local-ai.mjs";
import * as modelRouter from "../../contracts/model-router.mjs";
import { bindModelRouterContracts } from "../../intelligence-source/src/index.mjs";
export const { createModelRouterRuntime } = bindModelRouterContracts({ localAi, modelRouter });
""",
"system/services/intelligence/runtime.mjs": """import * as intelligence from "../../contracts/intelligence.mjs";
import * as localAi from "../../contracts/local-ai.mjs";
import * as modelRouter from "../../contracts/model-router.mjs";
import { bindIntelligenceContracts } from "../../intelligence-source/src/index.mjs";
export const { createIntelligenceRuntime } = bindIntelligenceContracts({ intelligence, localAi, modelRouter });
""",
"system/services/local-ai/runtime.mjs": """import * as localAi from "../../contracts/local-ai.mjs";
import { bindLocalAiContracts } from "../../intelligence-source/src/index.mjs";
export const { createLocalAiRuntime } = bindLocalAiContracts(localAi);
""",
"system/services/local-ai/completion-stream.mjs": """import * as localAi from "../../contracts/local-ai.mjs";
import { bindLocalAiStreamContracts } from "../../intelligence-source/src/index.mjs";
export const { readLocalAiCompletionStream } = bindLocalAiStreamContracts(localAi);
""",
"system/services/local-ai/model-compatibility.mjs": """import * as hardware from "../../contracts/hardware-inventory.mjs";
import * as systemMetrics from "../../contracts/system-metrics.mjs";
import { BUNDLED_LOCAL_AI_MODEL_CANDIDATE } from "./model-candidate.generated.mjs";
import { bindModelCompatibilityContracts } from "../../intelligence-source/src/index.mjs";
export const { LOCAL_AI_MODEL_COMPATIBILITY_SCHEMA, assessBundledLocalAiModel } =
  bindModelCompatibilityContracts({ hardware, systemMetrics, candidate: BUNDLED_LOCAL_AI_MODEL_CANDIDATE });
""",
}

class CompositionError(ValueError):
    pass

def regular_tree(root:Path) -> None:
    if root.is_symlink() or not root.is_dir():
        raise CompositionError("source tree must be a real directory")
    for directory, dirs, files in os.walk(root,followlinks=False):
        for name in dirs + files:
            p=Path(directory)/name
            typ=p.lstat().st_mode
            if not (stat.S_ISREG(typ) or stat.S_ISDIR(typ)):
                raise CompositionError("linked or special file forbidden in staged source")

def verify_intelligence_stage(root: Path, lock:dict) -> dict:
    if root.is_symlink() or not root.is_dir():
        raise CompositionError("intelligence source stage must be a regular tree")
    regular_tree(root)
    receipt_path=root/"intelligence-source-receipt.json"
    if not receipt_path.is_file():
        raise CompositionError("missing external source verification receipt")
    try:
        receipt=json.loads(receipt_path.read_text(encoding="utf-8"))
    except (ValueError,OSError) as exc:
        raise CompositionError("source receipt cannot be decoded") from exc
    if (receipt.get("$schema")!="ordax.intelligence-source-materialization/1"
        or receipt.get("source_repository")!=source.REPO
        or receipt.get("source_commit")!=lock["source_commit"]
        or receipt.get("source_file_count")!=len(source.EXPECTED)
        or receipt.get("target")!=source.TARGET
        or receipt.get("source_only") is not True
        or receipt.get("activation_authorized") is not False
        or receipt.get("model_included") is not False
        or receipt.get("engine_included") is not False):
        raise CompositionError("source receipt and OS lock disagree")
    base=root/"system/intelligence-source"
    if not base.is_dir() or base.is_symlink():
        raise CompositionError("external module staging target missing")
    files=[p for p in base.rglob("*") if p.is_file()]
    names={p.relative_to(base).as_posix() for p in files}
    expected=set(source.EXPECTED)
    if names != expected:
        raise CompositionError("staged Intelligence source graph differs from pin")
    digest=hashlib.sha256()
    for name in sorted(expected):
        payload=(base/name).read_bytes()
        if source.git_blob_sha(payload)!=lock["source_paths"][name]:
            raise CompositionError("staged source integrity mismatch: "+name)
        digest.update(name.encode("utf-8")+b"\0"+hashlib.sha256(payload).digest())
    if digest.hexdigest()!=receipt.get("source_sha256"):
        raise CompositionError("source staging fingerprint mismatch")
    return receipt

def compose(os_root:Path, intelligence_stage:Path, destination:Path, lock_file:Path=source.LOCK_PATH) -> dict:
    os_root=os_root.resolve(strict=True)
    intelligence_stage=intelligence_stage.resolve(strict=True)
    destination=destination.absolute()
    lock=source.load_lock(lock_file)
    verified=verify_intelligence_stage(intelligence_stage,lock)
    origin=os_root/"system"
    regular_tree(origin)
    parent=destination.parent.resolve(strict=True)
    for input_root in (os_root,intelligence_stage):
        if os.path.commonpath((str(destination),str(input_root)))==str(input_root):
            raise CompositionError("cannot overwrite an input source tree")
    if destination.is_symlink() or destination.exists():
        raise CompositionError("refusing to overwrite a candidate tree")
    if not destination.parent.is_dir() or destination.parent.is_symlink():
        raise CompositionError("staging output parent must be regular")
    for old in WRAPPERS:
        p=os_root/old
        if p.is_symlink() or not p.is_file():
            raise CompositionError("OS expected module is missing: "+old)
        if "bindIntelligenceContracts" in p.read_text(encoding="utf-8") or "bindLocalAiContracts" in p.read_text(encoding="utf-8"):
            raise CompositionError("OS source is already migrated; double cutover forbidden")
    tmp=Path(tempfile.mkdtemp(prefix=".ordax-intelligence-composition-",dir=parent))
    try:
        shutil.copytree(origin,tmp/"system",symlinks=False)
        target=tmp/"system/intelligence-source"
        if target.exists() or target.is_symlink():
            raise CompositionError("duplicate external source path in OS")
        shutil.copytree(intelligence_stage/"system/intelligence-source",target,symlinks=False)
        for path,body in WRAPPERS.items():
            dest=tmp/path
            dest.write_text(body,encoding="utf-8")
            dest.chmod(0o644)
        receipt={
            "$schema":"ordax.intelligence-disposable-composition/1",
            "source_repository":source.REPO,
            "source_commit":verified["source_commit"],
            "source_sha256":verified["source_sha256"],
            "replaced_services":sorted(WRAPPERS),
            "legacy_implementation_bytes_packaged":False,
            "os_checkout_mutated":False,
            "activation_authorized":False,
            "surface_ownership_unchanged":True,
            "memory_ownership_unchanged":True
        }
        (target/"source-provenance.json").write_text(json.dumps(receipt,sort_keys=True,indent=2)+"\n",encoding="utf-8")
        regular_tree(tmp/"system")
        os.rename(tmp,destination)
        return receipt
    finally:
        if tmp.exists():
            shutil.rmtree(tmp)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--os-root",type=Path,required=True)
    parser.add_argument("--intelligence-stage",type=Path,required=True)
    parser.add_argument("--out-root",type=Path,required=True)
    parser.add_argument("--lock",type=Path,default=source.LOCK_PATH)
    args=parser.parse_args()
    print(json.dumps(compose(args.os_root,args.intelligence_stage,args.out_root,args.lock),sort_keys=True))

if __name__=="__main__":
    main()
