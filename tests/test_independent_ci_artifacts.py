import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("ci_cache",ROOT/"bootstrap/independent-base/ci_artifacts.py")
ci=importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)

class CacheIntegrity(unittest.TestCase):
    def test_canonical_input_coverage_and_no_generated_files(self):
        names={p.relative_to(ROOT).as_posix() for p in ci.inputs("base")}
        for x in ("system/entrypoint","system/supervisor","bootstrap/network/bring-up","bootstrap/stable-base/ordax-stable-init"):
            self.assertIn(x,names)
        for kind in ("kernel","base"):
            self.assertTrue(all("__pycache__" not in p.parts and p.suffix!=".pyc" for p in ci.inputs(kind)))

    def test_cross_commit_replay_and_tamper_fail_closed(self):
        meta={"origin_commit":"a"*40,"fingerprint":"b"*64,"artifacts":{"binary":"c"*64}}
        receipt={"$schema":ci.BINDING_SCHEMA,"kind":"base","origin_commit":"a"*40,
                 "current_commit":"d"*40,"inputs_sha256":"b"*64,"artifacts":meta["artifacts"],
                 "physical_promotion_authorized":False}
        with tempfile.TemporaryDirectory() as td:
            path=Path(td); file=path/"receipt.json"; file.write_text(json.dumps(receipt))
            with patch.object(ci,"verify",return_value=meta):
                ci.verify_binding("base",path,file,"d"*40)
                with self.assertRaises(ci.CacheError):
                    ci.verify_binding("base",path,file,"e"*40)
                file.write_text(json.dumps({**receipt,"artifacts":{"binary":"f"*64}}))
                with self.assertRaises(ci.CacheError):
                    ci.verify_binding("base",path,file,"d"*40)
