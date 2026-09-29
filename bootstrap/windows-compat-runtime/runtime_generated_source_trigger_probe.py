#!/usr/bin/env python3
"""Inventory logical Wine build triggers for generated C sources."""
from __future__ import annotations
import argparse, hashlib, importlib.util, json, re, sys, tarfile
from pathlib import Path, PurePosixPath

HERE = Path(__file__).resolve().parent
CONTRACT_PATH = HERE / "runtime-generated-source-triggers.json"
SOURCE_LOCK_PATH = HERE / "source.json"
PRODUCER_PATH = HERE / "runtime_generated_source_producer_probe.py"
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-generated-source-trigger-proof/1"
MAX_MAKEFILE_BYTES = 2 * 1024 * 1024
MAX_TRIGGER_SOURCE_BYTES = 8 * 1024 * 1024
ASSIGN_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(\+=|:=|=)\s*(.*)$")
VAR_RE = re.compile(r"\$\(([A-Za-z_][A-Za-z0-9_]*)\)|\$\{([A-Za-z_][A-Za-z0-9_]*)\}")
PRAGMA_RE = re.compile(r"(?m)^\s*#\s*pragma\s+makedep(?:\s+([^\r\n]+))?\s*$")

class GeneratedSourceTriggerError(RuntimeError): pass

def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None: raise GeneratedSourceTriggerError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module
PRODUCER = load_module("ordax_generated_source_producer_for_triggers", PRODUCER_PATH)

def canonical_sha256(value): return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
def load_json(path, label):
    try: value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc: raise GeneratedSourceTriggerError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict): raise GeneratedSourceTriggerError(f"{label} must be an object")
    return value

def load_contract():
    value = load_json(CONTRACT_PATH, "generated source trigger contract")
    if value.get("$schema") != "prototype-ordax.windows-compat-runtime-generated-source-triggers/1": raise GeneratedSourceTriggerError("unexpected generated source trigger contract schema")
    if value.get("status") != "source-trigger-inventory-only-not-generated-output-inventory-complete": raise GeneratedSourceTriggerError("generated source trigger status drifted")
    sem = value.get("trigger_semantics", {})
    if sem.get("unresolved_make_expansion_allowed") is not False: raise GeneratedSourceTriggerError("unresolved make expansion must remain forbidden")
    if sem.get("regular_source_member_required") is not True: raise GeneratedSourceTriggerError("trigger source members must remain regular files")
    if sem.get("parentsrc_fallback_required") is not True: raise GeneratedSourceTriggerError("PARENTSRC fallback semantics must remain required")
    if sem.get("proxy_makefile_produces_single_dlldata") is not True: raise GeneratedSourceTriggerError("proxy Makefile dlldata semantics drifted")
    if sem.get("architecture_output_fanout_verified") is not False: raise GeneratedSourceTriggerError("architecture output fan-out is not proven in this stage")
    ids = sem.get("producer_ids")
    if not isinstance(ids, list) or len(ids) != 9 or len(set(ids)) != 9: raise GeneratedSourceTriggerError("generated producer id set drifted")
    if sem.get("widl_pragma_map") != {"client":"widl-client","server":"widl-server","ident":"widl-ident","proxy":"widl-proxy"}: raise GeneratedSourceTriggerError("WIDL pragma mapping drifted")
    if not value.get("open_boundaries") or any(v is not False for v in value["open_boundaries"].values()): raise GeneratedSourceTriggerError("generated source trigger open boundaries drifted")
    if not value.get("promotion") or any(v is not False for v in value["promotion"].values()): raise GeneratedSourceTriggerError("generated source trigger contract claims promotion/execution")
    return value

def source_lock():
    value = load_json(SOURCE_LOCK_PATH, "source lock")
    if value.get("$schema") != "prototype-ordax.windows-compat-runtime-source/1": raise GeneratedSourceTriggerError("unexpected source lock schema")
    return value

def producer_core(p): return {"runtime_id":p.get("runtime_id"),"source_archive_sha256":p.get("source_archive_sha256"),"makedep_path":p.get("makedep_path"),"makedep_sha256":p.get("makedep_sha256"),"producer_rules":p.get("producer_rules")}
def validate_producer_proof(p,c,s):
    if p.get("$schema") != c["input"]["producer_proof_schema"]: raise GeneratedSourceTriggerError("unexpected generated producer proof schema")
    if p.get("runtime_id") != c["runtime_id"] or p.get("runtime_id") != s.get("runtime_id"): raise GeneratedSourceTriggerError("generated producer runtime identity drifted")
    if p.get("source_archive_sha256") != c["input"]["source_archive_sha256"]: raise GeneratedSourceTriggerError("generated producer archive identity drifted")
    d=p.get("evidence_sha256")
    if not isinstance(d,str) or not re.fullmatch(r"[0-9a-f]{64}",d) or canonical_sha256(producer_core(p)) != d: raise GeneratedSourceTriggerError("generated producer evidence digest does not verify")
    rules=p.get("producer_rules")
    if not isinstance(rules,list) or sorted(x.get("id") for x in rules if isinstance(x,dict)) != sorted(c["trigger_semantics"]["producer_ids"]): raise GeneratedSourceTriggerError("generated producer rule identities drifted")
    if p.get("counts") != {"producer_rules":9}: raise GeneratedSourceTriggerError("generated producer rule counts drifted")
    gates={"source_archive_verified":True,"makedep_source_bound":True,"generated_c_producer_classes_classified":True,"all_producer_rules_observed":True,"generated_source_instances_inventoried":False,"generated_source_outputs_scanned":False,"generated_source_inventory_complete":False,"wrapper_call_graph_complete":False,"dynamic_load_inventory_complete":False,"runtime_dependency_inventory_complete":False,"runtime_package_content_hashes_pinned":False,"binary_artifact_pinned":False,"activation_authorized":False,"execution_authorized":False,"wine_executed":False,"windows_payload_executed":False}
    if p.get("gates") != gates: raise GeneratedSourceTriggerError("generated producer proof gate set drifted")
    return d

def strip_make_comment(line):
    out=[]; escaped=False
    for ch in line:
        if ch=="#" and not escaped: break
        out.append(ch); escaped = (not escaped) if ch=="\\" else False
    return "".join(out)
def logical_make_lines(text):
    result=[]; current=""
    for raw in text.splitlines():
        line=strip_make_comment(raw).rstrip(); cont=line.endswith("\\") and not line.endswith("\\\\")
        if cont: line=line[:-1]
        current += (" " if current else "") + line.strip()
        if not cont:
            if current: result.append(current)
            current=""
    if current: raise GeneratedSourceTriggerError("unterminated Makefile line continuation")
    return result
def parse_make_variables(text):
    values={}
    for line in logical_make_lines(text):
        m=ASSIGN_RE.match(line)
        if not m: continue
        name,op,raw=m.groups(); raw=raw.strip()
        values[name] = ((values.get(name,"")+" "+raw).strip() if op=="+=" else raw)
    return values
def expand_make_value(name, variables, stack=()):
    if name in stack: raise GeneratedSourceTriggerError(f"recursive Makefile variable expansion: {' -> '.join((*stack,name))}")
    if name not in variables: raise GeneratedSourceTriggerError(f"unresolved Makefile variable: {name}")
    value=variables[name]
    if "$$" in value: raise GeneratedSourceTriggerError(f"shell-dollar expansion is not modeled in Makefile variable: {name}")
    def repl(m): return expand_make_value(m.group(1) or m.group(2), variables, (*stack,name))
    prev=None
    while prev != value: prev=value; value=VAR_RE.sub(repl,value)
    if "$(" in value or "${" in value or "$" in value: raise GeneratedSourceTriggerError(f"unsupported Makefile expansion in {name}: {value!r}")
    return value.strip()
def split_make_tokens(value,label): return value.split()

def normalize_relative_path(*parts):
    stack=[]
    for raw in parts:
        if not isinstance(raw,str) or not raw or raw.startswith("/") or "\\" in raw: raise GeneratedSourceTriggerError(f"unsafe relative path component: {raw!r}")
        for part in PurePosixPath(raw).parts:
            if part in ("","."): continue
            if part=="..":
                if not stack: raise GeneratedSourceTriggerError(f"relative path escapes archive root: {parts!r}")
                stack.pop()
            else: stack.append(part)
    if not stack: raise GeneratedSourceTriggerError("relative path normalized to archive root")
    return PurePosixPath(*stack).as_posix()
def normalize_member_path(makefile_relative,token):
    if not token or token.startswith("/") or "\\" in token or ".." in PurePosixPath(token).parts: raise GeneratedSourceTriggerError(f"unsafe source token: {token!r}")
    return normalize_relative_path(PurePosixPath(makefile_relative).parent.as_posix(),token)
def resolve_trigger_source(makefile_relative,token,variables,members):
    local=normalize_member_path(makefile_relative,token)
    if members.get(local,{}).get("is_file") is True: return local,"local"
    if "PARENTSRC" not in variables: return local,"missing"
    parent=expand_make_value("PARENTSRC",variables)
    if not parent: return local,"missing"
    candidate=normalize_relative_path(PurePosixPath(makefile_relative).parent.as_posix(),parent,token)
    return (candidate,"parentsrc") if members.get(candidate,{}).get("is_file") is True else (candidate,"missing")
def replace_suffix(path,old,new):
    if not path.endswith(old): raise GeneratedSourceTriggerError(f"cannot replace suffix {old!r} in {path!r}")
    return path[:-len(old)]+new

def strip_c_comments(text):
    out=list(text); i=0; state="code"
    while i<len(text):
        ch=text[i]; nxt=text[i+1] if i+1<len(text) else ""
        if state=="code":
            if ch=='"': state="string"
            elif ch=="'": state="char"
            elif ch=="/" and nxt=="/":
                out[i]=out[i+1]=" "; i+=2
                while i<len(text) and text[i]!="\n": out[i]=" "; i+=1
                continue
            elif ch=="/" and nxt=="*": out[i]=out[i+1]=" "; state="block"; i+=2; continue
        elif state=="string":
            if ch=="\\": i+=2; continue
            if ch=='"': state="code"
        elif state=="char":
            if ch=="\\": i+=2; continue
            if ch=="'": state="code"
        elif state=="block":
            if ch=="*" and nxt=="/": out[i]=out[i+1]=" "; state="code"; i+=2; continue
            if ch!="\n": out[i]=" "
        i+=1
    if state=="block": raise GeneratedSourceTriggerError("unterminated block comment in trigger source")
    return "".join(out)
def widl_pragmas(text):
    flags=set()
    for m in PRAGMA_RE.finditer(strip_c_comments(text)): flags.update((m.group(1) or "").split())
    return flags

def is_makefile_member(path): return path=="Makefile.in" or path.endswith("/Makefile.in")
def read_archive_inputs(archive,source,contract):
    up=source.get("upstream",{})
    if archive.stat().st_size != up.get("archive_size_bytes") or PRODUCER.sha256_file(archive) != up.get("archive_sha256"): raise GeneratedSourceTriggerError("Wine archive does not match source lock")
    if up.get("archive_sha256") != contract["input"]["source_archive_sha256"]: raise GeneratedSourceTriggerError("source lock and trigger contract archive digests differ")
    root=up.get("archive_root")
    if root != contract["input"]["archive_root"]: raise GeneratedSourceTriggerError("source archive root drifted")
    prefix=root+"/"; members={}; contents={}; suffixes=(".idl",".y",".l",".xml")
    try:
        with tarfile.open(archive,"r:xz") as tar:
            for member in tar:
                if not member.name.startswith(prefix): continue
                rel=member.name[len(prefix):]
                if not rel or rel.startswith("/") or ".." in PurePosixPath(rel).parts: raise GeneratedSourceTriggerError(f"unsafe archive member path: {member.name}")
                if rel in members: raise GeneratedSourceTriggerError(f"duplicate archive member: {rel}")
                members[rel]={"is_file":member.isfile(),"size":member.size}; is_mk=is_makefile_member(rel)
                if is_mk and not member.isfile(): raise GeneratedSourceTriggerError(f"Makefile input is not a regular file: {rel}")
                if not (member.isfile() and (is_mk or rel.endswith(suffixes))): continue
                limit=MAX_MAKEFILE_BYTES if is_mk else MAX_TRIGGER_SOURCE_BYTES
                if member.size<=0 or member.size>limit: raise GeneratedSourceTriggerError(f"relevant source member exceeds bound: {rel}")
                h=tar.extractfile(member)
                if h is None: raise GeneratedSourceTriggerError(f"cannot read relevant source member: {rel}")
                raw=h.read(limit+1)
                if len(raw)!=member.size or len(raw)>limit: raise GeneratedSourceTriggerError(f"relevant source member read mismatch: {rel}")
                contents[rel]=raw
    except (tarfile.TarError,OSError) as exc: raise GeneratedSourceTriggerError(f"cannot inspect Wine archive: {exc}") from exc
    return members,contents

def inventory_triggers(members,contents,contract):
    mkname=contract["input"]["module_makefile_name"]; source_var=contract["input"]["source_variable"]; extra_var=contract["input"]["extra_objects_variable"]; pmap=contract["trigger_semantics"]["widl_pragma_map"]
    records=[]; manifest=[]; source_tokens_count=0; bound=set(); makefiles=sorted(p for p in contents if is_makefile_member(p))
    if not makefiles: raise GeneratedSourceTriggerError("Wine archive contained no Makefile.in inputs")
    for mk in makefiles:
        raw=contents[mk]
        try: text=raw.decode("utf-8",errors="strict")
        except UnicodeDecodeError as exc: raise GeneratedSourceTriggerError(f"Makefile is not UTF-8: {mk}") from exc
        manifest.append({"path":mk,"sha256":hashlib.sha256(raw).hexdigest(),"size":len(raw)}); vars=parse_make_variables(text)
        srcs=split_make_tokens(expand_make_value(source_var,vars),f"{mk}:{source_var}") if source_var in vars else []
        extras=split_make_tokens(expand_make_value(extra_var,vars),f"{mk}:{extra_var}") if extra_var in vars else []; source_tokens_count+=len(srcs); proxies=[]
        for token in srcs:
            local=normalize_member_path(mk,token); suffix=PurePosixPath(local).suffix; source=local; resolution="local"
            if suffix in (".idl",".y",".l",".xml"): source,resolution=resolve_trigger_source(mk,token,vars,members)
            if suffix==".idl":
                rawsrc=contents.get(source)
                if not members.get(source,{}).get("is_file") or rawsrc is None: raise GeneratedSourceTriggerError(f"IDL trigger source is not a regular bounded archive member: {source}")
                try: flags=widl_pragmas(rawsrc.decode("utf-8",errors="strict"))
                except UnicodeDecodeError as exc: raise GeneratedSourceTriggerError(f"IDL trigger source is not UTF-8: {source}") from exc
                seen=[]
                for flag,pid in sorted(pmap.items()):
                    if flag not in flags: continue
                    suff={"client":"_c.c","server":"_s.c","ident":"_i.c","proxy":"_p.c"}[flag]
                    records.append({"producer_id":pid,"makefile":mk,"source":source,"source_resolution":resolution,"source_sha256":hashlib.sha256(rawsrc).hexdigest(),"trigger":f"#pragma makedep {flag}","logical_output":replace_suffix(local,".idl",suff)}); seen.append(flag)
                    if flag=="proxy": proxies.append(source)
                if seen: bound.add(source)
                continue
            producer=output=None
            if suffix==".y": producer,output="bison-parser",replace_suffix(local,".y",".tab.c")
            elif suffix==".l": producer,output="flex-scanner",replace_suffix(local,".l",".yy.c")
            elif suffix==".xml": producer,output="wayland-protocol",replace_suffix(local,".xml","-protocol.c")
            if producer:
                rawsrc=contents.get(source)
                if not members.get(source,{}).get("is_file") or rawsrc is None: raise GeneratedSourceTriggerError(f"trigger source is not a regular bounded archive member: {source}")
                records.append({"producer_id":producer,"makefile":mk,"source":source,"source_resolution":resolution,"source_sha256":hashlib.sha256(rawsrc).hexdigest(),"trigger":f"{source_var}:{token}","logical_output":output}); bound.add(source)
        if proxies: records.append({"producer_id":"widl-dlldata","makefile":mk,"proxy_sources":sorted(set(proxies)),"trigger":"proxy-idl-present-in-makefile","logical_output":(PurePosixPath(mk).parent/"dlldata.c").as_posix()})
        for token in extras:
            if token.endswith(".o"):
                obj=normalize_member_path(mk,token); records.append({"producer_id":"extra-objs-c-fallback","makefile":mk,"extra_object":obj,"trigger":f"{extra_var}:{token}","logical_output":replace_suffix(obj,".o",".c")})
    records.sort(key=lambda x:json.dumps(x,sort_keys=True,separators=(",",":")))
    if len({json.dumps(x,sort_keys=True,separators=(",",":")) for x in records}) != len(records): raise GeneratedSourceTriggerError("duplicate generated source trigger record")
    by={x:0 for x in contract["trigger_semantics"]["producer_ids"]}
    for r in records:
        if r["producer_id"] not in by: raise GeneratedSourceTriggerError(f"unmodeled generated source producer trigger: {r['producer_id']}")
        by[r["producer_id"]]+=1
    manifest.sort(key=lambda x:x["path"])
    return records,{"makefiles_scanned":len(makefiles),"source_tokens_inspected":source_tokens_count,"trigger_records":len(records),"trigger_source_members":len(bound),"by_producer":by,"makefile_manifest_sha256":canonical_sha256(manifest)}

def prove(archive,producer_proof):
    c=load_contract(); s=source_lock()
    if s.get("runtime_id") != c["runtime_id"]: raise GeneratedSourceTriggerError("runtime identity drifted")
    pd=validate_producer_proof(producer_proof,c,s); members,contents=read_archive_inputs(archive,s,c); triggers,counts=inventory_triggers(members,contents,c)
    if not triggers: raise GeneratedSourceTriggerError("no generated C source triggers were found")
    core={"runtime_id":c["runtime_id"],"source_archive_sha256":c["input"]["source_archive_sha256"],"producer_evidence_sha256":pd,"makefile_manifest_sha256":counts["makefile_manifest_sha256"],"trigger_records":triggers}
    pc={k:v for k,v in counts.items() if k!="makefile_manifest_sha256"}
    gates={"producer_proof_verified":True,"makefile_manifest_bound":True,"build_source_variables_expanded":True,"generated_c_trigger_instances_inventoried":True,"trigger_source_members_bound":True,"generated_source_instances_inventoried":False,"generated_source_output_fanout_verified":False,"generated_source_outputs_scanned":False,"generated_source_inventory_complete":False,"wrapper_call_graph_complete":False,"dynamic_load_inventory_complete":False,"runtime_dependency_inventory_complete":False,"runtime_package_content_hashes_pinned":False,"binary_artifact_pinned":False,"activation_authorized":False,"execution_authorized":False,"wine_executed":False,"windows_payload_executed":False}
    return {"$schema":PROOF_SCHEMA,"status":"generated-c-source-triggers-inventoried-not-output-inventory-complete",**core,"evidence_sha256":canonical_sha256(core),"counts":pc,"gates":gates}

def main():
    p=argparse.ArgumentParser(); p.add_argument("command",choices=["check","prove"]); p.add_argument("--source-archive",type=Path); p.add_argument("--producer-proof",type=Path); p.add_argument("--out",type=Path); a=p.parse_args(); load_contract()
    if a.command=="check": print("windows compatibility generated source trigger contract: PASS"); return 0
    if not a.source_archive or not a.producer_proof or not a.out: raise GeneratedSourceTriggerError("prove requires --source-archive, --producer-proof and --out")
    result=prove(a.source_archive.resolve(),load_json(a.producer_proof,"generated source producer proof")); a.out.parent.mkdir(parents=True,exist_ok=True); a.out.write_text(json.dumps(result,indent=2,sort_keys=True)+"\n",encoding="utf-8"); print("windows compatibility generated C source triggers: PASS"); print(json.dumps(result["counts"],sort_keys=True)); print("evidence:",result["evidence_sha256"]); return 0
if __name__=="__main__":
    try: raise SystemExit(main())
    except (GeneratedSourceTriggerError,PRODUCER.GeneratedSourceProducerError) as exc: print(f"windows-compat-runtime-generated-source-triggers: {exc}",file=sys.stderr); raise SystemExit(2)
