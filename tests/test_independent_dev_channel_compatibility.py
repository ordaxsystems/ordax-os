from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import hashlib
import io
import json
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
PROOF = ROOT / "tools" / "dev-base-channel" / "prove_independent_rootfs.py"
SOURCE = "1" * 40


def load_module(path: Path, name: str):
    spec = spec_from_file_location(name, path)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


proof = load_module(PROOF, "ordax_independent_dev_channel_compatibility_test")
consumer = proof.consumer


def add_dir(archive: tarfile.TarFile, name: str) -> None:
    info = tarfile.TarInfo(name)
    info.type = tarfile.DIRTYPE
    info.mode = 0o755
    info.size = 0
    archive.addfile(info)


def add_file(archive: tarfile.TarFile, name: str, payload: bytes) -> None:
    info = tarfile.TarInfo(name)
    info.type = tarfile.REGTYPE
    info.mode = 0o755
    info.size = len(payload)
    archive.addfile(info, io.BytesIO(payload))


def add_symlink(archive: tarfile.TarFile, name: str, target: str) -> None:
    info = tarfile.TarInfo(name)
    info.type = tarfile.SYMTYPE
    info.mode = 0o777
    info.linkname = target
    info.size = 0
    archive.addfile(info)


def write_rootfs(path: Path, *, sh_target: str = "busybox") -> None:
    directories = set(consumer.REQUIRED_ROOTFS_DIRS)
    for relative in consumer.REQUIRED_ROOTFS_PATHS:
        parent = Path(relative).parent
        while parent != Path("."):
            directories.add(parent.as_posix())
            parent = parent.parent

    with tarfile.open(path, "w", format=tarfile.GNU_FORMAT) as archive:
        for directory in sorted(directories):
            add_dir(archive, directory)
        for relative in sorted(consumer.REQUIRED_ROOTFS_PATHS):
            if relative == "bin/sh":
                add_symlink(archive, relative, sh_target)
            else:
                add_file(archive, relative, f"fixture:{relative}\n".encode("utf-8"))


def write_provenance(
    path: Path,
    rootfs: Path,
    *,
    rootfs_hash: str | None = None,
    profile: str = "owner-development",
    capabilities_verified: bool = True,
) -> None:
    path.write_text(
        json.dumps(
            {
                "$schema": "prototype-ordax.independent-base-provenance/1",
                "status": "candidate-build-only",
                "source_commit": SOURCE,
                "profile": profile,
                "owner_development_capabilities_verified": capabilities_verified,
                "artifacts": {
                    "rootfs.tar": rootfs_hash or hashlib.sha256(rootfs.read_bytes()).hexdigest(),
                },
                "physical_artifact_authorized": False,
                "signed_release_equivalence_proven": False,
            }
        ),
        encoding="utf-8",
    )


class IndependentDevChannelCompatibilityTests(unittest.TestCase):
    def test_owner_rootfs_is_accepted_only_as_non_publishable_compatibility_receipt(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            rootfs = root / "rootfs.tar"
            provenance = root / "provenance.json"
            receipt = root / "receipt.json"
            write_rootfs(rootfs)
            write_provenance(provenance, rootfs)

            result = proof.prove(
                rootfs=rootfs,
                provenance_path=provenance,
                expected_commit=SOURCE,
                receipt_path=receipt,
            )

            self.assertTrue(result["dev_channel_compatible"])
            self.assertEqual(result["status"], "compatible-not-authorized")
            self.assertFalse(result["publish_authorized"])
            self.assertFalse(result["physical_artifact_authorized"])
            self.assertFalse(result["stable_channel_authorized"])
            self.assertFalse(result["signed_release_equivalence_proven"])
            self.assertGreater(result["archive_members"], 0)
            self.assertGreaterEqual(result["symlink_members"], 1)
            self.assertEqual(json.loads(receipt.read_text(encoding="utf-8")), result)

    def test_consumer_rejects_escaping_symlink_from_independent_rootfs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            rootfs = root / "rootfs.tar"
            provenance = root / "provenance.json"
            write_rootfs(rootfs, sh_target="../../escape")
            write_provenance(provenance, rootfs)

            with self.assertRaisesRegex(
                proof.CompatibilityError,
                "Dev Channel rejected Independent rootfs.tar.*unsafe symlink",
            ):
                proof.prove(
                    rootfs=rootfs,
                    provenance_path=provenance,
                    expected_commit=SOURCE,
                    receipt_path=root / "receipt.json",
                )

    def test_provenance_hash_mismatch_fails_before_consumer_acceptance(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            rootfs = root / "rootfs.tar"
            provenance = root / "provenance.json"
            write_rootfs(rootfs)
            write_provenance(provenance, rootfs, rootfs_hash="a" * 64)

            with self.assertRaisesRegex(
                proof.CompatibilityError,
                "differs from authenticated provenance",
            ):
                proof.prove(
                    rootfs=rootfs,
                    provenance_path=provenance,
                    expected_commit=SOURCE,
                    receipt_path=root / "receipt.json",
                )

    def test_non_owner_profile_cannot_receive_dev_channel_compatibility_receipt(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            rootfs = root / "rootfs.tar"
            provenance = root / "provenance.json"
            write_rootfs(rootfs)
            write_provenance(provenance, rootfs, profile="minimal")

            with self.assertRaisesRegex(
                proof.CompatibilityError,
                "requires owner-development profile",
            ):
                proof.prove(
                    rootfs=rootfs,
                    provenance_path=provenance,
                    expected_commit=SOURCE,
                    receipt_path=root / "receipt.json",
                )

    def test_owner_profile_without_capability_proof_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            rootfs = root / "rootfs.tar"
            provenance = root / "provenance.json"
            write_rootfs(rootfs)
            write_provenance(provenance, rootfs, capabilities_verified=False)

            with self.assertRaisesRegex(
                proof.CompatibilityError,
                "capability proof is missing",
            ):
                proof.prove(
                    rootfs=rootfs,
                    provenance_path=provenance,
                    expected_commit=SOURCE,
                    receipt_path=root / "receipt.json",
                )


if __name__ == "__main__":
    unittest.main()
