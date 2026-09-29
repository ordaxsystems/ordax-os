import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from tests.test_windows_compat_runtime_dependency_discovery import stage_metadata, synthetic_elf32, synthetic_elf64

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_dependency_first_hit_guard.py"
SPEC = importlib.util.spec_from_file_location("runtime_dependency_first_hit_proof", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def write(path: Path, data: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


def full_build_proof(stage: Path) -> dict:
    return {
        "$schema": "prototype-ordax.windows-compat-full-build-proof/2",
        "runtime_id": "wine-11.0-wow64-x86_64-candidate",
        "staging": stage_metadata(stage),
        "gates": {
            "full_build_proof_passed": True,
            "staged_install_completed": True,
            "runtime_dependency_inventory_complete": False,
            "binary_artifact_pinned": False,
            "activation_authorized": False,
            "execution_authorized": False,
            "windows_payload_executed": False,
            "wine_executed": False,
        },
    }


class RuntimeDependencyFirstHitProofTests(unittest.TestCase):
    def test_bootstrap_source_authority_matches_locked_wine_source(self):
        contract = MODULE.PROBE.load_contract()
        source = json.loads((ROOT / "bootstrap/windows-compat-runtime/source.json").read_text(encoding="utf-8"))
        authority = contract["loader_bootstrap"]["source_authority"]
        self.assertEqual(authority["source_lock"], "source.json")
        self.assertEqual(authority["source_schema"], source["$schema"])
        self.assertEqual(authority["runtime_id"], source["runtime_id"])
        self.assertEqual(authority["engine"], source["engine"])
        self.assertEqual(authority["wine_version"], source["version"])
        self.assertEqual(authority["archive_sha256"], source["upstream"]["archive_sha256"])
        self.assertEqual(authority["source_path"], "tools/wine/wine.c")

    def test_verify_emits_content_bound_non_promoting_proof(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            write(stage / "usr/bin/wine", synthetic_elf64())
            write(rootfs / "usr/lib/libexample.so.1", synthetic_elf64(b"libc.so.6"))
            proof = full_build_proof(stage)
            result = MODULE.verify(stage, rootfs, proof)
            self.assertEqual(result["$schema"], MODULE.PROOF_SCHEMA)
            self.assertEqual(result["runtime_id"], proof["runtime_id"])
            self.assertEqual(
                result["staging_manifest_sha256"],
                proof["staging"]["canonical_manifest_sha256"],
            )
            self.assertEqual(result["counts"]["dependencies_checked"], 1)
            self.assertEqual(result["counts"]["rootfs_hits"], 1)
            self.assertEqual(result["counts"]["stage_hits"], 0)
            self.assertEqual(result["counts"]["bootstrap_shortname_hits"], 0)
            self.assertTrue(result["gates"]["first_pathname_hit_verified"])
            for gate in (
                "runtime_dependency_inventory_complete",
                "binary_artifact_pinned",
                "activation_authorized",
                "execution_authorized",
                "wine_executed",
                "windows_payload_executed",
            ):
                self.assertFalse(result["gates"][gate])

    def test_wine_ntdll_bootstrap_shortname_is_verified_before_path_search(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            module = write(
                stage / "usr/lib/wine/x86_64-unix/avicap32.so",
                synthetic_elf64(b"ntdll.so"),
            )
            target = write(
                stage / "usr/lib/wine/x86_64-unix/ntdll.so",
                synthetic_elf64(b"libc.so.6"),
            )
            write(rootfs / "usr/lib/libc.so.6", synthetic_elf64(b"ld-musl-x86_64.so.1"))
            proof = full_build_proof(stage)
            result = MODULE.verify(stage, rootfs, proof)
            self.assertEqual(result["counts"]["dependencies_checked"], 2)
            self.assertEqual(result["counts"]["stage_hits"], 1)
            self.assertEqual(result["counts"]["rootfs_hits"], 1)
            self.assertEqual(result["counts"]["bootstrap_shortname_hits"], 1)
            consumer = MODULE.PROBE.parse_elf_dynamic(module)
            bootstrap = MODULE.PROBE.resolve_bootstrap_shortname(
                stage, "ntdll.so", consumer, MODULE.PROBE.load_contract()
            )
            self.assertEqual(bootstrap["path"], target.relative_to(stage).as_posix())
            self.assertEqual(bootstrap["resolution_kind"], "bootstrap-shortname-reuse")
            self.assertIsNone(bootstrap["search_directory"])

    def test_declared_bootstrap_shortname_fails_if_exact_target_is_missing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            rootfs.mkdir()
            write(
                stage / "usr/lib/wine/x86_64-unix/avicap32.so",
                synthetic_elf64(b"ntdll.so"),
            )
            with self.assertRaisesRegex(MODULE.FirstHitGuardError, "bootstrap shortname target is missing"):
                MODULE.verify(stage, rootfs, full_build_proof(stage))

    def test_declared_bootstrap_shortname_fails_on_wrong_elf_identity(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            rootfs.mkdir()
            write(
                stage / "usr/lib/wine/x86_64-unix/avicap32.so",
                synthetic_elf64(b"ntdll.so"),
            )
            write(
                stage / "usr/lib/wine/x86_64-unix/ntdll.so",
                synthetic_elf32(b"libc.so.6"),
            )
            with self.assertRaisesRegex(MODULE.FirstHitGuardError, "bootstrap shortname ELF identity mismatch"):
                MODULE.verify(stage, rootfs, full_build_proof(stage))


if __name__ == "__main__":
    unittest.main()
