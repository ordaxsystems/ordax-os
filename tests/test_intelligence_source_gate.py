#!/usr/bin/env python3
"""Prove fail-closed external Intelligence source verification and staging."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT=Path(__file__).resolve().parents[1]/"tools/intelligence-source/materialize.py"
SPEC=importlib.util.spec_from_file_location("ordax_intelligence_materializer", SCRIPT)
source=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(source)

def git(root,*args):
    p=subprocess.run(["git","-C",str(root),*args],check=True,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    return p.stdout.strip()

class IntelligenceSourceGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.checkout=self.root/"intelligence"
        self.checkout.mkdir()
        git(self.checkout,"init","-q")
        git(self.checkout,"config","user.name","Source Gate")
        git(self.checkout,"config","user.email","source@example.invalid")
        for name in source.EXPECTED:
            f=self.checkout/name
            f.parent.mkdir(parents=True,exist_ok=True)
            f.write_text("export const verified = 1;\\n",encoding="utf-8")
        git(self.checkout,"add","src")
        git(self.checkout,"commit","-qm","source fixture")
        self.lock={
            "$schema":source.SCHEMA,"status":"integration-candidate",
            "source_repository":source.REPO,"source_commit":git(self.checkout,"rev-parse","HEAD"),
            "source_paths":{p:git(self.checkout,"rev-parse","HEAD:"+p) for p in source.EXPECTED},
            "materialization_target":source.TARGET,
            "public_ports":["ordax.intelligence/1","ordax.model-router/1","ordax.local-ai/1"],
            "source_only":True,"change_live_os":False,"activation_authorized":False,
        }
        self.lockfile=self.root/"intelligence-source.json"
        self.write_lock()
    def write_lock(self):
        self.lockfile.write_text(json.dumps(self.lock),encoding="utf-8")
    def verify(self):
        return source.verify_source(self.checkout,source.load_lock(self.lockfile))
    def test_exact_source_stages_and_remains_read_only(self):
        entries,receipt=self.verify()
        self.assertEqual(len(entries),7)
        dest=self.root/"stage"
        source.stage_source(entries,receipt,dest,self.checkout)
        self.assertTrue((dest/"system/intelligence-source/src/index.mjs").is_file())
        self.assertFalse((self.checkout/"intelligence-source-receipt.json").exists())
        self.assertFalse(receipt["activation_authorized"])
        with self.assertRaisesRegex(source.IntelligenceSourceError,"overwrite"):
            source.stage_source(entries,receipt,dest,self.checkout)
    def test_rejects_sha_and_blob_mismatch(self):
        self.lock["source_commit"]="f"*40
        self.write_lock()
        with self.assertRaisesRegex(source.IntelligenceSourceError,"revision"):
            self.verify()
        self.lock["source_commit"]=git(self.checkout,"rev-parse","HEAD")
        self.lock["source_paths"]["src/index.mjs"]="f"*40
        self.write_lock()
        with self.assertRaisesRegex(source.IntelligenceSourceError,"pinned source blob"):
            self.verify()
    def test_rejects_untracked_edits_and_extra_tracked_code(self):
        (self.checkout/"src/index.mjs").write_text("export const injected = true;\\n",encoding="utf-8")
        with self.assertRaisesRegex(source.IntelligenceSourceError,"modified"):
            self.verify()
        git(self.checkout,"checkout","--","src/index.mjs")
        (self.checkout/"src/new-secret.mjs").write_text("export const extra=1;\\n",encoding="utf-8")
        with self.assertRaisesRegex(source.IntelligenceSourceError,"modified"):
            self.verify()
        git(self.checkout,"add","src/new-secret.mjs")
        git(self.checkout,"commit","-qm","extra")
        self.lock["source_commit"]=git(self.checkout,"rev-parse","HEAD")
        self.write_lock()
        with self.assertRaisesRegex(source.IntelligenceSourceError,"unexpected"):
            self.verify()
    def test_rejects_symlinks_and_changed_authority(self):
        self.lock["activation_authorized"]=True
        self.write_lock()
        with self.assertRaisesRegex(source.IntelligenceSourceError,"policy"):
            self.verify()
        self.lock["activation_authorized"]=False
        self.write_lock()
        p=self.checkout/"src/index.mjs"
        p.unlink()
        p.symlink_to("contract-bindings.mjs")
        with self.assertRaises(source.IntelligenceSourceError):
            self.verify()
    def test_cannot_stage_inside_source_checkout(self):
        entries,receipt=self.verify()
        with self.assertRaisesRegex(source.IntelligenceSourceError,"must not alter"):
            source.stage_source(entries,receipt,self.checkout/"temporary",self.checkout)

if __name__=="__main__":
    unittest.main()
