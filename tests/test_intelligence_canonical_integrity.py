#!/usr/bin/env python3
"""Same-commit Intelligence integrity regressions; no models, engine or network."""
from __future__ import annotations
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
SPEC=importlib.util.spec_from_file_location("ordax_intelligence_git_integrity", ROOT/"tools/intelligence/verify.py")
integrity=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(integrity)

class IntelligenceIntegrityTests(unittest.TestCase):
    def test_head_and_source_are_the_same_os_commit(self):
        record=integrity.verify(ROOT)
        self.assertEqual(record["source_repository"],"ordaxsystems/ordax-os")
        self.assertEqual(record["source_commit"],integrity.commit())
        self.assertEqual(record["source_file_count"],len(integrity.tracked()))
        self.assertEqual(record["public_ports"],list(integrity.PORTS))
        self.assertFalse(record["activation_authorized"])
        self.assertFalse(record["engine_included"])
        self.assertFalse(record["model_included"])

    def staged(self, temp):
        candidate=Path(temp)/"candidate"
        for rel in integrity.tracked():
            dst=candidate/rel
            dst.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(ROOT/rel,dst)
        return candidate

    def test_staging_proof_and_file_tamper_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            candidate=self.staged(tmp)
            expected=integrity.verify(candidate)
            receipt=candidate/"system/intelligence/source-provenance.json"
            receipt.write_text(json.dumps(expected),encoding="utf-8")
            self.assertEqual(integrity.verify(candidate,need_receipt=True),expected)
            victim=candidate/"system/intelligence/src/index.mjs"
            victim.write_bytes(victim.read_bytes()+b"\n// injected\n")
            with self.assertRaisesRegex(integrity.IntelligenceIntegrityError,"blob drift"):
                integrity.verify(candidate,need_receipt=True)

    def test_mutated_receipt_and_missing_builder_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            candidate=self.staged(tmp)
            receipt=candidate/"system/intelligence/source-provenance.json"
            with self.assertRaisesRegex(integrity.IntelligenceIntegrityError,"provenance"):
                integrity.verify(candidate,need_receipt=True)
            forged=integrity.verify(candidate)
            forged["activation_authorized"]=True
            receipt.write_text(json.dumps(forged),encoding="utf-8")
            with self.assertRaisesRegex(integrity.IntelligenceIntegrityError,"provenance"):
                integrity.verify(candidate,need_receipt=True)
            (candidate/"system/intelligence/tools/inference-builder/build.py").unlink()
            with self.assertRaisesRegex(integrity.IntelligenceIntegrityError,"missing"):
                integrity.verify(candidate)

if __name__=="__main__":
    unittest.main()
