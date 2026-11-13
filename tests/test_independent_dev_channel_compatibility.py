from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import hashlib
import io
import json
import os
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

    def test_cross_commit_owner_rootfs_reuse_requires_verified_artifact_receipt(self):
        cache_module = load_module(
            ROOT / "tools/ci/portable_component_cache.py",
            "ordax_independent_dev_channel_owner_cache_test",
        )
        previous_env = os.environ.get("ORDAX_COMPONENT_CACHE_ENVIRONMENT")
        os.environ["ORDAX_COMPONENT_CACHE_ENVIRONMENT"] = "unit-test/linux-x86_64/source-bound"
        try:
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                artifacts = root / "artifacts"
                artifacts.mkdir()
                rootfs = artifacts / "rootfs.tar"
                provenance = artifacts / "provenance.json"
                integration = root / "owner-reuse.json"
                write_rootfs(rootfs)
                write_provenance(provenance, rootfs)
                metadata = json.loads(provenance.read_text(encoding="utf-8"))
                for name in ("rootfs.cpio.gz", "independent-base.erofs"):
                    payload = ("verified:" + name).encode()
                    (artifacts / name).write_bytes(payload)
                    metadata["artifacts"][name] = hashlib.sha256(payload).hexdigest()
                provenance.write_text(json.dumps(metadata) + "\n", encoding="utf-8")
                current = "2" * 40
                cache_module.record_component(
                    "independent-base-owner", artifacts, SOURCE, root=ROOT,
                )
                receipt = cache_module.verify_component(
                    "independent-base-owner", artifacts, current,
                    integration, cache_hit=True, root=ROOT,
                )
                with self.assertRaisesRegex(proof.policy.IndependentRootfsError, "source commit differs"):
                    proof.policy.validate(rootfs=rootfs, provenance_path=provenance, expected_commit=current)
                accepted = proof.prove(
                    rootfs=rootfs, provenance_path=provenance,
                    expected_commit=current, receipt_path=root / "compatible.json",
                    reuse_receipt=integration,
                )
                self.assertEqual(accepted["source_commit"], current)
                self.assertEqual(accepted["build_source_commit"], SOURCE)
                self.assertTrue(accepted["rootfs_reused"])
                for change in (
                    {"integration_source_commit": "3" * 40},
                    {"build_source_commit": "4" * 40},
                    {"provenance_rewritten": True},
                    {"reused": False},
                ):
                    altered = dict(receipt, **change)
                    integration.write_text(json.dumps(altered), encoding="utf-8")
                    with self.assertRaisesRegex(proof.policy.IndependentRootfsError, "receipt"):
                        proof.policy.validate(
                            rootfs=rootfs, provenance_path=provenance,
                            expected_commit=current, reuse_receipt=integration,
                        )
                altered = dict(receipt)
                altered["artifacts"] = dict(receipt["artifacts"])
                altered["artifacts"]["rootfs.tar"] = dict(
                    receipt["artifacts"]["rootfs.tar"], sha256="0" * 64
                )
                integration.write_text(json.dumps(altered), encoding="utf-8")
                with self.assertRaisesRegex(proof.policy.IndependentRootfsError, "rejects rootfs.tar"):
                    proof.policy.validate(
                        rootfs=rootfs, provenance_path=provenance,
                        expected_commit=current, reuse_receipt=integration,
                    )
                # A self-consistent JSON receipt without the canonical manifest
                # must never authorize an older producer in a newer checkout.
                integration.write_text(json.dumps(receipt), encoding="utf-8")
                (artifacts / cache_module.CACHE_MANIFEST).unlink()
                with self.assertRaisesRegex(proof.policy.IndependentRootfsError, "canonical verification"):
                    proof.policy.validate(
                        rootfs=rootfs, provenance_path=provenance,
                        expected_commit=current, reuse_receipt=integration,
                    )
        finally:
            if previous_env is None:
                os.environ.pop("ORDAX_COMPONENT_CACHE_ENVIRONMENT", None)
            else:
                os.environ["ORDAX_COMPONENT_CACHE_ENVIRONMENT"] = previous_env

    def test_authenticated_owner_rootfs_materializes_safe_symlinks_atomically(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            rootfs = root / "rootfs.tar"
            provenance = root / "provenance.json"
            destination_parent = root / "materialized"
            destination_parent.mkdir()
            destination = destination_parent / "rootfs"
            write_rootfs(rootfs)
            write_provenance(provenance, rootfs)

            result = proof.policy.materialize(
                rootfs=rootfs,
                provenance_path=provenance,
                expected_commit=SOURCE,
                destination=destination,
            )

            self.assertEqual(result["destination"], destination)
            self.assertTrue(destination.is_dir())
            # The Creator runs as a normal user after root-owned extraction.
            self.assertEqual(destination.stat().st_mode & 0o777, 0o755)
            self.assertTrue((destination / "bin/sh").is_symlink())
            self.assertEqual((destination / "bin/sh").readlink().as_posix(), "busybox")
            self.assertEqual(
                (destination / "bin/sh").resolve(strict=True),
                (destination / "bin/busybox").resolve(strict=True),
            )
            consumer._verify_materialized_tree(destination)

    def test_materializer_refuses_existing_destination(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            rootfs = root / "rootfs.tar"
            provenance = root / "provenance.json"
            destination = root / "rootfs"
            destination.mkdir()
            write_rootfs(rootfs)
            write_provenance(provenance, rootfs)

            with self.assertRaisesRegex(
                proof.CompatibilityError,
                "destination must not exist",
            ):
                proof.policy.materialize(
                    rootfs=rootfs,
                    provenance_path=provenance,
                    expected_commit=SOURCE,
                    destination=destination,
                )

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
