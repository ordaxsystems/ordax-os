#!/usr/bin/env python3
"""Verify the real Dev Base rootfs pivot preserves subordinate mounts."""

from __future__ import annotations

import os
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


if __name__ == "__main__":
    unittest.main()
