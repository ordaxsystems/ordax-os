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

    def test_dev_console_fds_are_rebound_before_graphical_runtime(self) -> None:
        source = INIT.read_text(encoding="utf-8")
        self.assertIn("rebind_independent_console() {", source)
        self.assertLess(
            source.index("select_development_rootfs\n# Only the real boot PID 1"),
            source.index("rebind_independent_console; then"),
        )
        self.assertLess(
            source.index("rebind_independent_console; then"),
            source.index("start_local_surface fast-graphical"),
        )
        self.assertIn("exec 1>/dev/console 2>&1", source)
        # /proc/self in a forked awk resolves to awk itself: its stdout is
        # the command substitution pipe, not the init process console.
        self.assertIn(
            "read -r console_owner_pid _console_owner_stat </proc/self/stat",
            source,
        )
        self.assertIn('"/proc/$console_owner_pid/fdinfo/1"', source)
        self.assertIn('"/proc/$console_owner_pid/fdinfo/2"', source)

        # The boot authority must be PID 1 as observed by the kernel.
        # A literal dollar or an environment-provided PID cannot pass this.
        self.assertNotIn('if [ "$" -eq 1 ]; then', source)
        self.assertIn(
            "read -r boot_pid _boot_kernel_stat </proc/self/stat || boot_pid=0",
            source,
        )
        self.assertEqual(source.count('if [ "$boot_pid" -eq 1 ]; then'), 1)
        self.assertLess(
            source.index('if [ "$boot_pid" -eq 1 ]; then'),
            source.index("rebind_independent_console; then"),
        )
        check = subprocess.run(
            ["/bin/sh", "-c",
             'boot_pid=0; read -r boot_pid tail </proc/self/stat || boot_pid=0; '
             '[ "$boot_pid" -eq 1 ]'],
            capture_output=True, text=True, timeout=5,
        )
        self.assertNotEqual(check.returncode, 0, "non-PID1 shell must not claim boot authority")

    def test_console_refuses_root_backed_or_unverified_fds(self) -> None:
        source = INIT.read_text(encoding="utf-8")
        token = "rebind_independent_console() {\n"
        self.assertEqual(source.count(token), 1)
        function = token + source.split(token, 1)[1].split("\n}\n", 1)[0] + "\n}\n"
        function = function.replace("/bin/busybox awk", "awk")
        function = function.replace("/proc/self/mountinfo", '"$MOUNTINFO"')
        function = function.replace('"/proc/$console_owner_pid/fdinfo/1"', '"$FDINFO_1"')
        function = function.replace('"/proc/$console_owner_pid/fdinfo/2"', '"$FDINFO_2"')
        # Use the harmless /dev/null character device in a child shell only.
        # Never rebind the CI runner's own stdout or hardware console.
        function = function.replace("/dev/console", "/dev/null")
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            mounts = root / "mountinfo"
            out = root / "fd1"
            err = root / "fd2"
            def probe(*, fd1_id: int, fd2_id: int,
                      dev_fs: str = "0:8", nested: bool = False) -> int:
                extra = (
                    "32 31 0:9 / /dev/console rw - tmpfs console rw\n"
                    if nested else ""
                )
                mounts.write_text(
                    "24 1 8:34 / / rw - ext4 /dev/loop0 rw\n"
                    f"31 24 {dev_fs} / /dev rw - devtmpfs devtmpfs rw\n"
                    + extra,
                    encoding="utf-8",
                )
                out.write_text(f"mnt_id:\t{fd1_id}\n", encoding="ascii")
                err.write_text(f"mnt_id:\t{fd2_id}\n", encoding="ascii")
                result = subprocess.run(
                    ["/bin/sh", "-c", function + "rebind_independent_console"],
                    env={**os.environ, "MOUNTINFO": str(mounts),
                         "FDINFO_1": str(out), "FDINFO_2": str(err)},
                    capture_output=True, timeout=5,
                )
                return result.returncode
            # Same VFS mount ID as /dev: normal devtmpfs handoff.
            self.assertEqual(probe(fd1_id=31, fd2_id=31), 0)
            # Independent nested mount: VFS mount ID differs, filesystem
            # identity is still distinct from the writable ext4 root.
            self.assertEqual(probe(fd1_id=32, fd2_id=32, nested=True), 0)
            # A bind-alias /dev that reuses the root ext4 superblock is unsafe.
            self.assertNotEqual(
                probe(fd1_id=31, fd2_id=31, dev_fs="8:34"), 0,
            )
            self.assertNotEqual(probe(fd1_id=24, fd2_id=31), 0)
            self.assertNotEqual(probe(fd1_id=31, fd2_id=24), 0)
            self.assertNotEqual(probe(fd1_id=31, fd2_id=77), 0)

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
