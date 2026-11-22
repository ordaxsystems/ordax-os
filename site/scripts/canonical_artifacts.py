#!/usr/bin/env python3
"""Same-commit OS visual artifact producer. No historical release or second owner."""
from __future__ import annotations
import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OWNER = "ordaxsystems/ordax-os"
SHA40 = re.compile(r"[0-9a-f]{40}\Z")
INPUTS = {
 "assets/ordax-symbol.png": "system/surface/ui/brand/ordax-symbol.png",
 "assets/ordax-landscape.png": "system/surface/ui/brand/midnight-landscape.png",
 "assets/fonts/inter-latin-wght-normal.woff2": "system/surface/ui/fonts/inter-latin-wght-normal.woff2",
 "assets/fonts/Inter-OFL-1.1.txt": "third_party/licenses/Inter-OFL-1.1.txt",
}
CSS_INPUTS = ("system/surface/ui/tokens.css", "system/surface/ui/meridian.tokens.css",
              "system/surface/ui/brand/symbol.css")
LICENSE_BLOB = "556792990d740c111b4fee7fe1938dc90bcee2ce"

class ArtifactError(ValueError):
 pass

def sha(data):
 return hashlib.sha256(data).hexdigest()

def load(path,name):
 spec=importlib.util.spec_from_file_location(name,ROOT/path)
 if spec is None or spec.loader is None:raise ArtifactError("canonical module unavailable")
 module=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(module)
 return module

def verify_os(commit):
 if not isinstance(commit,str) or not SHA40.fullmatch(commit):
  raise ArtifactError("exact OS source Git SHA required")
 surface=load("tools/surface-source/materialize.py","site_surface_source")
 _,proof=surface.verify_source(ROOT,surface.load_lock(ROOT/"docs/contracts/surface-source.json"))
 if proof["source_commit"]!=commit or proof["source_repository"]!=OWNER:
  raise ArtifactError("unverified same-commit Surface source")

def tracked(name,commit):
 file=ROOT/name
 if file.is_symlink() or not file.is_file():raise ArtifactError("missing canonical input: "+name)
 result=subprocess.run(["git","-C",str(ROOT),"rev-parse",commit+":"+name],
                       capture_output=True,text=True,timeout=10)
 if result.returncode:raise ArtifactError("untracked Git source: "+name)
 data=file.read_bytes()
 gitblob=hashlib.sha1(b"blob "+str(len(data)).encode()+b"\0"+data).hexdigest()
 if gitblob!=result.stdout.strip() and name.endswith((".css",".txt")):
  # Windows checkout may use CRLF for an unchanged committed Git text blob.
  normalized=data.replace(b"\r\n",b"\n")
  if hashlib.sha1(b"blob "+str(len(normalized)).encode()+b"\0"+normalized).hexdigest()==result.stdout.strip():
   data=normalized
   gitblob=result.stdout.strip()
 if gitblob!=result.stdout.strip():raise ArtifactError("modified OS source: "+name)
 status=subprocess.run(["git","-C",str(ROOT),"status","--porcelain","--",name],
                       capture_output=True,text=True,timeout=10)
 if status.returncode or status.stdout.strip():raise ArtifactError("dirty canonical Git source: "+name)
 if name=="third_party/licenses/Inter-OFL-1.1.txt" and (gitblob!=LICENSE_BLOB or
    b"SIL OPEN FONT LICENSE Version 1.1" not in data):
  raise ArtifactError("invalid font license")
 return data,{"repository":OWNER,"commit":commit,"path":name,
              "git_blob":gitblob,"sha256":sha(data)}

def brand(destination,commit):
 verify_os(commit)
 if destination.exists() or destination.is_symlink():raise ArtifactError("brand output exists")
 renderer=load("tools/brand/build.py","site_brand_renderer")
 files={}
 sources=[]
 for dst,src in INPUTS.items():
  files[dst],proof=tracked(src,commit)
  sources.append(proof)
 for src in CSS_INPUTS:
  _,proof=tracked(src,commit)
  sources.append(proof)
 files["assets/ordax-design-tokens.css"]=renderer.render_site_identity_css().encode()
 files["assets/ordax-font.css"]=renderer.render_site_font_css().encode()
 if b'url("./fonts/inter-latin-wght-normal.woff2")' not in files["assets/ordax-font.css"]:
  raise ArtifactError("font URL not locally resolvable")
 if b"@import" in files["assets/ordax-design-tokens.css"]:
  raise ArtifactError("remote CSS import forbidden")
 manifest={"$schema":"ordax.surface-brand-artifact/2",
  "artifact_class":"ordax-brand","status":"candidate-not-published",
  "immutable":True,"source_repository":OWNER,"source_commit":commit,
  "sources":sorted(sources,key=lambda row:row["path"]),
  "files":[{"path":name,"size":len(data),"sha256":sha(data)}
           for name,data in sorted(files.items())]}
 stage=Path(tempfile.mkdtemp(prefix=".site-brand-",dir=destination.parent))
 try:
  for name,data in files.items():
   target=stage/name
   target.parent.mkdir(parents=True,exist_ok=True)
   target.write_bytes(data)
  payload=(json.dumps(manifest,indent=2,sort_keys=True)+"\n").encode()
  (stage/"manifest.json").write_bytes(payload)
  stage.rename(destination)
 finally:
  if stage.exists():shutil.rmtree(stage)
 return {"source_commit":commit,"manifest_sha256":sha(payload),
         "file_count":len(files)}

def preview(destination,commit):
 verify_os(commit)
 if destination.exists() or destination.is_symlink():raise ArtifactError("preview output exists")
 proc=subprocess.run(["node",str(ROOT/"site/scripts/canonical-preview.mjs"),
                     str(destination),commit],cwd=ROOT,capture_output=True,
                     text=True,timeout=180)
 if proc.returncode:raise ArtifactError("canonical Vite preview failed: "+proc.stderr[-1200:])
 path=destination/"manifest.json"
 if path.is_symlink() or not path.is_file():raise ArtifactError("preview manifest missing")
 payload=path.read_bytes()
 data=json.loads(payload)
 if data.get("source_repository")!=OWNER or data.get("source_commit")!=commit or data.get("runtime_authority") is not False:
  raise ArtifactError("preview identity mismatch")
 return {"source_commit":commit,"manifest_sha256":sha(payload),
         "file_count":len(data["files"])}

if __name__=="__main__":
 try:
  if len(sys.argv)!=4 or sys.argv[1] not in ("brand","preview"):
   raise ArtifactError("usage: canonical_artifacts.py brand|preview OUTPUT COMMIT")
  out=Path(sys.argv[2]).resolve()
  if out.is_relative_to(ROOT) or ROOT.is_relative_to(out):
   raise ArtifactError("output overlaps OS source")
  out.parent.mkdir(parents=True,exist_ok=True)
  result=brand(out,sys.argv[3]) if sys.argv[1]=="brand" else preview(out,sys.argv[3])
  print(json.dumps(result,sort_keys=True))
 except (ArtifactError,OSError,ValueError) as exc:
  raise SystemExit("SITE_ARTIFACT_ERROR="+str(exc))
