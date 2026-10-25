#!/usr/bin/env python3
"""Offline Owner/Development Intelligence slot source, tamper and rollback proofs."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
HELPER=ROOT/"system/services/intelligence-source/owner-stage.sh"
TEMPLATES=ROOT/"system/services/intelligence-source/wrappers"
FILES=(
    "src/index.mjs","src/contract-bindings.mjs","src/intelligence/runtime.mjs",
    "src/intelligence/model-router.mjs","src/local-ai/runtime.mjs",
    "src/local-ai/completion-stream.mjs","src/local-ai/model-compatibility.mjs",
    "tools/inference-builder/build.py",
)
WRAPPERS={
    "system/services/intelligence/model-router.mjs":"model-router.mjs",
    "system/services/intelligence/runtime.mjs":"intelligence-runtime.mjs",
    "system/services/local-ai/runtime.mjs":"local-ai-runtime.mjs",
    "system/services/local-ai/completion-stream.mjs":"completion-stream.mjs",
    "system/services/local-ai/model-compatibility.mjs":"model-compatibility.mjs",
}

def git(root,*args):
    return subprocess.run(["git","-C",str(root),*args],capture_output=True,text=True,check=True).stdout.strip()

def put(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(value,encoding="utf-8")

class OwnerIntelligenceSourceTests(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root=Path(tmp.name)
        self.os_root=self.root/"os"
        self.remote=self.root/"remote-intelligence"
        self.slot=self.root/"slot"
        for repo in (self.os_root,self.remote):
            repo.mkdir()
            git(repo,"init","-q")
            git(repo,"config","user.email","fixture@example.invalid")
            git(repo,"config","user.name","Intelligence test")
        for path in FILES:
            put(self.remote/path,("pass\n" if path.endswith(".py") else "export const verified = 1;\n"))
        git(self.remote,"add",".")
        git(self.remote,"commit","-qm","pinned source")
        self.external_sha=git(self.remote,"rev-parse","HEAD")
        self.blobs={p:git(self.remote,"rev-parse","HEAD:"+p) for p in FILES}
        for target,name in WRAPPERS.items():
            put(self.os_root/target,"LEGACY\n")
            destination=self.os_root/"system/services/intelligence-source/wrappers"/name
            destination.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(TEMPLATES/name,destination)
        put(self.os_root/"system/entrypoint","#!/bin/sh\n")
        (self.os_root/"system/entrypoint").chmod(0o755)
        self.lock=self.os_root/"docs/contracts/intelligence-source.json"
        self.set_lock("canonical")
        shutil.copytree(self.os_root/"system",self.slot/"system")
        self.config=self.root/"gitconfig"
        self.config.write_text(
            '[url "'+self.remote.as_uri()+'"]\n'
            '    insteadOf = https://github.com/ordaxsystems/ordax-intelligence.git\n'
            '[protocol "file"]\n    allow = always\n',
            encoding="utf-8",
        )
        self.env=os.environ.copy()
        self.env["GIT_CONFIG_GLOBAL"]=str(self.config)
        self.env["GIT_CONFIG_NOSYSTEM"]="1"
        self.env["ORDAX_GIT_BIN"]=shutil.which("git")

    def set_lock(self,state,source_sha=None,repository="ordaxsystems/ordax-intelligence"):
        put(self.lock,json.dumps({
            "$schema":"prototype-ordax.intelligence-source/1",
            "status":state,
            "source_repository":repository,
            "source_commit":source_sha or self.external_sha,
            "source_paths":self.blobs,
            "materialization_target":"system/intelligence-source/src",
            "source_only":True,
            "change_live_os":False,
            "public_ports":["ordax.intelligence/1","ordax.model-router/1","ordax.local-ai/1"],
            "activation_authorized":False,
        },indent=2)+"\n")
        git(self.os_root,"add",".")
        git(self.os_root,"commit","-qm","reviewed source lock")
        self.sha=git(self.os_root,"rev-parse","HEAD")

    def call(self,command,good=False):
        cmd=["/bin/sh",str(HELPER),command,str(self.os_root),self.sha,str(self.slot)]
        result=subprocess.run(cmd,env=self.env,capture_output=True,text=True)
        if good:
            self.assertEqual(result.returncode,0,result.stdout+"\n"+result.stderr)
        return result

    def mark_ready(self):
        put(self.slot/".sha",self.sha+"\n")
        put(self.slot/".ready","ready\n")

    def test_canonical_stage_is_one_supervisor_slot_and_ready_is_offline(self):
        self.assertEqual(self.call("status",good=True).stdout.strip(),"canonical")
        self.call("stage",good=True)
        self.mark_ready()
        self.call("ready",good=True)
        self.assertEqual((self.slot/".intelligence-source-sha").read_text().strip(),self.external_sha)
        self.assertFalse((self.slot/".intelligence-source-git").exists())
        for target,name in WRAPPERS.items():
            self.assertEqual((self.slot/target).read_bytes(),(TEMPLATES/name).read_bytes())
            self.assertEqual((self.os_root/target).read_text(),"LEGACY\n")
        for source in FILES:
            self.assertTrue((self.slot/"system/intelligence-source"/source).is_file())

    def test_tamper_injection_symlink_and_wrapper_are_blocked_at_ready(self):
        self.call("stage",good=True)
        self.mark_ready()
        self.call("ready",good=True)
        target=self.slot/"system/intelligence-source/src/index.mjs"
        original=target.read_bytes()
        target.write_text("hijacked")
        self.assertNotEqual(self.call("ready").returncode,0)
        target.write_bytes(original)
        self.call("ready",good=True)
        surprise=self.slot/"system/intelligence-source/src/extra.mjs"
        surprise.write_text("evil")
        self.assertNotEqual(self.call("ready").returncode,0)
        surprise.unlink()
        wrapper=self.slot/"system/services/intelligence/runtime.mjs"
        wrapper.write_text("old implementation")
        self.assertNotEqual(self.call("ready").returncode,0)

    def test_noncanonical_source_never_fetches_or_overwrites(self):
        self.set_lock("integration-candidate")
        self.assertEqual(self.call("status",good=True).stdout.strip(),"integration-candidate")
        self.call("stage",good=True)
        self.assertFalse((self.slot/"system/intelligence-source").exists())
        self.assertEqual((self.slot/"system/services/intelligence/runtime.mjs").read_text(),"LEGACY\n")
        self.assertNotEqual(self.call("ready").returncode,0)

    def test_untrusted_repository_and_missing_commit_fail_closed(self):
        self.set_lock("canonical",repository="someone/other")
        self.assertNotEqual(self.call("status").returncode,0)
        self.set_lock("canonical",source_sha="f"*40)
        self.assertNotEqual(self.call("stage").returncode,0)
        self.assertFalse((self.slot/"system/intelligence-source").exists())

    def test_source_symlink_rejected_without_overwriting_old_os(self):
        (self.remote/"src/new-link.mjs").symlink_to("index.mjs")
        git(self.remote,"add",".")
        git(self.remote,"commit","-qm","unexpected link")
        self.set_lock("canonical",source_sha=git(self.remote,"rev-parse","HEAD"))
        self.assertNotEqual(self.call("stage").returncode,0)
        self.assertEqual((self.slot/"system/services/intelligence/runtime.mjs").read_text(),"LEGACY\n")

    def test_creator_can_preseed_exact_intelligence_offline_in_existing_supervisor_slot(self):
        import hashlib
        import importlib.util
        surface_sha="a"*40
        put(self.os_root/"docs/contracts/surface-source.json", json.dumps({
            "$schema":"prototype-ordax.surface-source/1",
            "status":"canonical",
            "source_repository":"ordaxsystems/ordax-surface",
            "source_commit":surface_sha,
        }))
        git(self.os_root,"add",".")
        git(self.os_root,"commit","-qm","canonical Surface and Intelligence sources")
        self.sha=git(self.os_root,"rev-parse","HEAD")
        assembly=self.root/"assembled"
        shutil.copytree(self.os_root/"system", assembly/"system")
        put(assembly/"system/surface/ui/surface.mjs","external-visual\n")
        put(assembly/"system/surface/workspace/shell.tsx","external-workspace\n")
        visual_fingerprint=hashlib.sha256()
        for path in ("system/surface/ui/surface.mjs","system/surface/workspace/shell.tsx"):
            payload=(assembly/path).read_bytes()
            visual_fingerprint.update(path.encode()+b"\0"+hashlib.sha256(payload).digest())
        put(assembly/"system/surface/source-provenance.json",json.dumps({
            "os_commit":self.sha,
            "surface_source_commit":surface_sha,
            "surface_source_repository":"ordaxsystems/ordax-surface",
            "visual_file_count":2,
            "visual_source_sha256":visual_fingerprint.hexdigest(),
            "old_os_visual_source_packaged":False,
        }))
        intelligence_fingerprint=hashlib.sha256()
        for path in sorted(FILES):
            payload=(self.remote/path).read_bytes()
            dest=assembly/"system/intelligence-source"/path
            dest.parent.mkdir(parents=True,exist_ok=True)
            dest.write_bytes(payload)
            intelligence_fingerprint.update(path.encode()+b"\0"+hashlib.sha256(payload).digest())
        for target,name in WRAPPERS.items():
            dest=assembly/target
            shutil.copyfile(TEMPLATES/name,dest)
        put(assembly/"system/intelligence-source/source-provenance.json", json.dumps({
            "$schema":"ordax.intelligence-disposable-composition/1",
            "source_repository":"ordaxsystems/ordax-intelligence",
            "source_commit":self.external_sha,
            "source_sha256":intelligence_fingerprint.hexdigest(),
            "replaced_services":sorted(WRAPPERS),
            "legacy_implementation_bytes_packaged":False,
            "os_checkout_mutated":False,
            "activation_authorized":False,
            "surface_ownership_unchanged":True,
            "memory_ownership_unchanged":True,
        }))
        rootfs=self.os_root/"out/dev-base/rootfs"
        checkout=rootfs/"workspace/ordax"
        checkout.parent.mkdir(parents=True)
        subprocess.run(["git","clone","-q",str(self.os_root),str(checkout)],check=True)
        put(rootfs/"state/ordax/current-commit",self.sha+"\n")
        p=ROOT/"tools/surface-source/preseed_owner.py"
        spec=importlib.util.spec_from_file_location("owner_intelligence_offline_preseed",p)
        module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        result=module.preseed(self.os_root,assembly,rootfs,self.sha)
        self.assertEqual(result["intelligence_commit"],self.external_sha)
        self.assertEqual(result["intelligence_files"],8)
        slot=rootfs/"state/ordax/releases"/self.sha
        self.assertTrue((slot/".intelligence-file-hashes").is_file())
        self.assertFalse((slot/"system/intelligence-source/source-provenance.json").exists())
        cmd=["/bin/sh",str(HELPER),"ready",str(checkout),self.sha,str(slot)]
        actual=subprocess.run(cmd,env=self.env,text=True,capture_output=True)
        self.assertEqual(actual.returncode,0,actual.stderr)
        (slot/"system/intelligence-source/src/index.mjs").write_text("corrupt")
        self.assertNotEqual(subprocess.run(cmd,env=self.env,capture_output=True).returncode,0)

    def test_supervisor_uses_existing_transaction_without_new_updater(self):
        sup=(ROOT/"system/supervisor").read_text()
        self.assertIn("OWNER_INTELLIGENCE_STAGE_HELPER=",sup)
        self.assertIn('"$OWNER_INTELLIGENCE_STAGE_HELPER" stage',sup)
        self.assertIn('"$OWNER_INTELLIGENCE_STAGE_HELPER" ready',sup)
        self.assertIn("surface_host_changed=1",sup)
        self.assertNotIn("ordax-intelligence-updater",sup)

if __name__=="__main__":
    unittest.main()
