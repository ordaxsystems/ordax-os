"""Fast proof for the Independent Base product-facing rootfs export."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
EXPORTER = ROOT / "bootstrap/independent-base/post-image.sh"
POST_BUILD = ROOT / "bootstrap/independent-base/post-build.sh"
DEFCONFIG = ROOT / "bootstrap/independent-base/configs/ordax_minimal_defconfig"
RUNTIME_DEV_LINKS = {
    "fd": "../proc/self/fd",
    "stdin": "../proc/self/fd/0",
    "stdout": "../proc/self/fd/1",
    "stderr": "../proc/self/fd/2",
}


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def executable_fixture(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    path.chmod(0o755)


class IndependentRootfsExportTests(unittest.TestCase):
    def _minimal_post_build_target(self, root: Path) -> Path:
        target = root / "target"
        (target / "dev").mkdir(parents=True)
        executable_fixture(target / "sbin/modprobe")
        executable_fixture(target / "sbin/ip")
        for name, linkname in RUNTIME_DEV_LINKS.items():
            os.symlink(linkname, target / "dev" / name)
        return target

    def test_exporter_is_executable_and_bound_to_buildroot_post_image(self):
        mode = EXPORTER.stat().st_mode
        self.assertTrue(stat.S_ISREG(mode))
        self.assertTrue(mode & stat.S_IXUSR)
        config = DEFCONFIG.read_text(encoding="utf-8")
        self.assertEqual(
            config.splitlines().count(
                'BR2_ROOTFS_POST_IMAGE_SCRIPT="$(BR2_EXTERNAL_ORDAX_MINIMAL_PATH)/post-image.sh"'
            ),
            1,
        )

    def test_post_build_removes_only_runtime_owned_devtmpfs_shortcuts(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = self._minimal_post_build_target(Path(tmp))
            result = subprocess.run(
                [str(POST_BUILD), str(target), "minimal"],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            for name in RUNTIME_DEV_LINKS:
                self.assertFalse((target / "dev" / name).exists())
                self.assertFalse((target / "dev" / name).is_symlink())
            self.assertTrue((target / "dev").is_dir())

    def test_post_build_fails_closed_if_runtime_dev_link_drifted(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = self._minimal_post_build_target(Path(tmp))
            (target / "dev/fd").unlink()
            os.symlink("../tmp/not-procfs", target / "dev/fd")
            result = subprocess.run(
                [str(POST_BUILD), str(target), "minimal"],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Unexpected Independent Base /dev runtime link", result.stderr)
            self.assertTrue((target / "dev/fd").is_symlink())

    def test_export_is_canonical_symlink_preserving_and_deterministic(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "target"
            images = root / "images"
            images.mkdir()
            (target / "bin").mkdir(parents=True)
            (target / "etc/ordax").mkdir(parents=True)
            (target / "bin/busybox").write_bytes(b"busybox-fixture\n")
            (target / "bin/busybox").chmod(0o755)
            os.symlink("busybox", target / "bin/sh")
            (target / "etc/ordax/fixture").write_text("ok\n", encoding="utf-8")

            archive = images / "rootfs.tar"
            archive.write_bytes(b"placeholder")
            env = os.environ.copy()
            env["TARGET_DIR"] = str(target)

            def export_and_read():
                result = subprocess.run(
                    [str(EXPORTER), str(images)],
                    cwd=ROOT,
                    env=env,
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                archive_hash = digest(archive)
                with tarfile.open(archive, "r:") as handle:
                    members = handle.getmembers()
                return archive_hash, members

            first_hash, members = export_and_read()
            names = [member.name for member in members]
            self.assertEqual(names, sorted(names))
            self.assertEqual(len(names), len(set(names)))
            self.assertNotIn(".", names)
            for name in names:
                path = PurePosixPath(name)
                self.assertFalse(path.is_absolute())
                self.assertEqual(path.as_posix(), name)
                self.assertTrue(all(part not in (".", "..") for part in path.parts))
            for member in members:
                self.assertEqual(member.uid, 0)
                self.assertEqual(member.gid, 0)
                self.assertEqual(member.mtime, 0)

            by_name = {member.name: member for member in members}
            self.assertTrue(by_name["bin/sh"].issym())
            self.assertEqual(by_name["bin/sh"].linkname, "busybox")
            self.assertTrue(by_name["bin/busybox"].isreg())

            second_hash, second_members = export_and_read()
            self.assertEqual(second_hash, first_hash)
            self.assertEqual(
                [(m.name, m.type, m.linkname, m.mode, m.size) for m in second_members],
                [(m.name, m.type, m.linkname, m.mode, m.size) for m in members],
            )


if __name__ == "__main__":
    unittest.main()
