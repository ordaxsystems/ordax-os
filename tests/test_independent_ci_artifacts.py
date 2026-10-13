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

    def test_manual_dispatch_reuses_authenticated_artifacts_without_compilation(self):
        workflow = (ROOT / ".github/workflows/independent-base-experiment.yml").read_text()
        self.assertIn("verified_inputs_run_id:", workflow)
        self.assertIn("actions: read", workflow)
        self.assertIn("run-id: ${{ inputs.verified_inputs_run_id }}", workflow)
        self.assertIn("actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093", workflow)
        self.assertIn("ci_artifacts.py check --kind kernel", workflow)
        self.assertIn("ci_artifacts.py check --kind base", workflow)
        self.assertIn("ci_artifacts.py bind --kind kernel", workflow)
        self.assertIn("ci_artifacts.py bind --kind base", workflow)
        self.assertEqual(
            workflow.count("github.event_name != 'workflow_dispatch'"),
            6, "manual runs must not rebuild or create cache entries",
        )

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

    def test_consumption_survives_unrelated_apt_changes_but_rejects_tampering(self):
        import hashlib
        import stat

        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            canonical = base / "canonical-input"
            canonical.write_bytes(b"canonical-source")
            destination = base / "artifacts"
            destination.mkdir()
            prov = destination / "provenance.json"
            prov.write_text('{"status":"candidate"}')
            binary = destination / "independent-base.erofs"
            binary.write_bytes(b"verified-independent-binary")
            manifest = destination / ci.MANIFEST
            sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
            inputs = {"canonical-input": {
                "sha256": sha(canonical), "mode": oct(stat.S_IMODE(canonical.stat().st_mode)),
            }}
            toolchain = {"runner_image_version": "build-runner-v1"}
            fingerprint = ci.identity_digest({
                "kind": "base", "toolchain": toolchain, "inputs": inputs,
            })
            sealed = {
                "$schema": ci.SCHEMA, "kind": "base",
                "origin_commit": "a" * 40, "fingerprint": fingerprint,
                "toolchain": toolchain, "inputs": inputs,
                "artifacts": {
                    "provenance.json": sha(prov), "independent-base.erofs": sha(binary),
                },
                "canonical_provenance_sha256": sha(prov),
                "physical_promotion_authorized": False,
            }
            manifest.write_text(json.dumps(sealed))
            receipt = base / "binding.json"
            receipt.write_text(json.dumps({
                "$schema": ci.BINDING_SCHEMA, "kind": "base",
                "origin_commit": "a" * 40, "current_commit": "b" * 40,
                "inputs_sha256": fingerprint, "artifacts": sealed["artifacts"],
                "physical_promotion_authorized": False,
            }))
            with (
                patch.object(ci, "ROOT", base),
                patch.object(ci, "inputs", return_value=[canonical]),
                patch.object(ci, "verify_canonical", return_value={"source_commit": "a" * 40}),
                patch.object(ci, "fingerprint", side_effect=ci.CacheError("consumer apt changed")),
            ):
                ci.verify_binding("base", destination, receipt, "b" * 40,
                                  check_builder_environment=False)
                with self.assertRaisesRegex(ci.CacheError, "consumer apt changed"):
                    ci.verify_binding("base", destination, receipt, "b" * 40)
                canonical.write_bytes(b"changed-canonical-source")
                with self.assertRaisesRegex(ci.CacheError, "canonical sources"):
                    ci.verify_binding("base", destination, receipt, "b" * 40,
                                      check_builder_environment=False)
                canonical.write_bytes(b"canonical-source")
                binary.write_bytes(b"tampered")
                with self.assertRaisesRegex(ci.CacheError, "sealed SHA-256"):
                    ci.verify_binding("base", destination, receipt, "b" * 40,
                                      check_builder_environment=False)
