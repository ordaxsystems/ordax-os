import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools/release-operator/validate_canonical_v4_signing_request.py"
WORKFLOW_PATH = ROOT / ".github/workflows/canonical-v4-signing-request.yml"
REQUEST_PATH = ROOT / "docs/contracts/canonical-v4-signing-request.json"

spec = importlib.util.spec_from_file_location("canonical_v4_signing_request", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

SOURCE = "7a8a24df0ff7ef71f9d07aed8c50209686da23c6"
TAG = f"ordax-stable-v4-{SOURCE}"


def digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


class CanonicalV4SigningRequestTests(unittest.TestCase):
    def _request(self):
        prefix = f"https://github.com/ordaxsystems/prototipo-ordax-os/releases/download/{TAG}/"
        return {
            "$schema": module.REQUEST_SCHEMA,
            "status": "pending-public-assembly",
            "source_repository": module.REPOSITORY,
            "source_commit": SOURCE,
            "release_tag": TAG,
            "operator_artifacts": {
                "system": {
                    "workflow_path": module.KIND_SPECS["system"]["workflow_path"],
                    "run_id": 101,
                    "artifact_id": 201,
                    "artifact_name": f"canonical-v4-operator-system-{SOURCE}",
                },
                "surface": {
                    "workflow_path": module.KIND_SPECS["surface"]["workflow_path"],
                    "run_id": 102,
                    "artifact_id": 202,
                    "artifact_name": f"canonical-v4-operator-surface-{SOURCE}",
                },
                "local-ai": {
                    "workflow_path": module.KIND_SPECS["local-ai"]["workflow_path"],
                    "run_id": 103,
                    "artifact_id": 203,
                    "artifact_name": f"canonical-v4-operator-local-ai-{SOURCE}",
                },
            },
            "artifact_urls": {
                "system.erofs": prefix + "system.erofs",
                "native-surface-runtime.erofs": prefix + "native-surface-runtime.erofs",
                "local-ai-runtime.erofs": prefix + "local-ai-runtime.erofs",
            },
            "publication_performed": False,
            "signing_performed": False,
            "release_activated": False,
            "physical_target_selected": False,
            "physical_write_authorized": False,
            "physical_write_performed": False,
        }

    def _write_json(self, path: Path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    def _fixture(self, root: Path):
        request = self._request()
        request_path = root / "request.json"
        self._write_json(request_path, request)

        artifacts_root = root / "artifacts"
        metadata = root / "metadata"
        metadata.mkdir()
        payloads = {
            "system": {"system.erofs": b"system-bytes\n"},
            "surface": {"native-surface-runtime.erofs": b"surface-bytes\n"},
            "local-ai": {
                "local-ai-runtime.erofs": b"local-ai-bytes\n",
                "source-lock.json": (
                    json.dumps(
                        {
                            "$schema": module.SOURCE_LOCK_SCHEMA,
                            "engine": {
                                "id": "llama.cpp",
                                "repository": "ggml-org/llama.cpp",
                                "commit": "7ab4ee7baad2d920464cbacfad4f4b07cf111fd2",
                                "license": "MIT",
                            },
                            "model": {
                                "id": "qwen3.5-0.8b-q4_0",
                                "repository": "ggml-org/Qwen3.5-0.8B-GGUF",
                                "filename": "Qwen3.5-0.8B-Q4_0.gguf",
                                "sha256": "57d1997790d1744fba5b40a7317df71ea5e2acee28c47e78f0cce39c0703f8cf",
                                "size_bytes": 563036064,
                                "license": "Apache-2.0",
                                "upstream_revision": "9447f74",
                            },
                        },
                        separators=(",", ":"),
                        sort_keys=True,
                    )
                    + "\n"
                ).encode("utf-8"),
            },
        }

        identities = {}
        source_lock = None
        source_lock_payload = None
        for kind, files in payloads.items():
            directory = artifacts_root / kind
            directory.mkdir(parents=True)
            receipt_files = []
            identities[kind] = {}
            for name, payload in files.items():
                path = directory / name
                path.write_bytes(payload)
                identity = {"sha256": digest(payload), "size": len(payload)}
                identities[kind][name] = identity
                receipt_files.append({"name": name, **identity})
                if name == "source-lock.json":
                    source_lock = json.loads(payload.decode("utf-8"))
                    source_lock_payload = payload
            receipt = {
                "$schema": module.RECEIPT_SCHEMA,
                "kind": kind,
                "source_commit": SOURCE,
                "files": receipt_files,
                "publication_performed": False,
                "signing_performed": False,
                "release_activated": False,
                "physical_target_selected": False,
                "physical_write_authorized": False,
                "physical_write_performed": False,
            }
            self._write_json(directory / "operator-receipt.json", receipt)

            req_entry = request["operator_artifacts"][kind]
            run = {
                "id": req_entry["run_id"],
                "event": "workflow_dispatch",
                "status": "completed",
                "conclusion": "success",
                "head_sha": SOURCE,
                "head_branch": "main",
                "path": req_entry["workflow_path"],
            }
            artifact = {
                "id": req_entry["artifact_id"],
                "name": req_entry["artifact_name"],
                "expired": False,
                "digest": "sha256:" + "1" * 64,
                "workflow_run": {
                    "id": req_entry["run_id"],
                    "head_sha": SOURCE,
                    "head_branch": "main",
                },
            }
            self._write_json(metadata / f"{kind}-run.json", run)
            self._write_json(metadata / f"{kind}-artifact.json", artifact)

        trust_path = root / "release-ed25519.json"
        self._write_json(
            trust_path,
            {
                "$schema": module.TRUST_SCHEMA,
                "key_id": module.TRUST_KEY_ID,
                "public_key_base64": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            },
        )

        self.assertIsNotNone(source_lock)
        self.assertIsNotNone(source_lock_payload)
        manifest = {
            "$schema": module.MANIFEST_SCHEMA,
            "source_repository": module.REPOSITORY,
            "source_commit": SOURCE,
            "release_id": SOURCE,
            "created_from_ci_recipe": "release/portable-usb-v2-local-ai/1",
            "product_mode": "usb",
            "storage_profile": "portable-usb-v2",
            "runtime_format": "erofs",
            "artifacts": [
                {
                    "name": name,
                    "role": role,
                    "url": request["artifact_urls"][name],
                    **identities[kind][name],
                }
                for name, role, kind in module.MANIFEST_ARTIFACTS
            ],
            "local_ai": {
                "contract": "ordax.local-ai/1",
                "source_lock_schema": module.SOURCE_LOCK_SCHEMA,
                "source_lock_sha256": digest(source_lock_payload),
                "engine_id": source_lock["engine"]["id"],
                "engine_repository": source_lock["engine"]["repository"],
                "engine_source_commit": source_lock["engine"]["commit"],
                "engine_license": source_lock["engine"]["license"],
                "model_id": source_lock["model"]["id"],
                "model_repository": source_lock["model"]["repository"],
                "model_filename": source_lock["model"]["filename"],
                "model_upstream_revision": source_lock["model"]["upstream_revision"],
                "model_sha256": source_lock["model"]["sha256"],
                "model_size": source_lock["model"]["size_bytes"],
                "model_license": source_lock["model"]["license"],
            },
        }
        manifest_path = root / "release-manifest.json"
        self._write_json(manifest_path, manifest)
        return request_path, metadata, artifacts_root, trust_path, manifest_path

    def test_valid_public_request_produces_non_authorizing_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            request, metadata, artifacts, trust, manifest = self._fixture(root)
            out = root / "validation.json"
            result = module.validate_all(
                request_path=request,
                metadata_dir=metadata,
                artifact_dirs={k: artifacts / k for k in module.KIND_SPECS},
                trust_path=trust,
                manifest_path=manifest,
                output_path=out,
            )
            self.assertEqual(result["status"], "validated-public-signing-request")
            self.assertFalse(result["private_key_included"])
            self.assertFalse(result["signing_performed"])
            self.assertFalse(result["publication_performed"])
            self.assertFalse(result["physical_write_authorized"])
            self.assertTrue(out.is_file())

    def test_frozen_candidate_metadata_requires_exact_operator_ref_for_every_kind(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            request_path, metadata, artifacts, trust, manifest = self._fixture(root)
            request = json.loads(request_path.read_text(encoding="utf-8"))
            branch = "release-candidate/" + SOURCE
            request["operator_ref"] = branch
            self._write_json(request_path, request)
            for kind in module.KIND_SPECS:
                for suffix in ("run", "artifact"):
                    path = metadata / f"{kind}-{suffix}.json"
                    data = json.loads(path.read_text(encoding="utf-8"))
                    if suffix == "run":
                        data["head_branch"] = branch
                    else:
                        data["workflow_run"]["head_branch"] = branch
                    self._write_json(path, data)
            receipt = module.validate_all(
                request_path=request_path, metadata_dir=metadata,
                artifact_dirs={kind: artifacts / kind for kind in module.KIND_SPECS},
                trust_path=trust, manifest_path=manifest,
                output_path=root / "candidate-validated.json",
            )
            self.assertEqual(receipt["status"], "validated-public-signing-request")
            self.assertFalse(receipt["publication_performed"])

            path = metadata / "surface-artifact.json"
            tampered = json.loads(path.read_text(encoding="utf-8"))
            tampered["workflow_run"]["head_branch"] = "main"
            self._write_json(path, tampered)
            with self.assertRaisesRegex(module.ValidationError, "another source commit/branch"):
                module.validate_all(
                    request_path=request_path, metadata_dir=metadata,
                    artifact_dirs={kind: artifacts / kind for kind in module.KIND_SPECS},
                    trust_path=trust, manifest_path=manifest,
                    output_path=root / "candidate-rejected.json",
                )

    def test_candidate_request_rejects_arbitrary_ref_and_sha_mismatch(self):
        request = self._request()
        for invalid in (
            "feature/anything", "release-candidate/" + "b" * 40,
            "release-candidate/" + SOURCE + "-extra",
            "refs/tags/" + SOURCE,
        ):
            with self.subTest(invalid=invalid):
                request["operator_ref"] = invalid
                with self.assertRaisesRegex(module.ValidationError, "operator ref"):
                    module.validate_request_document(request)
        request["operator_ref"] = "release-candidate/" + SOURCE
        self.assertEqual(module.validate_request_document(request)["operator_ref"], request["operator_ref"])

    def test_modified_payload_is_rejected_against_operator_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            request, metadata, artifacts, trust, manifest = self._fixture(root)
            (artifacts / "surface" / "native-surface-runtime.erofs").write_bytes(b"tampered\n")
            with self.assertRaises(module.ValidationError):
                module.validate_all(
                    request_path=request,
                    metadata_dir=metadata,
                    artifact_dirs={k: artifacts / k for k in module.KIND_SPECS},
                    trust_path=trust,
                    manifest_path=manifest,
                    output_path=root / "validation.json",
                )

    def test_unsafe_operator_receipt_flag_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            request, metadata, artifacts, trust, manifest = self._fixture(root)
            receipt_path = artifacts / "system" / "operator-receipt.json"
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
            receipt["physical_write_authorized"] = True
            self._write_json(receipt_path, receipt)
            with self.assertRaises(module.ValidationError):
                module.validate_all(
                    request_path=request,
                    metadata_dir=metadata,
                    artifact_dirs={k: artifacts / k for k in module.KIND_SPECS},
                    trust_path=trust,
                    manifest_path=manifest,
                    output_path=root / "validation.json",
                )

    def test_release_url_outside_exact_tag_namespace_is_rejected(self):
        request = self._request()
        request["artifact_urls"]["system.erofs"] = "https://example.invalid/system.erofs"
        with self.assertRaises(module.ValidationError):
            module.validate_request_document(request)

    def test_duplicate_json_key_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "duplicate.json"
            path.write_text('{"a":1,"a":2}\n', encoding="utf-8")
            with self.assertRaises(module.ValidationError):
                module._load_json(path, "duplicate fixture")

    def test_committed_request_is_historical_and_cannot_authorize_new_owner(self):
        request = json.loads(REQUEST_PATH.read_text(encoding="utf-8"))
        self.assertEqual(request["source_repository"], "washingtonmsdj/prototipo-ordax-os")
        # Preserve the exact historical document but never let the current
        # operator sign/publish a prior owner's request as if it were new.
        self.assertNotEqual(request["source_repository"], module.REPOSITORY)
        with self.assertRaisesRegex(module.ValidationError, "signing request source repository is invalid"):
            module.validate_request_document(request)
        self.assertEqual(request["source_commit"], SOURCE)
        self.assertEqual(request["operator_artifacts"]["system"]["artifact_id"], 11265035859)
        self.assertEqual(request["operator_artifacts"]["surface"]["artifact_id"], 11264791507)
        self.assertEqual(request["operator_artifacts"]["local-ai"]["artifact_id"], 11263934783)
        self.assertTrue(all(request[field] is False for field in module.UNSAFE_FIELDS))

    def test_workflow_keeps_large_bytes_and_private_key_out_of_export(self):
        workflow = WORKFLOW_PATH.read_text(encoding="utf-8")
        self.assertIn("permissions:\n  contents: read\n  actions: read", workflow)
        self.assertIn("actions/artifacts/${artifact_id}/zip", workflow)
        self.assertNotIn("gh run download", workflow)
        self.assertIn("test ! -e \"$package/release-envelope.json\"", workflow)
        self.assertIn("-iname '*.erofs'", workflow)
        self.assertIn("-iname '*.pem'", workflow)
        self.assertIn("SIGNING_PERFORMED=NO", workflow)
        self.assertIn("PHYSICAL_WRITE_AUTHORIZED=NO", workflow)
        self.assertNotIn("ordax-release-signing\" sign", workflow)


if __name__ == "__main__":
    unittest.main()
