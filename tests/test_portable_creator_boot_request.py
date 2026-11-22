"""Portable Creator update request contract: tested against real initramfs shell.

No disk access, no release signing and no fake success receipt. POSIX shell
fixtures replace only the physical helper and verifier while preserving the
production request parser, signature gate and one-shot preparation ordering.
"""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
INIT = ROOT / "bootstrap/initramfs/portable_init.sh"
CURRENT = "b" * 40
CANDIDATE = "a" * 40


def production_body(source: str, name: str) -> str:
    anchor = f"{name}() {{\n"
    if source.count(anchor) != 1:
        raise AssertionError(f"missing or duplicated production shell function {name}")
    after = source.split(anchor, 1)[1]
    if "\n}\n" not in after:
        raise AssertionError(f"production function {name} has no end")
    return after.split("\n}\n", 1)[0]


def request(commit: str = CANDIDATE) -> bytes:
    return (
        "schema=ordax.portable-update-request/1\n"
        f"source_commit={commit}\n"
    ).encode("ascii")


class PortableCreatorBootRequestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.shell = shutil.which("sh")
        if cls.shell is None:
            raise unittest.SkipTest("POSIX shell unavailable")
        source = INIT.read_text(encoding="utf-8")
        cls.sha_function = production_body(source, "is_sha")
        cls.update_function = production_body(source, "import_verified_creator_update")

    def execute(
        self,
        payload: bytes | None,
        *,
        signature_ok: bool = True,
        current: str = CURRENT,
        rejected: str = "",
        prepare_ok: bool = True,
    ) -> tuple[subprocess.CompletedProcess[str], list[str]]:
        with tempfile.TemporaryDirectory(prefix="ordax-creator-boot-request-") as tmp:
            root = Path(tmp)
            data = root / ".ordax" / "updates"
            data.mkdir(parents=True)
            if payload is not None:
                (data / "portable-release-request.txt").write_bytes(payload)

            verifier = root / "verify.sh"
            verifier.write_bytes(
                b"#!/bin/sh\n"
                b"printf 'verify:%s\\n' \"$1\" >> audit\n"
                b"[ \"$VERIFY_OK\" = yes ]\n"
            )
            verifier.chmod(0o755)

            body = self.update_function.replace(
                "/sbin/ordax-portable-state", "mock_state"
            ).replace(
                "/run/portable-host-update-verify.json", "./verify.json"
            )
            script = (
                "#!/bin/sh\nset -eu\n"
                "PORTABLE_ROOT=.ordax\n"
                "STATE_MOUNT=./state\n"
                "TRUST_ANCHOR=./trust.json\n"
                "AGENT=./verify.sh\n"
                "is_sha() {\n"
                + self.sha_function
                + "\n}\n"
                + """mock_state() {
    printf 'state:%s\\n' "$1" >> audit
    case "$1" in
        resolve)
            [ "$4" = current ] || return 2
            printf '%s\\n' "$CURRENT_SHA" ;;
        ./state)
            [ "$2" = rejected ] || return 2
            [ -n "$REJECTED_SHA" ] || return 3
            printf '%s\\n' "$REJECTED_SHA" ;;
        prepare)
            [ "$4" = "$EXPECTED_CANDIDATE" ] || return 2
            printf 'prepare:%s\\n' "$4" >> audit
            [ "$PREPARE_OK" = yes ] ;;
        *) return 2 ;;
    esac
}
import_verified_creator_update() {
"""
                + body
                + "\n}\nimport_verified_creator_update\n"
            )
            (root / "probe.sh").write_bytes(script.encode("utf-8"))
            env = dict(
                os.environ,
                VERIFY_OK="yes" if signature_ok else "no",
                PREPARE_OK="yes" if prepare_ok else "no",
                CURRENT_SHA=current,
                REJECTED_SHA=rejected,
                EXPECTED_CANDIDATE=CANDIDATE,
            )
            result = subprocess.run(
                [self.shell, "probe.sh"],
                cwd=root, env=env, text=True, capture_output=True, timeout=15,
                check=False,
            )
            audit = root / "audit"
            calls = audit.read_text(encoding="utf-8").splitlines() if audit.exists() else []
            return result, calls

    def test_verified_candidate_only_arms_after_signature(self) -> None:
        result, calls = self.execute(request())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, [
            "state:resolve",
            "state:./state",
            "verify:verify-portable-v4-exact",
            "state:prepare",
            f"prepare:{CANDIDATE}",
        ])
        self.assertIn(f"ORDAX_PORTABLE_CREATOR_CANDIDATE_ARMED={CANDIDATE}", result.stdout)

    def test_invalid_signature_never_prepares_state(self) -> None:
        result, calls = self.execute(request(), signature_ok=False)
        self.assertEqual(result.returncode, 0)
        self.assertIn("verify:verify-portable-v4-exact", calls)
        self.assertFalse(any(x.startswith("prepare:") or x == "state:prepare" for x in calls))
        self.assertNotIn("CANDIDATE_ARMED", result.stdout)

    def test_rejected_or_already_current_release_does_not_rearm(self) -> None:
        for kw in ({"rejected": CANDIDATE}, {"current": CANDIDATE}):
            with self.subTest(case=kw):
                result, calls = self.execute(request(), **kw)
                self.assertEqual(result.returncode, 0)
                self.assertFalse(any(x.startswith("verify:") or x == "state:prepare" for x in calls))

    def test_invalid_current_identity_never_arms(self) -> None:
        result, calls = self.execute(request(), current="not-a-commit")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(calls, ["state:resolve"])

    def test_unsigned_or_ambiguous_request_is_noop(self) -> None:
        payloads = (
            None,
            b"",
            request("not-a-commit"),
            request() + b"extra=yes\n",
            request().replace(b"\n", b"\r\n"),
            request().replace(b"source_commit=", b"requested_commit="),
            request()[:-1],
            request() + b"\x00",
        )
        for payload in payloads:
            with self.subTest(payload=repr(payload)[:90]):
                result, calls = self.execute(payload)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(calls, [])
                self.assertNotIn("CANDIDATE_ARMED", result.stdout)

    def test_failed_prepare_does_not_claim_activation(self) -> None:
        result, calls = self.execute(request(), prepare_ok=False)
        self.assertEqual(result.returncode, 0)
        self.assertIn("state:prepare", calls)
        self.assertNotIn("CANDIDATE_ARMED", result.stdout)


if __name__ == "__main__":
    unittest.main()
