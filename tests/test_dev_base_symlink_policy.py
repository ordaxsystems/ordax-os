from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import hashlib
import json
import os
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
CONSUMER = ROOT / "system" / "services" / "base-update" / "dev_channel.py"
SOURCE = "1" * 40


def load_module(path: Path, name: str):
    spec = spec_from_file_location(name, path)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


consumer = load_module(CONSUMER, "ordax_dev_base_symlink_policy_test")


def add_dir(archive: tarfile.TarFile, name: str) -> None:
    info = tarfile.TarInfo(name)
    info.type = tarfile.DIRTYPE
    info.mode = 0o755
    info.size = 0
    archive.addfile(info)


def add_file(archive: tarfile.TarFile, name: str, payload: bytes, mode: int = 0o755) -> None:
    info = tarfile.TarInfo(name)
    info.type = tarfile.REGTYPE
    info.mode = mode
    info.size = len(payload)
    import io
    archive.addfile(info, io.BytesIO(payload))


def add_symlink(archive: tarfile.TarFile, name: str, target: str, mode: int = 0o777) -> None:
    info = tarfile.TarInfo(name)
    info.type = tarfile.SYMTYPE
    info.mode = mode
    info.linkname = target
    info.size = 0
    archive.addfile(info)


def write_candidate(root: Path, *, sh_target: str = "busybox", extra_link: tuple[str, str] | None = None) -> Path:
    candidate = root / "candidate"
    candidate.mkdir()
    rootfs = candidate / "rootfs.tar"
    required_dirs = set(consumer.REQUIRED_ROOTFS_DIRS)
    for relative in consumer.REQUIRED_ROOTFS_PATHS:
        parent = Path(relative).parent
        while parent != Path("."):
            required_dirs.add(parent.as_posix())
            parent = parent.parent

    with tarfile.open(rootfs, "w", format=tarfile.GNU_FORMAT) as archive:
        for directory in sorted(required_dirs):
            add_dir(archive, directory)
        for relative in sorted(consumer.REQUIRED_ROOTFS_PATHS):
            if relative == "bin/sh":
                add_symlink(archive, relative, sh_target)
            else:
                add_file(archive, relative, f"fixture:{relative}\n".encode())
        if extra_link is not None:
            name, target = extra_link
            parent = Path(name).parent.as_posix()
            if parent not in required_dirs:
                add_dir(archive, parent)
            add_symlink(archive, name, target)

    kernel = b"kernel\n"
    initramfs = b"initramfs\n"
    (candidate / "vmlinuz").write_bytes(kernel)
    (candidate / "initrd.gz").write_bytes(initramfs)
    tag = consumer.candidate_tag(SOURCE)
    prefix = f"https://github.com/{consumer.REPOSITORY}/releases/download/{tag}"
    manifest = {
        "$schema": consumer.SCHEMA,
        "status": "development-candidate",
        "source_repository": consumer.REPOSITORY,
        "source_commit": SOURCE,
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
            "sha256": hashlib.sha256(rootfs.read_bytes()).hexdigest(),
            "size": rootfs.stat().st_size,
        },
    }
    (candidate / "dev-base.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return candidate


class DevBaseSymlinkPolicyTests(unittest.TestCase):
    def test_relative_internal_busybox_links_are_confined(self):
        self.assertEqual(
            consumer._confined_symlink_target("bin/sh", "busybox"),
            "bin/busybox",
        )
        self.assertEqual(
            consumer._confined_symlink_target("usr/bin/awk", "../../bin/busybox"),
            "bin/busybox",
        )

    def test_absolute_and_escaping_symlinks_are_rejected(self):
        for name, target in (
            ("bin/sh", "/bin/busybox"),
            ("bin/sh", "../../escape"),
            ("usr/bin/awk", "../../../escape"),
        ):
            with self.subTest(name=name, target=target):
                with self.assertRaisesRegex(
                    consumer.DevBaseChannelError, "unsafe symlink"
                ):
                    consumer._confined_symlink_target(name, target)

    @unittest.skipUnless(os.name == "posix", "symlink materialization requires POSIX")
    def test_materializes_safe_relative_symlinks_without_flattening(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate = write_candidate(
                root,
                extra_link=("usr/bin/busybox-peer", "../../bin/busybox"),
            )
            members = consumer._validate_rootfs_archive(candidate / "rootfs.tar")
            self.assertGreaterEqual(sum(member.issym() for member in members), 2)

            materialized, reused = consumer.materialize_versioned_rootfs(
                candidate, SOURCE, root / "versions"
            )
            self.assertFalse(reused)
            self.assertTrue((materialized / "bin/sh").is_symlink())
            self.assertEqual(os.readlink(materialized / "bin/sh"), "busybox")
            self.assertTrue((materialized / "usr/bin/busybox-peer").is_symlink())
            self.assertEqual(
                (materialized / "bin/sh").resolve(strict=True),
                (materialized / "bin/busybox").resolve(strict=True),
            )
            consumer.verify_versioned_rootfs(materialized, SOURCE)

    def test_archive_rejects_dangling_internal_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            candidate = write_candidate(
                Path(temporary),
                extra_link=("usr/bin/broken", "../../bin/not-present"),
            )
            with self.assertRaisesRegex(
                consumer.DevBaseChannelError, "dangling symlink"
            ):
                consumer._validate_rootfs_archive(candidate / "rootfs.tar")

    @unittest.skipUnless(os.name == "posix", "symlink tamper test requires POSIX")
    def test_reuse_rejects_symlink_tampering_after_materialization(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate = write_candidate(root)
            materialized, _ = consumer.materialize_versioned_rootfs(
                candidate, SOURCE, root / "versions"
            )
            link = materialized / "bin/sh"
            link.unlink()
            link.symlink_to("../../escape")
            with self.assertRaisesRegex(
                consumer.DevBaseChannelError, "unsafe symlink"
            ):
                consumer.verify_versioned_rootfs(materialized, SOURCE)


if __name__ == "__main__":
    unittest.main()
