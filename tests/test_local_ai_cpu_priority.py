#!/usr/bin/env python3
"""Verify the single optional CPU-priority wrapper used by both Native profiles."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "system/services/local-ai/run-low-priority.sh"
STABLE = ROOT / "bootstrap/stable-base/ordax-stable-init"
OWNER = ROOT / "system/services/local-ai/owner-dev-runtime.sh"


@unittest.skipUnless(Path("/bin/sh").exists(), "POSIX host only")
class LocalAiCpuPriorityTests(unittest.TestCase):
    def run_wrapper(self, with_nice: bool):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            marker = folder / "nice-called"
            if with_nice:
                fake_nice = folder / "nice"
                fake_nice.write_text(
                    "#!/bin/sh\n"
                    'printf "%s\\n" "$1:$2" >"$ORDAX_TEST_NICE_MARKER"\n'
                    'shift 2\n'
                    'exec "$@"\n',
                    encoding="utf-8",
                )
                fake_nice.chmod(0o755)
            env = {**os.environ, "PATH": tmp, "ORDAX_TEST_NICE_MARKER": str(marker)}
            completed = subprocess.run(
                ["/bin/sh", str(WRAPPER), "/bin/sh", "-c", "printf healthy"],
                capture_output=True,
                text=True,
                check=True,
                env=env,
            )
            return completed.stdout, marker.read_text() if marker.exists() else None

    def test_both_native_profiles_use_the_same_helper(self):
        stable = STABLE.read_text(encoding="utf-8")
        owner = OWNER.read_text(encoding="utf-8")
        self.assertIn(
            "/bin/sh /system/services/local-ai/run-low-priority.sh", stable
        )
        self.assertIn(
            '/bin/sh "$WORKTREE/system/services/local-ai/run-low-priority.sh"', owner
        )
        self.assertEqual(stable.count("run-low-priority.sh"), 1)
        self.assertEqual(owner.count("run-low-priority.sh"), 1)

    def test_nice_is_used_when_present_and_pid_is_exec_owned(self):
        output, marker = self.run_wrapper(True)
        self.assertEqual(output, "healthy")
        self.assertEqual(marker, "-n:10\n")
        self.assertIn('exec nice -n 10 "$@"', WRAPPER.read_text(encoding="utf-8"))

    def test_absent_nice_does_not_block_inference(self):
        output, marker = self.run_wrapper(False)
        self.assertEqual(output, "healthy")
        self.assertIsNone(marker)

    def test_missing_backend_command_is_rejected(self):
        p = subprocess.run(["/bin/sh", str(WRAPPER)], capture_output=True)
        self.assertNotEqual(p.returncode, 0)


if __name__ == "__main__":
    unittest.main()
