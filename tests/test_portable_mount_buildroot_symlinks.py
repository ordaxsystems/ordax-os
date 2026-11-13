"""Exercise the real portable EROFS executable verifier against symlink attacks.

Standard Buildroot exposes /usr/bin/python3 as an in-root symlink; verified
immutable media must accept it without permitting path traversal or unsafe
link targets. Compile the canonical C source, not a Python reimplementation.
"""
from __future__ import annotations

from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(
    sys.platform.startswith("linux") and shutil.which("cc"),
    "portable C mount verifier requires the Linux host compiler",
)
class PortableMountBuildrootSymlinkTests(unittest.TestCase):
    def test_verified_runtime_allows_in_root_links_only(self):
        with tempfile.TemporaryDirectory(prefix="ordax-erofs-path-") as temp:
            work = Path(temp)
            source = work / "probe.c"
            binary = work / "probe"
            source.write_text(
                '#define main ordax_portable_mount_original_main\n'
                '#include "bootstrap/initramfs/portable_mount.c"\n'
                '#undef main\n'
                'int main(int argc, char **argv) {\n'
                '  if (argc != 3) return 2;\n'
                '  return safe_executable_below(argv[1], argv[2]) ? 0 : 1;\n'
                '}\n',
                encoding="utf-8",
            )
            subprocess.run(
                ["cc", "-std=gnu11", "-O2", "-Wall", "-Wextra", "-Werror",
                 "-I", str(ROOT), "-o", str(binary), str(source)],
                check=True,
                capture_output=True,
                text=True,
            )

            image = work / "sealed-runtime"
            programs = image / "usr" / "bin"
            programs.mkdir(parents=True)
            python = programs / "python3.14"
            python.write_bytes(b"verified-buildroot-python")
            python.chmod(0o755)
            (programs / "python3").symlink_to("python3.14")
            (programs / "absolute-in-image").symlink_to("/usr/bin/python3.14")

            external = work / "external-executable"
            external.write_bytes(b"untrusted-external-file")
            external.chmod(0o755)
            (programs / "escape").symlink_to("../../../external-executable")
            (programs / "cycle-one").symlink_to("cycle-two")
            (programs / "cycle-two").symlink_to("cycle-one")
            plain = programs / "data"
            plain.write_text("not executable", encoding="utf-8")
            plain.chmod(0o644)
            (programs / "directory").mkdir()

            def accepted(relative: str) -> bool:
                result = subprocess.run(
                    [str(binary), str(image), relative],
                    capture_output=True, text=True, check=False,
                )
                self.assertIn(result.returncode, (0, 1), result.stderr)
                return result.returncode == 0

            for name in ("usr/bin/python3.14", "usr/bin/python3",
                         "usr/bin/absolute-in-image"):
                with self.subTest(accepted=name):
                    self.assertTrue(accepted(name))

            for name in ("usr/bin/escape", "usr/bin/cycle-one",
                         "usr/bin/data", "usr/bin/directory", "usr/bin/missing",
                         "../external-executable", "/usr/bin/python3.14"):
                with self.subTest(rejected=name):
                    self.assertFalse(accepted(name))


if __name__ == "__main__":
    unittest.main()
