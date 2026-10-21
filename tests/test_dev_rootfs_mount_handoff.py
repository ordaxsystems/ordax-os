#!/usr/bin/env python3
"""Verify the real Dev Base rootfs pivot preserves subordinate mounts."""

from __future__ import annotations

import os
import shutil
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
INIT = ROOT / "bootstrap/dev-base/ordax-dev-init"
LOOP_START = "    for shared in state workspace home proc sys dev run; do\n"


class DevRootfsMountHandoffTests(unittest.TestCase):
    @staticmethod
    def _real_mount_loop() -> str:
        source = INIT.read_text(encoding="utf-8")
        assert source.count(LOOP_START) == 1, "missing or duplicate mount owner"
        loop = source.split(LOOP_START, 1)[1].split("\n    done", 1)[0]
        return LOOP_START + loop + "\n    done\n"

    def test_shell_and_pivot_order(self) -> None:
        source = INIT.read_text(encoding="utf-8")
        subprocess.run(["/bin/sh", "-n", str(INIT)], check=True)
        self.assertLess(source.index("ensure_uefi_efivarfs\n"), source.index("select_development_rootfs\n"))
        self.assertLess(
            source.index(LOOP_START),
            source.index('/bin/busybox pivot_root . .ordax-base'),
        )
        self.assertIn('mount -o rbind "/$shared" "$root/$shared"', source)
        self.assertIn('mount -o bind "/$shared" "$root/$shared"', source)

    def _run_mount_loop(self, *, reject: str = "") -> tuple[subprocess.CompletedProcess[str], list[str]]:
        # Exercise the actual shell loop, only replacing mount(2) with a
        # recorder; no mount namespace, host files or EFI variables touched.
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "candidate-rootfs"
            root.mkdir()
            calls = Path(temp) / "mount-calls"
            loop = self._real_mount_loop().replace(
                "/bin/busybox mount ", "record_mount "
            )
            script = (
                'record_mount() {\n'
                '  printf "%s\\n" "$*" >> "$LOG"\n'
                '  [ "$3" != "$REJECT" ]\n'
                '}\n'
                'bind_shared() {\n'
                + loop
                + '}\n'
                + 'bind_shared\n'
            )
            env = os.environ.copy()
            env.update({"root": str(root), "LOG": str(calls), "REJECT": reject})
            result = subprocess.run(
                ["/bin/sh", "-c", script],
                env=env,
                check=False,
                capture_output=True,
                text=True,
            )
            recorded = calls.read_text(encoding="utf-8").splitlines() if calls.exists() else []
            return result, recorded

    def test_efi_graphics_and_devices_keep_nested_mounts(self) -> None:
        result, records = self._run_mount_loop()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(records), 7)
        for shared in ("proc", "sys", "dev", "run"):
            with self.subTest(shared=shared):
                self.assertTrue(
                    any(line.startswith(f"-o rbind /{shared} ") for line in records),
                    records,
                )
                self.assertFalse(
                    any(line.startswith(f"-o bind /{shared} ") for line in records),
                    records,
                )

    def test_durable_directories_stay_nonrecursive(self) -> None:
        result, records = self._run_mount_loop()
        self.assertEqual(result.returncode, 0, result.stderr)
        for shared in ("state", "workspace", "home"):
            with self.subTest(shared=shared):
                self.assertTrue(
                    any(line.startswith(f"-o bind /{shared} ") for line in records),
                    records,
                )

    def test_failed_recursive_mount_blocks_rootfs_pivot(self) -> None:
        result, records = self._run_mount_loop(reject="/sys")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertTrue(any(line.startswith("-o rbind /sys ") for line in records))
        self.assertFalse(any(" /dev " in line for line in records))
        self.assertFalse(any(" /run " in line for line in records))


    def test_real_linux_recursive_bind_keeps_nested_tmpfs_when_privileged(self) -> None:
        """Prove the actual kernel mount distinction in an isolated namespace.

        A CI runner lacking CAP_SYS_ADMIN skips only this integration check.
        No existing device, filesystem, USB partition or EFI variable is used.
        """
        if shutil.which("unshare") is None:
            self.skipTest("mount namespaces unavailable on this runner")
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source"
            ordinary = Path(temp) / "ordinary-bind"
            recursive = Path(temp) / "recursive-bind"
            for path in (source / "nested", ordinary, recursive):
                path.mkdir(parents=True)

            script = (
                'set -eu\n'
                '/bin/busybox mount -t tmpfs tmpfs "$SOURCE/nested"\n'
                'printf "nested-proof\\n" > "$SOURCE/nested/proof"\n'
                '/bin/busybox mount -o bind "$SOURCE" "$ORDINARY"\n'
                '[ ! -e "$ORDINARY/nested/proof" ] || exit 95\n'
                '/bin/busybox mount -o rbind "$SOURCE" "$RECURSIVE"\n'
                '[ -f "$RECURSIVE/nested/proof" ] || exit 96\n'
                '/bin/busybox grep -q nested-proof "$RECURSIVE/nested/proof"\n'
            )
            env = os.environ.copy()
            env.update({
                "SOURCE": str(source),
                "ORDINARY": str(ordinary),
                "RECURSIVE": str(recursive),
            })
            result = subprocess.run(
                ["unshare", "-m", "--propagation", "private", "/bin/sh", "-c", script],
                env=env,
                check=False,
                capture_output=True,
                text=True,
            )
            if result.returncode != 0 and (
                "unshare failed: Operation not permitted" in result.stderr
                or "unshare: unshare failed" in result.stderr
                and "not permitted" in result.stderr.lower()
            ):
                self.skipTest("runner does not permit mount namespaces")
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
