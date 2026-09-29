import importlib.util
from pathlib import Path
import tempfile
import unittest

from tests.test_windows_compat_runtime_dependency_discovery import stage_metadata, synthetic_elf64

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


class RuntimeDependencyFirstHitProofTests(unittest.TestCase):
    def test_verify_emits_content_bound_non_promoting_proof(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            write(stage / "usr/bin/wine", synthetic_elf64())
            write(rootfs / "usr/lib/libexample.so.1", synthetic_elf64(b"libc.so.6"))
            proof = {
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


if __name__ == "__main__":
    unittest.main()
