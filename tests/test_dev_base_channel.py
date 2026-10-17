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
BUILDER = ROOT / "tools" / "dev-base-channel" / "build.py"
CONSUMER = ROOT / "system" / "services" / "base-update" / "dev_channel.py"
SOURCE = "1" * 40


def load_module(path: Path, name: str):
    spec = spec_from_file_location(name, path)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


builder = load_module(BUILDER, "ordax_dev_base_builder_test")
consumer = load_module(CONSUMER, "ordax_dev_base_consumer_test")


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
                add_file(archive, relative, f"fixture:{relative}\n".encode())


def write_inputs(root: Path, source_commit: str = SOURCE):
    kernel_dir = root / "kernel"
    initramfs_dir = root / "initramfs"
    independent = root / "independent"
    kernel_dir.mkdir()
    initramfs_dir.mkdir()
    independent.mkdir()

    kernel_name = "vmlinuz-6.6.52"
    kernel = b"kernel-candidate-bytes\n"
    initramfs = b"initramfs-candidate-bytes\n"
    (kernel_dir / kernel_name).write_bytes(kernel)
    (initramfs_dir / "initramfs.cpio.gz").write_bytes(initramfs)
    (kernel_dir / "kernel-provenance.json").write_text(json.dumps({
        "$schema": "prototype-ordax.kernel-provenance/1",
        "source_commit": source_commit,
        "artifacts": {
            kernel_name: hashlib.sha256(kernel).hexdigest(),
            "kernel-modules-6.6.52.tar": "a" * 64,
        },
    }), encoding="utf-8")
    (initramfs_dir / "initramfs-provenance.json").write_text(json.dumps({
        "$schema": "prototype-ordax.initramfs-provenance/1",
        "source_commit": source_commit,
        "artifacts": {
            "initramfs.cpio.gz": hashlib.sha256(initramfs).hexdigest(),
            "busybox.config": "b" * 64,
        },
    }), encoding="utf-8")

    rootfs = independent / "rootfs.tar"
    write_rootfs(rootfs)
    (independent / "provenance.json").write_text(json.dumps({
        "$schema": "prototype-ordax.independent-base-provenance/1",
        "status": "candidate-build-only",
        "source_commit": source_commit,
        "profile": "owner-development",
        "owner_development_capabilities_verified": True,
        "artifacts": {"rootfs.tar": hashlib.sha256(rootfs.read_bytes()).hexdigest()},
        "physical_artifact_authorized": False,
        "signed_release_equivalence_proven": False,
    }), encoding="utf-8")
    return kernel_dir, initramfs_dir, independent, kernel, initramfs, rootfs


class DevBaseProducerTests(unittest.TestCase):
    def test_build_reuses_independent_rootfs_bytes_without_reserializing(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            kernel_dir, initramfs_dir, independent, kernel, initramfs, rootfs = write_inputs(root)
            original = rootfs.read_bytes()
            out = root / "candidate"
            descriptor = builder.build(
                source_commit=SOURCE,
                kernel_dir=kernel_dir,
                initramfs_dir=initramfs_dir,
                rootfs_dir=independent,
                out_dir=out,
            )
            self.assertEqual((out / "rootfs.tar").read_bytes(), original)
            self.assertEqual((out / "vmlinuz").read_bytes(), kernel)
            self.assertEqual((out / "initrd.gz").read_bytes(), initramfs)
            self.assertEqual(descriptor["$schema"], consumer.SCHEMA)
            self.assertEqual(builder.verify(out), descriptor)
            self.assertGreaterEqual(
                sum(member.issym() for member in consumer._validate_rootfs_archive(out / "rootfs.tar")),
                1,
            )

    def test_build_rejects_independent_rootfs_hash_drift(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            kernel_dir, initramfs_dir, independent, *_ = write_inputs(root)
            provenance_path = independent / "provenance.json"
            provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
            provenance["artifacts"]["rootfs.tar"] = "a" * 64
            provenance_path.write_text(json.dumps(provenance), encoding="utf-8")
            with self.assertRaisesRegex(builder.CandidateError, "authenticated provenance"):
                builder.build(
                    source_commit=SOURCE,
                    kernel_dir=kernel_dir,
                    initramfs_dir=initramfs_dir,
                    rootfs_dir=independent,
                    out_dir=root / "candidate",
                )

    def test_build_rejects_non_owner_or_unverified_owner_profile(self):
        for profile, verified, message in (
            ("minimal", False, "requires owner-development profile"),
            ("owner-development", False, "capability proof is missing"),
        ):
            with self.subTest(profile=profile, verified=verified), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                kernel_dir, initramfs_dir, independent, *_ = write_inputs(root)
                provenance_path = independent / "provenance.json"
                provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
                provenance["profile"] = profile
                provenance["owner_development_capabilities_verified"] = verified
                provenance_path.write_text(json.dumps(provenance), encoding="utf-8")
                with self.assertRaisesRegex(builder.CandidateError, message):
                    builder.build(
                        source_commit=SOURCE,
                        kernel_dir=kernel_dir,
                        initramfs_dir=initramfs_dir,
                        rootfs_dir=independent,
                        out_dir=root / "candidate",
                    )

    def test_build_rejects_independent_rootfs_from_another_commit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            kernel_dir, initramfs_dir, independent, *_ = write_inputs(root)
            provenance_path = independent / "provenance.json"
            provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
            provenance["source_commit"] = "2" * 40
            provenance_path.write_text(json.dumps(provenance), encoding="utf-8")
            with self.assertRaisesRegex(builder.CandidateError, "source commit differs"):
                builder.build(
                    source_commit=SOURCE,
                    kernel_dir=kernel_dir,
                    initramfs_dir=initramfs_dir,
                    rootfs_dir=independent,
                    out_dir=root / "candidate",
                )

    def test_verify_rejects_tampered_rootfs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            kernel_dir, initramfs_dir, independent, *_ = write_inputs(root)
            candidate = root / "candidate"
            builder.build(
                source_commit=SOURCE,
                kernel_dir=kernel_dir,
                initramfs_dir=initramfs_dir,
                rootfs_dir=independent,
                out_dir=candidate,
            )
            with (candidate / "rootfs.tar").open("ab") as handle:
                handle.write(b"tamper")
            with self.assertRaisesRegex(builder.CandidateError, "differs from manifest"):
                builder.verify(candidate)

    @unittest.skipUnless(os.name == "posix", "symlink materialization requires POSIX")
    def test_materialized_rootfs_preserves_safe_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            kernel_dir, initramfs_dir, independent, *_ = write_inputs(root)
            candidate = root / "candidate"
            builder.build(
                source_commit=SOURCE,
                kernel_dir=kernel_dir,
                initramfs_dir=initramfs_dir,
                rootfs_dir=independent,
                out_dir=candidate,
            )
            materialized, reused = consumer.materialize_versioned_rootfs(
                candidate, SOURCE, root / "versions"
            )
            self.assertFalse(reused)
            self.assertTrue((materialized / "bin/sh").is_symlink())
            self.assertEqual(os.readlink(materialized / "bin/sh"), "busybox")
            self.assertEqual(
                (materialized / "bin/sh").resolve(strict=True),
                (materialized / "bin/busybox").resolve(strict=True),
            )


if __name__ == "__main__":
    unittest.main()
