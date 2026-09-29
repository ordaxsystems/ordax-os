import importlib.util
from pathlib import Path
import tempfile
import unittest

from tests.test_windows_compat_runtime_dependency_discovery import stage_metadata, synthetic_elf32, synthetic_elf64

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_dependency_loader_invariance_guard.py"
SPEC = importlib.util.spec_from_file_location("runtime_dependency_loader_invariance_guard", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def write(path: Path, data: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


def prepare_roots(root: Path) -> tuple[Path, Path]:
    stage = root / "stage"
    rootfs = root / "rootfs"
    stage.mkdir()
    rootfs.mkdir()
    write(rootfs / "usr/lib/libc.so.6", synthetic_elf64(b"ld-musl-x86_64.so.1"))
    write(rootfs / "lib/ld-musl-x86_64.so.1", synthetic_elf64(b"libc.so.6"))
    return stage, rootfs


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


class RuntimeDependencyLoaderInvarianceTests(unittest.TestCase):
    def test_two_reachable_targets_fail_needed_by_and_shortname_invariance(self):
        with tempfile.TemporaryDirectory() as temp:
            stage, rootfs = prepare_roots(Path(temp))
            write(stage / "usr/bin/wine", synthetic_elf64(runpath=b"/opt/a"))
            write(stage / "usr/bin/helper", synthetic_elf64(runpath=b"/opt/b"))
            write(stage / "opt/a/libexample.so.1", synthetic_elf64(b"libc.so.6"))
            write(stage / "opt/b/libexample.so.1", synthetic_elf64(b"libc.so.6"))
            with self.assertRaisesRegex(MODULE.LoaderInvarianceError, "depends on needed_by/shortname state"):
                MODULE.verify(stage, rootfs, full_build_proof(stage))

    def test_aliases_to_one_canonical_target_are_invariant(self):
        with tempfile.TemporaryDirectory() as temp:
            stage, rootfs = prepare_roots(Path(temp))
            write(stage / "usr/bin/wine", synthetic_elf64(runpath=b"/opt/a"))
            write(stage / "usr/bin/helper", synthetic_elf64(runpath=b"/opt/b"))
            target = write(stage / "opt/a/libexample.so.1", synthetic_elf64(b"libc.so.6"))
            alias = stage / "opt/b/libexample.so.1"
            alias.parent.mkdir(parents=True)
            alias.symlink_to("../a/libexample.so.1")
            result = MODULE.verify(stage, rootfs, full_build_proof(stage))
            self.assertEqual(result["$schema"], MODULE.PROOF_SCHEMA)
            self.assertTrue(result["gates"]["staged_needed_by_chain_invariance_verified"])
            self.assertTrue(result["gates"]["staged_shortname_reuse_invariance_verified"])
            pair = result["needed_targets"]["ELF64:machine=62:little:libexample.so.1"]
            self.assertEqual(pair["target"]["canonical_path"], target.relative_to(stage).as_posix())
            self.assertEqual(len(pair["target"]["candidate_paths"]), 2)

    def test_incompatible_reachable_ancestor_path_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            stage, rootfs = prepare_roots(Path(temp))
            write(stage / "usr/bin/wine", synthetic_elf64(runpath=b"/opt/a"))
            write(stage / "usr/bin/helper", synthetic_elf64(runpath=b"/opt/b"))
            write(stage / "opt/a/libexample.so.1", synthetic_elf64(b"libc.so.6"))
            write(stage / "opt/b/libexample.so.1", synthetic_elf32(b"libc.so.6"))
            with self.assertRaisesRegex(MODULE.LoaderInvarianceError, "incompatible pathname"):
                MODULE.verify(stage, rootfs, full_build_proof(stage))


if __name__ == "__main__":
    unittest.main()
