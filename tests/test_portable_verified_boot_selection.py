#!/usr/bin/env python3
"""Execute the PID1 selector with controlled verifier/state boundary failures."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
INIT = ROOT / "bootstrap/initramfs/portable_init.sh"
CURRENT = "1" * 40
KNOWN_GOOD = "0" * 40
CANDIDATE = "2" * 40
RUNTIME = "a" * 64
AI_RUNTIME = "b" * 64


def function(text: str, name: str) -> str:
    return name + "() {" + text.split(name + "() {", 1)[1].split("\n}", 1)[0] + "\n}\n"


class PortableVerifiedBootSelectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shell = shutil.which("sh")
        if cls.shell is None:
            raise unittest.SkipTest("POSIX shell is unavailable")

    def select(
        self,
        selection=f"current {CURRENT}",
        valid=f"{KNOWN_GOOD}:3",
        known_good=KNOWN_GOOD,
        after_rollback=f"current {CURRENT}",
        rollback_status="0",
    ):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            helper = directory / "state-helper"
            helper.write_text(
                '#!/bin/sh\n'
                'printf "%s\\n" "$*" >>"$AUDIT_LOG"\n'
                'case "$1" in\n'
                '  select-boot)\n'
                '    if [ -f "$ROLLED_BACK" ]; then\n'
                '      printf "%s\\n" "$AFTER_ROLLBACK"\n'
                '    else printf "%s\\n" "$FIRST_SELECTION"; fi ;;\n'
                '  resolve) [ -n "$KNOWN_GOOD" ] || exit 4\n'
                '    printf "%s\\n" "$KNOWN_GOOD" ;;\n'
                '  rollback) [ "$ROLLBACK_STATUS" = 0 ] || exit "$ROLLBACK_STATUS"\n'
                '    : >"$ROLLED_BACK" ;;\n'
                '  *) exit 4 ;;\n'
                'esac\n',
                encoding="utf-8",
            )
            agent = directory / "release-agent"
            agent.write_text(
                '#!/bin/sh\n'
                'command=$1\n'
                'printf "%s\\n" "$*" >>"$AUDIT_LOG"\n'
                'shift\n'
                'while [ "$#" -gt 0 ]; do\n'
                '  if [ "$1" = --expected-commit ]; then commit=$2; fi\n'
                '  shift\n'
                'done\n'
                'case "$command" in\n'
                '  verify-portable-v4-exact) schema=4 ;;\n'
                '  verify-portable-v3-exact) schema=3 ;;\n'
                '  verify-portable-exact) schema=2 ;;\n'
                '  *) exit 4 ;;\n'
                'esac\n'
                'case " $VALID_RELEASES " in\n'
                '  *" $commit:$schema "*) exit 0 ;;\n'
                '  *) exit 4 ;;\n'
                'esac\n',
                encoding="utf-8",
            )
            helper.chmod(0o755)
            agent.chmod(0o755)
            for commit in (CURRENT, KNOWN_GOOD, CANDIDATE):
                release = directory / "releases" / commit
                release.mkdir(parents=True)
                (release / "surface-runtime.sha256").write_text(RUNTIME + "\n")
                (release / "local-ai-runtime.sha256").write_text(AI_RUNTIME + "\n")
            for store, digest, image in (
                ("runtimes", RUNTIME, "native-surface-runtime.erofs"),
                ("ai-runtimes", AI_RUNTIME, "local-ai-runtime.erofs"),
            ):
                runtime = directory / store / "sha256" / digest
                runtime.mkdir(parents=True)
                (runtime / image).touch()

            source = INIT.read_text(encoding="utf-8")
            definitions = "\n".join(function(source, name) for name in (
                "is_sha", "is_sha256", "verify_selected_release", "select_verified_release",
            ))
            definitions = definitions.replace("/sbin/ordax-portable-state", '"$STATE_HELPER"')
            definitions = definitions.replace('"/run/portable-release-verify.json"', '"$VERIFY_RECEIPT"')
            script = (
                "set -eu\n" + definitions
                + "\nselect_verified_release || exit 9\n"
                + 'printf "%s %s %s %s %s\\n" "$SELECTED_SLOT" "$SELECTED_COMMIT" '
                '"$SELECTED_MANIFEST_SCHEMA" "$SELECTED_SURFACE_RUNTIME_SHA256" "$SELECTED_AI_RUNTIME_SHA256"\n'
            )
            environment = dict(os.environ, **{
                "STATE_HELPER": helper.as_posix(),
                "AGENT": agent.as_posix(),
                "STATE_MOUNT": directory.as_posix(),
                "PORTABLE_ROOT": directory.as_posix(),
                "TRUST_ANCHOR": "bootstrap-owned-trust",
                "AUDIT_LOG": (directory / "calls").as_posix(),
                "ROLLED_BACK": (directory / "rolled-back").as_posix(),
                "VERIFY_RECEIPT": (directory / "verify.json").as_posix(),
                "FIRST_SELECTION": selection,
                "AFTER_ROLLBACK": after_rollback,
                "KNOWN_GOOD": known_good,
                "ROLLBACK_STATUS": rollback_status,
                "VALID_RELEASES": valid,
                **{name: "" for name in (
                    "SELECTED_SLOT", "SELECTED_COMMIT", "SELECTED_MANIFEST_SCHEMA",
                    "SELECTED_SURFACE_RUNTIME_SHA256", "SELECTED_AI_RUNTIME_SHA256",
                )},
            })
            result = subprocess.run([self.shell, "-c", script], env=environment, text=True, capture_output=True)
            calls = (directory / "calls").read_text(encoding="utf-8")
            return result, calls

    def test_valid_current_does_not_consult_fallback(self):
        result, calls = self.select(valid=f"{CURRENT}:4")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), f"current {CURRENT} 4 {RUNTIME} {AI_RUNTIME}")
        self.assertNotIn("resolve ", calls)

    def test_failed_current_verification_falls_back_with_exact_runtime_identity(self):
        for schema in (2, 3, 4):
            with self.subTest(schema=schema):
                result, calls = self.select(valid=f"{KNOWN_GOOD}:{schema}")
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(result.stdout.startswith(f"known-good {KNOWN_GOOD} {schema}"))
                self.assertIn("resolve ", calls)
                self.assertIn(f"--expected-commit {KNOWN_GOOD}", calls)

    def test_failed_candidate_and_current_use_verified_known_good_after_rollback(self):
        result, calls = self.select(selection=f"candidate {CANDIDATE}")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.startswith(f"known-good {KNOWN_GOOD} 3"))
        self.assertLess(calls.index("rollback "), calls.index("resolve "))
        self.assertIn(f"--expected-commit {CURRENT}", calls)

    def test_failed_candidate_returns_verified_current_when_available(self):
        result, calls = self.select(selection=f"candidate {CANDIDATE}", valid=f"{CURRENT}:3")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.startswith(f"current {CURRENT} 3"))
        self.assertIn("rollback ", calls)
        self.assertNotIn("resolve ", calls)

    def test_invalid_slots_and_failed_verification_never_grant_boot_authority(self):
        cases = (
            {"valid": ""},
            {"known_good": ""},
            {"known_good": "../escape"},
            {"known_good": CURRENT},
            {"selection": ""},
            {"selection": f"current {CURRENT} extra"},
            {"selection": f"unknown {CURRENT}"},
            {"selection": f"candidate {CANDIDATE}", "rollback_status": "4"},
            {"selection": f"candidate {CANDIDATE}", "after_rollback": f"candidate {CANDIDATE}"},
        )
        for case in cases:
            with self.subTest(case=case):
                result, _ = self.select(**case)
                self.assertEqual(result.returncode, 9)
                self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()
