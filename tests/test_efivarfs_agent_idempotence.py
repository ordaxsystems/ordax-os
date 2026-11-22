#!/usr/bin/env python3
"""Regression for the real efivarfs owner loop, using a test-only BusyBox stub."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
AGENT = ROOT / "system/services/base-update/agent.sh"


def posix_path(path: Path) -> str:
    value = str(path.resolve()).replace("\\", "/")
    return "/" + value[0].lower() + value[2:] if os.name == "nt" else value


def shell_executable() -> str | None:
    if os.name == "nt":
        sh = Path("C:/Program Files/Git/usr/bin/sh.exe")
        return str(sh) if sh.is_file() else None
    return shutil.which("sh")


def extracted_function() -> str:
    source = AGENT.read_text(encoding="utf-8")
    start = source.index("prepare_efivarfs_preflight_evidence() {")
    end = source.index("\n# Readonly Base transfer", start)
    section = source[start:end]
    if section.count("/bin/busybox") < 8:
        raise AssertionError("Unexpected Base agent source")
    return section.replace("/bin/busybox", '"$TEST_SH" "$TEST_BUSYBOX_SH"')


class EfivarfsAgentIdempotenceTests(unittest.TestCase):
    def setUp(self):
        self.shell = shell_executable()
        if self.shell is None:
            self.skipTest("POSIX shell unavailable")
        self.temp = tempfile.TemporaryDirectory(prefix="ordax-efivarfs-regression-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.fake_root = self.root / "runtime-root"
        self.helper = self.fake_root / "srv/ordax-system/services/base-update/efivarfs_preflight.py"
        self.helper.parent.mkdir(parents=True)
        self.helper.write_text("# test fixture only\n", encoding="utf-8")
        self.evidence = self.root / "efivarfs-preflight.json"
        self.probe_json = self.root / "probe.json"
        self.moves = self.root / "move-events.txt"
        self.shim = self.root / "busybox-test.sh"
        self.shim.write_text(
            "#!/bin/sh\n"
            "operation=$1\nshift\n"
            "case \"$operation\" in\n"
            "  chroot)\n"
            "    if [ \"$TEST_PROBE_FAIL\" = 1 ]; then exit 1; fi\n"
            "    cat \"$TEST_PROBE_JSON\";;\n"
            "  mv)\n"
            "    printf 'mv\\n' >> \"$TEST_MOVES\"\n"
            "    exec mv \"$@\";;\n"
            "  *) exec \"$operation\" \"$@\";;\n"
            "esac\n",
            encoding="utf-8",
        )
        self.script = "\n".join((
            "set -eu",
            "PATH=/usr/bin:$PATH; export PATH",
            "log() { printf 'LOG:%s\\n' \"$*\" >&2; }",
            f'RUNTIME_ROOT="{posix_path(self.fake_root)}"',
            f'EFIVARFS_PREFLIGHT_FILE="{posix_path(self.evidence)}"',
            f'EFIVARFS_PREFLIGHT_LOG="{posix_path(self.root / "probe.stderr")}"',
            extracted_function(),
            "prepare_efivarfs_preflight_evidence",
            "",
        ))

    def invoke(self, *, generation=1, valid=True, fail=False) -> str:
        data = {
            "status": "valid" if valid else "invalid",
            "uefi_boot_environment_present": True,
            "writable_mount": True,
            "direct_mountpoint": True,
            "probe_only": True,
            "write_authorized": False,
            "activation_authorized": False,
            "variable_written": False,
            "reboot_requested": False,
            "test_generation": generation,
        }
        self.probe_json.write_text(
            json.dumps(data, sort_keys=True, indent=2) + "\n",
            encoding="utf-8", newline="\n",
        )
        env = dict(os.environ)
        env.update({
            "TEST_SH": "/bin/sh",
            "TEST_BUSYBOX_SH": posix_path(self.shim),
            "TEST_PROBE_JSON": posix_path(self.probe_json),
            "TEST_MOVES": posix_path(self.moves),
            "TEST_PROBE_FAIL": "1" if fail else "0",
        })
        result = subprocess.run(
            [self.shell, "-c", self.script], env=env, text=True,
            capture_output=True, timeout=25,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stderr

    def move_count(self):
        return self.moves.read_text(encoding="utf-8").count("mv\n") if self.moves.exists() else 0

    def test_identical_valid_probe_does_not_rewrite_or_log_again(self):
        first = self.invoke()
        self.assertTrue(self.evidence.is_file())
        self.assertEqual(self.move_count(), 1)
        self.assertEqual(first.count("evidence recorded"), 1)
        original = self.evidence.read_bytes()
        second = self.invoke()
        self.assertEqual(self.evidence.read_bytes(), original)
        self.assertEqual(self.move_count(), 1)
        self.assertNotIn("evidence recorded", second)

    def test_changed_success_is_persisted(self):
        self.invoke(generation=1)
        message = self.invoke(generation=2)
        self.assertEqual(self.move_count(), 2)
        self.assertIn('"test_generation": 2', self.evidence.read_text(encoding="utf-8"))
        self.assertIn("evidence recorded", message)

    def test_invalid_or_failed_probe_removes_previous_success(self):
        self.invoke()
        error = self.invoke(valid=False)
        self.assertFalse(self.evidence.exists())
        self.assertIn("validation failed", error)
        self.invoke()
        error = self.invoke(fail=True)
        self.assertFalse(self.evidence.exists())
        self.assertIn("unavailable", error)

    def test_missing_helper_invalidates_cached_success(self):
        self.invoke()
        self.helper.unlink()
        self.invoke()
        self.assertFalse(self.evidence.exists())


if __name__ == "__main__":
    unittest.main()
