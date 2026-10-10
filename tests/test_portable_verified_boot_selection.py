"""Exercise portable PID1 verification and fallback without touching disks.

Use the exact selected function body from the production initramfs and
replace only its absolute device helper with a deterministic test fixture.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
INIT = ROOT / "bootstrap/initramfs/portable_init.sh"
CURRENT = "1" * 40
GOOD = "2" * 40
CANDIDATE = "3" * 40


class PortableVerifiedBootSelectionTests(unittest.TestCase):
    def test_canonical_pid1_shell_has_lf_checkout_and_no_crlf(self):
        attributes = (ROOT / ".gitattributes").read_text(encoding="utf-8").splitlines()
        self.assertIn("bootstrap/initramfs/portable_init.sh text eol=lf", attributes)
        raw = INIT.read_bytes()
        self.assertNotIn(b"\r\n", raw)
        self.assertTrue(raw.startswith(b"#!/bin/sh\n"))

    @classmethod
    def setUpClass(cls):
        cls.shell = shutil.which("sh")

    def run_selection(
        self, initial_slot="current", initial_commit=CURRENT,
        known_good=GOOD, valid_pairs=(), post_slot="current",
        post_commit=CURRENT, rollback_succeeds=True,
    ):
        if self.shell is None:
            self.skipTest("POSIX shell unavailable")
        source = INIT.read_text(encoding="utf-8")
        body = source.split("select_verified_release() {", 1)[1].split("\n}", 1)[0]
        body = body.replace("/sbin/ordax-portable-state", "mock_state")
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            audit = root / "audit"
            rollback_state = root / "rollback"
            script = """#!/bin/sh
set -eu
STATE_MOUNT=/mock/state
PORTABLE_ROOT=/mock/data
mock_state() {
    printf 'state:%s\\n' "$1" >>"$AUDIT"
    case "$1" in
        select-boot)
            if [ -f "$ROLLBACK_STATE" ]; then
                printf '%s %s\\n' "$POST_SLOT" "$POST_COMMIT"
            else
                printf '%s %s\\n' "$INITIAL_SLOT" "$INITIAL_COMMIT"
            fi
            ;;
        resolve)
            [ "$4" = known-good ] || return 1
            [ -n "$KNOWN_GOOD" ] || return 1
            printf '%s\\n' "$KNOWN_GOOD"
            ;;
        rollback)
            [ "$ROLLBACK_SUCCEEDS" = yes ] || return 1
            : >"$ROLLBACK_STATE"
            ;;
        *) return 1 ;;
    esac
}
verify_selected_release() {
    printf 'verify:%s:%s\\n' "$1" "$2" >>"$AUDIT"
    case "$VALID_PAIRS" in
        *";$1:$2;"*) return 0 ;;
        *) return 1 ;;
    esac
}
is_sha() {
    [ "${#1}" -eq 40 ] || return 1
    case "$1" in *[!0-9a-f]*|'') return 1 ;; esac
}
select_verified_release() {
""" + body + """
}
if select_verified_release; then
    printf 'BOOT_OK\\n'
else
    printf 'BOOT_FAIL\\n'
fi
"""
            env = dict(os.environ, **{
                "AUDIT": str(audit),
                "ROLLBACK_STATE": str(rollback_state),
                "INITIAL_SLOT": initial_slot,
                "INITIAL_COMMIT": initial_commit,
                "POST_SLOT": post_slot,
                "POST_COMMIT": post_commit,
                "KNOWN_GOOD": known_good,
                "ROLLBACK_SUCCEEDS": "yes" if rollback_succeeds else "no",
                "VALID_PAIRS": ";" + ";".join(f"{slot}:{sha}" for slot, sha in valid_pairs) + ";",
            })
            result = subprocess.run([self.shell, "-c", script], env=env, text=True, capture_output=True)
            return result, audit.read_text(encoding="utf-8").splitlines() if audit.exists() else []

    def test_valid_current_is_booted_without_resolving_known_good(self):
        result, calls = self.run_selection(valid_pairs=(("current", CURRENT),))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "BOOT_OK")
        self.assertEqual(calls, ["state:select-boot", f"verify:current:{CURRENT}"])

    def test_invalid_current_uses_separately_verified_known_good(self):
        result, calls = self.run_selection(valid_pairs=(("known-good", GOOD),))
        self.assertEqual(result.stdout.strip(), "BOOT_OK", result.stderr)
        self.assertEqual(calls, [
            "state:select-boot", f"verify:current:{CURRENT}",
            "state:resolve", f"verify:known-good:{GOOD}",
        ])

    def test_same_commit_cannot_be_retried_as_known_good(self):
        result, calls = self.run_selection(known_good=CURRENT, valid_pairs=(("known-good", CURRENT),))
        self.assertEqual(result.stdout.strip(), "BOOT_FAIL")
        self.assertNotIn(f"verify:known-good:{CURRENT}", calls)

    def test_malformed_or_absent_known_good_does_not_boot(self):
        for identity in ("", "not-a-sha", "f" * 39, "X" * 40):
            with self.subTest(identity=identity):
                result, calls = self.run_selection(known_good=identity, valid_pairs=(("known-good", identity),))
                self.assertEqual(result.stdout.strip(), "BOOT_FAIL")
                self.assertFalse(any(x.startswith("verify:known-good:") for x in calls))

    def test_known_good_selection_itself_cannot_skip_verification(self):
        result, calls = self.run_selection(initial_slot="known-good", initial_commit=GOOD)
        self.assertEqual(result.stdout.strip(), "BOOT_FAIL")
        self.assertNotIn("state:resolve", calls)

    def test_failed_candidate_rolls_back_to_verified_current(self):
        result, calls = self.run_selection(
            initial_slot="candidate", initial_commit=CANDIDATE,
            valid_pairs=(("current", CURRENT),),
        )
        self.assertEqual(result.stdout.strip(), "BOOT_OK", result.stderr)
        self.assertEqual(calls, [
            "state:select-boot", f"verify:candidate:{CANDIDATE}",
            "state:rollback", "state:select-boot", f"verify:current:{CURRENT}",
        ])

    def test_failed_candidate_falls_back_again_if_current_is_invalid(self):
        result, calls = self.run_selection(
            initial_slot="candidate", initial_commit=CANDIDATE,
            valid_pairs=(("known-good", GOOD),),
        )
        self.assertEqual(result.stdout.strip(), "BOOT_OK", result.stderr)
        self.assertEqual(calls[-2:], ["state:resolve", f"verify:known-good:{GOOD}"])

    def test_failed_candidate_without_rollback_never_resolves_or_boots(self):
        result, calls = self.run_selection(
            initial_slot="candidate", initial_commit=CANDIDATE,
            rollback_succeeds=False, valid_pairs=(("known-good", GOOD),),
        )
        self.assertEqual(result.stdout.strip(), "BOOT_FAIL")
        self.assertNotIn("state:resolve", calls)

    def test_unverified_known_good_cannot_be_executed(self):
        result, calls = self.run_selection()
        self.assertEqual(result.stdout.strip(), "BOOT_FAIL")
        self.assertIn(f"verify:known-good:{GOOD}", calls)


if __name__ == "__main__":
    unittest.main()
