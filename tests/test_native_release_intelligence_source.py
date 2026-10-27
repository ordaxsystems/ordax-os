"""Native release must bind the exact externally verified Intelligence tree."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("ordax_native_intelligence_gate", HERE/"tools/native-release-assembly/build.py")
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)
PROOF = importlib.util.spec_from_file_location("ordax_composed_intelligence_gate",HERE/"tools/intelligence-source/compose.py")
compose = importlib.util.module_from_spec(PROOF)
PROOF.loader.exec_module(compose)

class NativeIntelligenceGateTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root=Path(temp.name)
        self.system=self.root/"candidate/system"
        self.system.mkdir(parents=True)
        self.lock=json.loads((HERE/"docs/contracts/intelligence-source.json").read_text())
        self.lock["source_paths"]={}
        digest=hashlib.sha256()
        for name in sorted(compose.source.EXPECTED):
            body=("verified:"+name+"\n").encode()
            path=self.system/"intelligence-source"/name
            path.parent.mkdir(parents=True,exist_ok=True)
            path.write_bytes(body)
            self.lock["source_paths"][name]=compose.source.git_blob_sha(body)
            digest.update(name.encode()+b"\0"+hashlib.sha256(body).digest())
        self.fingerprint=digest.hexdigest()
        self.lockfile=self.root/"source-lock.json"
        self.lockfile.write_text(json.dumps(self.lock))
        self.wrapper_bodies=compose.load_wrappers(HERE)
        for wrapper_name in compose.WRAPPER_FILES.values():
            src=HERE/"system/services/intelligence-source/wrappers"/wrapper_name
            dest=self.system/"services/intelligence-source/wrappers"/wrapper_name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(src.read_bytes())
        self.receipt={
            "$schema":"ordax.intelligence-disposable-composition/1",
            "source_repository":compose.source.REPO,
            "source_commit":self.lock["source_commit"],
            "source_sha256":self.fingerprint,
            "replaced_services":sorted(compose.WRAPPER_FILES),
            "legacy_implementation_bytes_packaged":False,
            "os_checkout_mutated":False,
            "activation_authorized":False,
            "surface_ownership_unchanged":True,
            "memory_ownership_unchanged":True,
        }
        for name,body in self.wrapper_bodies.items():
            file=self.root/"candidate"/name
            file.parent.mkdir(parents=True,exist_ok=True)
            file.write_text(body)
        self.write_receipt()

    def write_receipt(self):
        path=self.system/"intelligence-source/source-provenance.json"
        path.write_text(json.dumps(self.receipt))

    def check(self):
        return native.verify_external_intelligence_system(self.system,lock_path=self.lockfile)

    def test_compositor_loads_bridges_from_supplied_os_tree_only(self):
        alternate=self.root/"separate-os"
        templates=alternate/"system/services/intelligence-source/wrappers"
        templates.mkdir(parents=True)
        for name in compose.WRAPPER_FILES.values():
            original=(HERE/"system/services/intelligence-source/wrappers"/name).read_text(encoding="utf-8")
            (templates/name).write_text(original+"\n// from isolated OS input\n", encoding="utf-8")
        bridges=compose.load_wrappers(alternate)
        self.assertEqual(set(bridges), set(compose.WRAPPER_FILES))
        for target in compose.WRAPPER_FILES:
            self.assertEqual(bridges[target],self.wrapper_bodies[target]+"\n// from isolated OS input\n")
        (templates/"model-router.mjs").unlink()
        (templates/"model-router.mjs").symlink_to("intelligence-runtime.mjs")
        with self.assertRaisesRegex(compose.CompositionError,"missing or linked"):
            compose.load_wrappers(alternate)

    def test_exact_pinned_source_and_canonical_wrappers_pass(self):
        self.assertEqual(self.check(),self.receipt)
        self.assertEqual(native.intelligence_binding(self.receipt)["source_sha256"],self.fingerprint)

    def test_tampered_source_blob_or_injected_file_is_rejected(self):
        file=self.system/"intelligence-source/src/index.mjs"
        file.write_bytes(b"modified")
        with self.assertRaisesRegex(native.AssemblyError,"blob"):
            self.check()
        file.write_bytes(b"verified:src/index.mjs\n")
        p=self.system/"intelligence-source/src/extraneous.mjs"
        p.write_text("malicious")
        with self.assertRaisesRegex(native.AssemblyError,"injected"):
            self.check()

    def test_wrappers_cannot_reintroduce_old_engine(self):
        file=self.root/"candidate/system/services/intelligence/runtime.mjs"
        file.write_text(file.read_text()+"\nconst oldEngine = true;\n")
        with self.assertRaisesRegex(native.AssemblyError,"legacy implementation"):
            self.check()

    def test_altered_input_template_cannot_authorize_its_own_wrapper(self):
        name="intelligence-runtime.mjs"
        template=self.system/"services/intelligence-source/wrappers"/name
        target=self.system/"services/intelligence/runtime.mjs"
        modified=template.read_text(encoding="utf-8")+"\n// injected duplicate authority\n"
        template.write_text(modified,encoding="utf-8")
        target.write_text(modified,encoding="utf-8")
        with self.assertRaisesRegex(native.AssemblyError,"drifted from trusted"):
            self.check()

    def test_fake_receipt_and_missing_receipt_are_rejected(self):
        self.receipt["activation_authorized"]=True
        self.write_receipt()
        with self.assertRaisesRegex(native.AssemblyError,"provenance"):
            self.check()
        (self.system/"intelligence-source/source-provenance.json").unlink()
        with self.assertRaisesRegex(native.AssemblyError,"requires verified"):
            self.check()

    def test_symlink_and_extra_source_cannot_be_accepted(self):
        path=self.system/"intelligence-source/src/index.mjs"
        path.unlink()
        path.symlink_to("contract-bindings.mjs")
        with self.assertRaisesRegex(native.AssemblyError,"symlink"):
            self.check()

    def test_native_assembly_records_binding_and_verifies_packaged_bytes(self):
        # Existing trusted Creator helpers are mocked only to avoid compiling Go.
        # The Intelligence verification uses the real source gate above.
        origin=native.verify_external_intelligence_system
        def verified(path):
            return origin(path,lock_path=self.lockfile)
        def fake_helper(root,spec,creator):
            path=root/spec["relative"]
            path.parent.mkdir(parents=True,exist_ok=True)
            path.write_bytes(b"fake-helper-under-test")
            path.chmod(0o755)
            return path
        destination=self.root/"assembled"
        with (
            patch.object(native,"verify_external_creator_source"),
            patch.object(native,"validate_source_tree"),
            patch.object(native,"verify_external_surface_system"),
            patch.object(native,"verify_external_intelligence_system",side_effect=verified),
            patch.object(native,"build_helper",side_effect=fake_helper),
            patch.object(native,"git_head",return_value="a"*40),
            patch.object(native,"creator_source_pin",return_value={"repository":"ordaxsystems/ordax-creator","commit":"b"*40,"tree":"c"*40}),
        ):
            result=native.assemble(destination,self.system,self.root,require_external_intelligence=True)
            self.assertEqual(result["intelligence_source"],native.intelligence_binding(self.receipt))
            verified_result=native.verify(destination,require_external_intelligence=True)
            self.assertEqual(verified_result["intelligence_source"],result["intelligence_source"])
            (destination/"system/intelligence-source/src/index.mjs").write_bytes(b"tampered")
            with self.assertRaisesRegex(native.AssemblyError,"blob"):
                native.verify(destination,require_external_intelligence=True)

    def test_unbound_candidate_cannot_claim_required_intelligence(self):
        with self.assertRaisesRegex(native.AssemblyError,"external Intelligence requires"):
            native.assemble(self.root/"never",native.SYSTEM,self.root,require_external_intelligence=True)

if __name__=="__main__":
    unittest.main()
