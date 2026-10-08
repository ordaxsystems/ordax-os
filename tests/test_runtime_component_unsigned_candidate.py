import hashlib
import importlib.util
import json
import stat
import tempfile
import unittest
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERIFIER = ROOT / "tools" / "runtime-component-channel" / "verify_unsigned_candidate.py"

spec = importlib.util.spec_from_file_location("verify_unsigned_candidate", VERIFIER)
verifier = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(verifier)


def canonical(value):
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def digest(payload):
    return hashlib.sha256(payload).hexdigest()


def write_json(path, value):
    path.write_bytes(canonical(value))


def zip_info(name):
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_STORED
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | 0o644) << 16
    return info


def make_candidate(root: Path):
    candidate = root / "candidate"
    candidate.mkdir()
    app_id = "notes"
    version = "0.4.2"
    commit = "a" * 40
    source = "ordaxsystems/ordax-apps"

    bodies = {
        "system/apps/notes/src/runtime.mjs": b'export const runtime = "notes";\n',
        "system/apps/notes/ai/manifest.json": b'{"schema":"test"}\n',
        "system/apps/notes/actions/manifest.json": b'{"schema":"test"}\n',
    }
    records = [
        {"path": name, "sha256": digest(payload), "size": len(payload)}
        for name, payload in sorted(bodies.items())
    ]
    manifest = {
        "$schema": verifier.PACKAGE_SCHEMA,
        "status": "candidate",
        "component": {
            "id": app_id,
            "title": "Notas",
            "kind": "app",
            "version": version,
            "releaseMode": "component-slot",
            "criticality": "optional",
            "failureDomain": "app",
            "restartScope": "component",
            "healthMode": "runtime",
            "owner": source,
            "dependencies": [],
        },
        "source_commit": commit,
        "entrypoint": "system/apps/notes/src/runtime.mjs",
        "self_contained_source_graph": True,
        "remote_runtime_dependencies": False,
        "activation_allowed": False,
        "signature_required_before_activation": True,
        "native_adapters_packaged": False,
        "composition_packaged": False,
        "files": records,
    }
    manifest_bytes = canonical(manifest)

    package = candidate / "notes.zip"
    with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr(zip_info("component-package.json"), manifest_bytes)
        for name, payload in sorted(bodies.items()):
            archive.writestr(zip_info(name), payload)
    package_bytes = package.read_bytes()

    compatibility = {
        "schema": verifier.COMPATIBILITY_SCHEMA,
        "componentId": app_id,
        "componentVersion": version,
        "provides": [{"id": "ordax.component-runtime", "major": 1}],
        "requires": [],
        "state": {
            "id": "ordax.notes-store",
            "writeVersion": 2,
            "readableFrom": 1,
            "readableThrough": 2,
        },
        "authority": "none",
    }
    compatibility_path = candidate / "notes.compatibility.json"
    compatibility_bytes = canonical(compatibility)
    compatibility_path.write_bytes(compatibility_bytes)

    release = {
        "$schema": verifier.RELEASE_SCHEMA,
        "source_repository": source,
        "source_commit": commit,
        "created_from_ci_recipe": "runtime-component/package/1",
        "component": {
            "id": app_id,
            "version": version,
            "release_mode": "component-slot",
            "package_schema": verifier.PACKAGE_SCHEMA,
        },
        "package": {
            "name": "notes.zip",
            "sha256": digest(package_bytes),
            "size": len(package_bytes),
            "manifest_sha256": digest(manifest_bytes),
        },
        "activation": {
            "direct_activation_allowed": False,
            "pending_health_required": True,
        },
        "compatibility": {
            "name": "notes.compatibility.json",
            "schema": verifier.COMPATIBILITY_SCHEMA,
            "sha256": digest(compatibility_bytes),
            "size": len(compatibility_bytes),
        },
    }
    release_path = candidate / "notes.release.json"
    release_bytes = canonical(release)
    release_path.write_bytes(release_bytes)

    handoff = {
        "$schema": verifier.HANDOFF_SCHEMA,
        "status": "unsigned-candidate",
        "component": {
            "id": app_id,
            "version": version,
            "releaseMode": "component-slot",
        },
        "source": {"repository": source, "commit": commit},
        "artifacts": {
            "package": {
                "name": "notes.zip",
                "sha256": digest(package_bytes),
                "size": len(package_bytes),
            },
            "release": {
                "name": "notes.release.json",
                "sha256": digest(release_bytes),
                "size": len(release_bytes),
            },
            "compatibility": {
                "name": "notes.compatibility.json",
                "sha256": digest(compatibility_bytes),
                "size": len(compatibility_bytes),
            },
        },
        "trust": {
            "domain": verifier.TRUST_DOMAIN,
            "requiredKeyId": verifier.KEY_ID,
            "canonicalPublicAnchorRequiredBeforeProductionSigning": True,
        },
        "authority": {
            "signing": False,
            "publication": False,
            "installation": False,
            "activation": False,
        },
        "safety": {
            "containsPrivateKeyMaterial": False,
            "directActivationAllowed": False,
            "platformLifecycleRequired": True,
        },
    }
    handoff_path = candidate / "notes.unsigned-candidate.json"
    handoff_bytes = canonical(handoff)
    handoff_path.write_bytes(handoff_bytes)

    sums = {
        "notes.zip": digest(package_bytes),
        "notes.release.json": digest(release_bytes),
        "notes.compatibility.json": digest(compatibility_bytes),
        "notes.unsigned-candidate.json": digest(handoff_bytes),
    }
    (candidate / "SHA256SUMS").write_text(
        "".join(f"{value}  {name}\n" for name, value in sums.items()),
        encoding="utf-8",
    )

    policy = {
        "$schema": verifier.POLICY_SCHEMA,
        "trust_domain": verifier.TRUST_DOMAIN,
        "canonical_external_source_repository_by_component": {
            "notes": source,
            "studio": source,
        },
    }
    policy_path = root / "package-policy.json"
    write_json(policy_path, policy)
    return candidate, policy_path, handoff_path


class UnsignedExternalCandidateTests(unittest.TestCase):
    def test_valid_notes_candidate_is_verified_without_authority(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate, policy, _ = make_candidate(root)
            result = verifier.verify(candidate, policy)
        self.assertEqual(result["component_id"], "notes")
        self.assertEqual(result["version"], "0.4.2")
        self.assertEqual(result["source_repository"], "ordaxsystems/ordax-apps")
        self.assertEqual(result["source_commit"], "a" * 40)

    def test_authority_escalation_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate, policy, handoff_path = make_candidate(root)
            handoff = json.loads(handoff_path.read_text(encoding="utf-8"))
            handoff["authority"]["publication"] = True
            handoff_path.write_bytes(canonical(handoff))
            with self.assertRaisesRegex(verifier.CandidateError, "must carry no authority"):
                verifier.verify(candidate, policy)

    def test_noncanonical_source_repository_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate, policy, _ = make_candidate(root)
            value = json.loads(policy.read_text(encoding="utf-8"))
            value["canonical_external_source_repository_by_component"]["notes"] = "washingtonmsdj/other"
            policy.write_bytes(canonical(value))
            with self.assertRaisesRegex(verifier.CandidateError, "source is not canonical"):
                verifier.verify(candidate, policy)

    def test_unexpected_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate, policy, _ = make_candidate(root)
            (candidate / "private.pem").write_text("forbidden\n", encoding="utf-8")
            with self.assertRaisesRegex(verifier.CandidateError, "unexpected or missing files"):
                verifier.verify(candidate, policy)


if __name__ == "__main__":
    unittest.main()
