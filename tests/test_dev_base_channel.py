from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import hashlib
import os
import tarfile
import json
import tempfile
import unittest
import urllib.error


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


class FakeResponse:
    def __init__(self, url: str, payload: bytes, status: int = 200):
        self._url = url
        self._payload = payload
        self._offset = 0
        self.status = status

    def geturl(self):
        return self._url

    def read(self, limit: int):
        chunk = self._payload[self._offset : self._offset + limit]
        self._offset += len(chunk)
        return chunk

    def close(self):
        pass


def write_rootfs_fixture(root: Path, source_commit: str = SOURCE) -> Path:
    rootfs_dir = root / "dev-rootfs"
    rootfs = rootfs_dir / "rootfs"
    rootfs.mkdir(parents=True)

    payload_total = 0
    for relative in builder.REQUIRED_ROOTFS_PATHS:
        target = rootfs / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        payload = f"fixture:{relative}\n".encode("utf-8")
        target.write_bytes(payload)
        target.chmod(0o755)
        payload_total += len(payload)

    for relative in builder.REQUIRED_ROOTFS_DIRS:
        (rootfs / relative).mkdir(parents=True, exist_ok=True)

    (rootfs / "etc").mkdir(parents=True, exist_ok=True)
    config = rootfs / "etc" / "ordax-base"
    config.write_text("development-rootfs\n", encoding="utf-8")
    config.chmod(0o644)
    payload_total += config.stat().st_size

    (rootfs_dir / "provenance.json").write_text(
        json.dumps(
            {
                "$schema": "prototype-ordax.dev-base/1",
                "source_commit": source_commit,
                "unique_regular_bytes": payload_total,
                "git_client_preseeded": True,
                "network_preseeded": True,
            }
        ),
        encoding="utf-8",
    )
    return rootfs_dir


def write_provenance_fixture(root: Path, source_commit: str = SOURCE):
    kernel_dir = root / "kernel"
    initramfs_dir = root / "initramfs"
    kernel_dir.mkdir()
    initramfs_dir.mkdir()

    kernel_name = "vmlinuz-6.6.52"
    kernel = b"kernel-candidate-bytes\n"
    initramfs = b"initramfs-candidate-bytes\n"
    (kernel_dir / kernel_name).write_bytes(kernel)
    (initramfs_dir / "initramfs.cpio.gz").write_bytes(initramfs)

    (kernel_dir / "kernel-provenance.json").write_text(
        json.dumps(
            {
                "$schema": "prototype-ordax.kernel-provenance/1",
                "source_commit": source_commit,
                "artifacts": {
                    kernel_name: hashlib.sha256(kernel).hexdigest(),
                    "kernel-modules-6.6.52.tar": "a" * 64,
                },
            }
        ),
        encoding="utf-8",
    )
    (initramfs_dir / "initramfs-provenance.json").write_text(
        json.dumps(
            {
                "$schema": "prototype-ordax.initramfs-provenance/1",
                "source_commit": source_commit,
                "artifacts": {
                    "initramfs.cpio.gz": hashlib.sha256(initramfs).hexdigest(),
                    "busybox.config": "b" * 64,
                },
            }
        ),
        encoding="utf-8",
    )
    rootfs_dir = write_rootfs_fixture(root, source_commit)
    return kernel_dir, initramfs_dir, rootfs_dir, kernel, initramfs


class DevBaseProducerTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "posix", "requires POSIX executable bits")
    def test_full_build_accepts_flattened_apk_hardlinks_and_pins_unique_provenance(self):
        # Reproduce the real CI failure: 390 references to 1 MiB make the
        # pathname-sum exceed 320 MiB while only 1 MiB of payload is stored.
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            kernel_dir, initramfs_dir, rootfs_dir, _kernel, _initramfs = (
                write_provenance_fixture(root)
            )
            tree = rootfs_dir / "rootfs"
            library = tree / "usr/lib"
            library.mkdir(parents=True)
            original = library / "shared.bin"
            original.write_bytes(b"X" * (1024 * 1024))
            for index in range(390):
                os.link(original, library / f"alias-{index:04d}.bin")
            provenance_path = rootfs_dir / "provenance.json"
            provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
            provenance["unique_regular_bytes"] += 1024 * 1024
            provenance_path.write_text(json.dumps(provenance), encoding="utf-8")
            self.assertGreater(
                390 * (1024 * 1024), builder.MAX_ROOTFS_EXPANDED_BYTES
            )
            self.assertEqual(builder.validate_rootfs_source(rootfs_dir, SOURCE), tree)
            out = root / "candidate"
            builder.build(
                source_commit=SOURCE,
                kernel_dir=kernel_dir,
                initramfs_dir=initramfs_dir,
                rootfs_dir=rootfs_dir,
                out_dir=out,
            )
            self.assertLess((out / "rootfs.tar").stat().st_size, 8 * 1024 * 1024)
            self.assertEqual(builder.verify(out)["source_commit"], SOURCE)
            self.assertEqual(
                sum(m.islnk() for m in consumer._validate_rootfs_archive(out / "rootfs.tar")),
                390,
            )

    @unittest.skipUnless(os.name == "posix", "requires POSIX executable bits")
    def test_rejects_dev_base_provenance_size_drift_without_relaxing_limits(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            rootfs_dir = write_rootfs_fixture(root)
            provenance_path = rootfs_dir / "provenance.json"
            provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
            provenance["unique_regular_bytes"] += 1
            provenance_path.write_text(json.dumps(provenance), encoding="utf-8")
            with self.assertRaisesRegex(
                builder.CandidateError, "unique bytes differ from provenance"
            ):
                builder.validate_rootfs_source(rootfs_dir, SOURCE)

    def test_large_hardlink_fanout_is_serialized_once_and_verified_by_both_sides(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            tree = root / "rootfs"
            for relative in builder.REQUIRED_ROOTFS_PATHS:
                item = tree / relative
                item.parent.mkdir(parents=True, exist_ok=True)
                item.write_bytes(b"executable fixture\\n")
                item.chmod(0o755)
            for relative in builder.REQUIRED_ROOTFS_DIRS:
                (tree / relative).mkdir(parents=True, exist_ok=True)
            library = tree / "usr/lib"
            library.mkdir(parents=True)
            original = library / "shared.bin"
            original.write_bytes(b"X" * (1024 * 1024))
            original.chmod(0o644)
            for index in range(390):
                os.link(original, library / f"alias-{index:04d}.bin")
            self.assertGreater(390 * (1024 * 1024), builder.MAX_ROOTFS_EXPANDED_BYTES)
            archive = root / "rootfs.tar"
            builder.build_rootfs_tar(tree, archive)
            builder.verify_rootfs_tar(archive)
            members = consumer._validate_rootfs_archive(archive)
            self.assertEqual(sum(member.islnk() for member in members), 390)
            self.assertLess(archive.stat().st_size, 8 * 1024 * 1024)
            self.assertLess(
                sum(member.size for member in members if member.isreg()),
                2 * 1024 * 1024,
            )

    def test_rejects_unsafe_forward_or_cross_mode_hardlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            tree = root / "rootfs"
            for relative in builder.REQUIRED_ROOTFS_PATHS:
                item = tree / relative
                item.parent.mkdir(parents=True, exist_ok=True)
                item.write_bytes(b"fixture")
                item.chmod(0o755)
            for relative in builder.REQUIRED_ROOTFS_DIRS:
                (tree / relative).mkdir(parents=True, exist_ok=True)
            for target, mode in [
                ("../../escape", 0o755),
                ("future/not-yet-seen", 0o755),
                ("bin/sh", 0o644),
            ]:
                archive = root / "rootfs.tar"
                builder.build_rootfs_tar(tree, archive)
                with tarfile.open(archive, "a") as output:
                    link = tarfile.TarInfo("zzz-unsafe")
                    link.type = tarfile.LNKTYPE
                    link.linkname = target
                    link.mode = mode
                    link.size = 0
                    output.addfile(link)
                with self.assertRaisesRegex(builder.CandidateError, "unsafe hardlink"):
                    builder.verify_rootfs_tar(archive)
                with self.assertRaisesRegex(consumer.DevBaseChannelError, "unsafe hardlink"):
                    consumer._validate_rootfs_archive(archive)

    @unittest.skipUnless(os.name == "posix", "hardlink materialization requires POSIX fsync")
    def test_materialize_safe_internal_hardlinks_preserves_inode(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            kernel_dir, initramfs_dir, rootfs_dir, _kernel, _initramfs = (
                write_provenance_fixture(root)
            )
            tree = rootfs_dir / "rootfs"
            original = tree / "bin/busybox"
            os.link(original, tree / "bin/busybox-peer")
            candidate = root / "candidate"
            builder.build(
                source_commit=SOURCE,
                kernel_dir=kernel_dir,
                initramfs_dir=initramfs_dir,
                rootfs_dir=rootfs_dir,
                out_dir=candidate,
            )
            materialized, reused = consumer.materialize_versioned_rootfs(
                candidate, SOURCE, root / "versions"
            )
            self.assertFalse(reused)
            self.assertEqual(
                (materialized / "bin/busybox").stat().st_ino,
                (materialized / "bin/busybox-peer").stat().st_ino,
            )
            self.assertEqual(
                (materialized / "bin/busybox").read_bytes(),
                (materialized / "bin/busybox-peer").read_bytes(),
            )

    def test_build_binds_exact_commit_and_standard_asset_names(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            kernel_dir, initramfs_dir, rootfs_dir, kernel, initramfs = (
                write_provenance_fixture(root)
            )
            out = root / "out"

            descriptor = builder.build(
                source_commit=SOURCE,
                kernel_dir=kernel_dir,
                initramfs_dir=initramfs_dir,
                rootfs_dir=rootfs_dir,
                out_dir=out,
            )

            self.assertEqual(
                descriptor["$schema"],
                "prototype-ordax.dev-base-candidate/3",
            )
            self.assertEqual(descriptor["source_commit"], SOURCE)
            self.assertEqual(descriptor["tag"], f"ordax-dev-base-{SOURCE}")
            self.assertEqual(descriptor["activation"], "inactive-slot-next-boot")
            self.assertEqual(
                descriptor["rootfs_activation"],
                "slot-coupled-one-shot-health-gated",
            )
            self.assertFalse(descriptor["manual_usb_rewrite_required"])
            self.assertEqual(descriptor["kernel"]["name"], "vmlinuz")
            self.assertEqual(descriptor["initramfs"]["name"], "initrd.gz")
            self.assertEqual(descriptor["rootfs"]["name"], "rootfs.tar")
            self.assertEqual((out / "vmlinuz").read_bytes(), kernel)
            self.assertEqual((out / "initrd.gz").read_bytes(), initramfs)
            self.assertTrue((out / "rootfs.tar").is_file())
            self.assertEqual(builder.verify(out), descriptor)

    def test_rootfs_tar_is_byte_deterministic(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            kernel_dir, initramfs_dir, rootfs_dir, _kernel, _initramfs = (
                write_provenance_fixture(root)
            )
            first = root / "first"
            second = root / "second"

            builder.build(
                source_commit=SOURCE,
                kernel_dir=kernel_dir,
                initramfs_dir=initramfs_dir,
                rootfs_dir=rootfs_dir,
                out_dir=first,
            )
            builder.build(
                source_commit=SOURCE,
                kernel_dir=kernel_dir,
                initramfs_dir=initramfs_dir,
                rootfs_dir=rootfs_dir,
                out_dir=second,
            )

            self.assertEqual(
                (first / "rootfs.tar").read_bytes(),
                (second / "rootfs.tar").read_bytes(),
            )

    def test_build_rejects_rootfs_provenance_from_another_commit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            kernel_dir, initramfs_dir, _rootfs_dir, _kernel, _initramfs = (
                write_provenance_fixture(root)
            )
            wrong_rootfs = root / "wrong-rootfs-source"
            write_rootfs_fixture(wrong_rootfs, source_commit="2" * 40)

            with self.assertRaisesRegex(
                builder.CandidateError,
                "rootfs provenance source commit",
            ):
                builder.build(
                    source_commit=SOURCE,
                    kernel_dir=kernel_dir,
                    initramfs_dir=initramfs_dir,
                    rootfs_dir=wrong_rootfs / "dev-rootfs",
                    out_dir=root / "out",
                )


class DevBaseConsumerTests(unittest.TestCase):
    def descriptor(
        self,
        kernel: bytes,
        initramfs: bytes,
        rootfs: bytes,
        source_commit: str = SOURCE,
    ):
        tag = f"ordax-dev-base-{source_commit}"
        prefix = (
            "https://github.com/ordaxsystems/ordax-os/"
            f"releases/download/{tag}"
        )
        return {
            "$schema": consumer.SCHEMA,
            "status": "development-candidate",
            "source_repository": consumer.REPOSITORY,
            "source_commit": source_commit,
            "tag": tag,
            "activation": "inactive-slot-next-boot",
            "rootfs_activation": "slot-coupled-one-shot-health-gated",
            "manual_usb_rewrite_required": False,
            "kernel": {
                "name": "vmlinuz",
                "url": f"{prefix}/vmlinuz",
                "sha256": hashlib.sha256(kernel).hexdigest(),
                "size": len(kernel),
            },
            "initramfs": {
                "name": "initrd.gz",
                "url": f"{prefix}/initrd.gz",
                "sha256": hashlib.sha256(initramfs).hexdigest(),
                "size": len(initramfs),
            },
            "rootfs": {
                "name": "rootfs.tar",
                "url": f"{prefix}/rootfs.tar",
                "sha256": hashlib.sha256(rootfs).hexdigest(),
                "size": len(rootfs),
            },
        }

    def opener_for(
        self,
        manifest: dict,
        kernel: bytes,
        initramfs: bytes,
        rootfs: bytes,
    ):
        manifest_bytes = (
            json.dumps(manifest, indent=2, sort_keys=True) + "\n"
        ).encode("utf-8")
        payloads = {
            consumer.manifest_url(SOURCE): manifest_bytes,
            manifest["kernel"]["url"]: kernel,
            manifest["initramfs"]["url"]: initramfs,
            manifest["rootfs"]["url"]: rootfs,
        }

        def open_url(url, timeout):
            expected_timeout = (
                consumer.ROOTFS_DOWNLOAD_TIMEOUT_SECONDS
                if url == manifest["rootfs"]["url"]
                else consumer.DOWNLOAD_TIMEOUT_SECONDS
            )
            self.assertEqual(timeout, expected_timeout)
            return FakeResponse(url, payloads[url])

        return open_url

    def test_acquire_materializes_exact_candidate_and_reuses_it_offline(self):
        kernel = b"kernel-dev-channel\n"
        initramfs = b"initramfs-dev-channel\n"
        rootfs = b"rootfs-tar-dev-channel\n"
        manifest = self.descriptor(kernel, initramfs, rootfs)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target, reused = consumer.acquire(
                SOURCE,
                root,
                opener=self.opener_for(manifest, kernel, initramfs, rootfs),
            )
            self.assertFalse(reused)
            self.assertEqual(target, root / SOURCE)
            self.assertEqual((target / "vmlinuz").read_bytes(), kernel)
            self.assertEqual((target / "initrd.gz").read_bytes(), initramfs)
            self.assertEqual((target / "rootfs.tar").read_bytes(), rootfs)
            self.assertEqual(
                consumer.verify_materialized(target, SOURCE)["source_commit"],
                SOURCE,
            )

            def no_network(*_args, **_kwargs):
                raise AssertionError("reused candidate unexpectedly used network")

            same, reused = consumer.acquire(SOURCE, root, opener=no_network)
            self.assertTrue(reused)
            self.assertEqual(same, target)

    def test_acquire_rejects_manifest_for_another_commit(self):
        kernel = b"kernel\n"
        initramfs = b"initramfs\n"
        rootfs = b"rootfs\n"
        wrong = self.descriptor(
            kernel,
            initramfs,
            rootfs,
            source_commit="2" * 40,
        )
        manifest_bytes = json.dumps(wrong).encode("utf-8")

        def opener(url, timeout):
            return FakeResponse(url, manifest_bytes)

        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(
                consumer.DevBaseChannelError,
                "commit does not match",
            ):
                consumer.acquire(SOURCE, Path(temporary), opener=opener)

    def test_acquire_rejects_tampered_kernel(self):
        kernel = b"expected-kernel\n"
        initramfs = b"expected-initramfs\n"
        rootfs = b"expected-rootfs\n"
        manifest = self.descriptor(kernel, initramfs, rootfs)
        manifest_bytes = json.dumps(manifest).encode("utf-8")
        payloads = {
            consumer.manifest_url(SOURCE): manifest_bytes,
            manifest["kernel"]["url"]: b"tampered-kernel\n",
            manifest["initramfs"]["url"]: initramfs,
            manifest["rootfs"]["url"]: rootfs,
        }

        def opener(url, timeout):
            return FakeResponse(url, payloads[url])

        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(
                consumer.DevBaseChannelError,
                "kernel (size|SHA-256) mismatch",
            ):
                consumer.acquire(SOURCE, Path(temporary), opener=opener)

    def test_acquire_rejects_tampered_rootfs(self):
        kernel = b"expected-kernel\n"
        initramfs = b"expected-initramfs\n"
        rootfs = b"expected-rootfs\n"
        manifest = self.descriptor(kernel, initramfs, rootfs)
        manifest_bytes = json.dumps(manifest).encode("utf-8")
        payloads = {
            consumer.manifest_url(SOURCE): manifest_bytes,
            manifest["kernel"]["url"]: kernel,
            manifest["initramfs"]["url"]: initramfs,
            manifest["rootfs"]["url"]: b"tampered-rootfs\n",
        }

        def opener(url, timeout):
            return FakeResponse(url, payloads[url])

        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(
                consumer.DevBaseChannelError,
                "rootfs (size|SHA-256) mismatch",
            ):
                consumer.acquire(SOURCE, Path(temporary), opener=opener)

    def test_materialize_versioned_rootfs_is_atomic_and_reusable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            kernel_dir, initramfs_dir, rootfs_dir, _kernel, _initramfs = (
                write_provenance_fixture(root)
            )
            candidate = root / "candidate"
            builder.build(
                source_commit=SOURCE,
                kernel_dir=kernel_dir,
                initramfs_dir=initramfs_dir,
                rootfs_dir=rootfs_dir,
                out_dir=candidate,
            )

            versions = root / "versions"
            target, reused = consumer.materialize_versioned_rootfs(
                candidate,
                SOURCE,
                versions,
            )
            self.assertFalse(reused)
            self.assertEqual(target, versions / SOURCE)
            self.assertEqual(
                (target / consumer.ROOTFS_MARKER).read_text(encoding="ascii").strip(),
                SOURCE,
            )
            for relative in consumer.REQUIRED_ROOTFS_PATHS:
                self.assertTrue((target / relative).is_file())
            self.assertTrue((target / ".ordax-base").is_dir())

            same, reused = consumer.materialize_versioned_rootfs(
                candidate,
                SOURCE,
                versions,
            )
            self.assertTrue(reused)
            self.assertEqual(same, target)

    def test_missing_exact_commit_candidate_is_retryable(self):
        def opener(url, timeout):
            raise urllib.error.HTTPError(url, 404, "missing", {}, None)

        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(consumer.DevBaseCandidateUnavailable):
                consumer.acquire(SOURCE, Path(temporary), opener=opener)


if __name__ == "__main__":
    unittest.main()
