"""Exercise the *real* PID1 exact-verifier selection across manifest v2/v3/v4.

The signer/agent is a boundary stub, while the source-owned verifier,
reference validation, EROFS presence checks and selected identities are real.
This is intentionally distinct from select-boot transaction fallback tests.
"""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PID1 = ROOT / "bootstrap/initramfs/portable_init.sh"
SOURCE = "1" * 40
SURFACE = "a" * 64
LOCAL_AI = "b" * 64


class PortableExactRuntimeHandoffTests(unittest.TestCase):
    def run_verifier(self, schema=4, *, damage=None, selected=SOURCE):
        shell = shutil.which("sh")
        if shell is None:
            self.skipTest("POSIX shell unavailable")
        source = PID1.read_text(encoding="utf-8")

        def function(name):
            body = source.split(name + "() {", 1)[1].split("\n}", 1)[0]
            return name + "() {" + body + "\n}\n"

        functions = "".join(function(name) for name in (
            "is_sha", "is_sha256", "verify_selected_release",
        ))
        functions = functions.replace(
            '"/run/portable-release-verify.json"', '"$VERIFY_RECEIPT"',
        )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release = root / "releases" / SOURCE
            release.mkdir(parents=True)
            surface_ref = release / "surface-runtime.sha256"
            ai_ref = release / "local-ai-runtime.sha256"
            surface_ref.write_text(SURFACE + "\n", encoding="ascii")
            ai_ref.write_text(LOCAL_AI + "\n", encoding="ascii")
            surface_image = root / "runtimes/sha256" / SURFACE / "native-surface-runtime.erofs"
            ai_image = root / "ai-runtimes/sha256" / LOCAL_AI / "local-ai-runtime.erofs"
            surface_image.parent.mkdir(parents=True)
            ai_image.parent.mkdir(parents=True)
            surface_image.write_bytes(b"surface-test-image")
            ai_image.write_bytes(b"ai-test-image")
            agent = root / "release-agent"
            agent.write_text(
                '#!/bin/sh\n'
                'printf "%s\\n" "$*" >>"$AUDIT"\n'
                'method="$1"; shift\n'
                'commit=""\n'
                'while [ "$#" -gt 0 ]; do\n'
                '  if [ "$1" = "--expected-commit" ]; then commit="$2"; fi\n'
                '  shift\n'
                'done\n'
                '[ "$commit" = "$EXPECTED_SOURCE" ] || exit 4\n'
                'case "$SCHEMA:$method" in\n'
                '  4:verify-portable-v4-exact|3:verify-portable-v3-exact|2:verify-portable-exact)\n'
                '    printf "{\\"status\\":\\"verified\\"}\\n"; exit 0 ;;\n'
                '  *) exit 4 ;;\n'
                'esac\n',
                encoding="utf-8",
            )
            agent.chmod(0o755)
            damage_ops = {
                "missing-surface-ref": lambda: surface_ref.unlink(),
                "invalid-surface-ref": lambda: surface_ref.write_text("../escape\n"),
                "missing-surface-image": lambda: surface_image.unlink(),
                "missing-ai-ref": lambda: ai_ref.unlink(),
                "invalid-ai-ref": lambda: ai_ref.write_text("invalid-digest\n"),
                "missing-ai-image": lambda: ai_image.unlink(),
            }
            if damage is not None:
                damage_ops[damage]()
            script = (
                "set -eu\n"
                + functions
                + "\nSELECTED_SLOT=''\nSELECTED_COMMIT=''\n"
                  "SELECTED_MANIFEST_SCHEMA=''\nSELECTED_SURFACE_RUNTIME_SHA256=''\n"
                  "SELECTED_AI_RUNTIME_SHA256=''\n"
                + 'if verify_selected_release current "$REQUESTED_SOURCE"; then\n'
                  '  printf "BOOT_OK:%s:%s:%s:%s:%s\\n" "$SELECTED_SLOT" '
                  '"$SELECTED_COMMIT" "$SELECTED_MANIFEST_SCHEMA" '
                  '"$SELECTED_SURFACE_RUNTIME_SHA256" "$SELECTED_AI_RUNTIME_SHA256"\n'
                  'else\n  printf "BOOT_DENIED\\n"\nfi\n'
            )
            environment = dict(os.environ, **{
                "AGENT": agent.as_posix(),
                "AUDIT": (root / "calls.txt").as_posix(),
                "PORTABLE_ROOT": root.as_posix(),
                "TRUST_ANCHOR": "/bootstrap/public-trust.json",
                "VERIFY_RECEIPT": (root / "verify.json").as_posix(),
                "SCHEMA": str(schema),
                "EXPECTED_SOURCE": SOURCE,
                "REQUESTED_SOURCE": selected,
            })
            result = subprocess.run(
                [shell, "-c", script], env=environment,
                capture_output=True, text=True,
            )
            calls = (root / "calls.txt").read_text(encoding="utf-8") if (
                root / "calls.txt"
            ).exists() else ""
            return result, calls

    def test_v4_requires_three_exact_component_identities(self):
        result, calls = self.run_verifier(schema=4)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), f"BOOT_OK:current:{SOURCE}:4:{SURFACE}:{LOCAL_AI}")
        self.assertIn(f"verify-portable-v4-exact --trust /bootstrap/public-trust.json --root ", calls)
        self.assertIn(f"--expected-commit {SOURCE}", calls)

    def test_v3_requires_surface_but_no_ai_runtime(self):
        result, calls = self.run_verifier(schema=3, damage="missing-ai-image")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), f"BOOT_OK:current:{SOURCE}:3:{SURFACE}:")
        self.assertIn("verify-portable-v3-exact", calls)

    def test_v2_requires_no_content_addressed_surface_or_ai(self):
        result, calls = self.run_verifier(schema=2, damage="missing-surface-image")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), f"BOOT_OK:current:{SOURCE}:2::")
        self.assertIn("verify-portable-exact", calls)

    def test_v4_rejects_missing_or_unsafe_surface_and_ai_references(self):
        for damage in (
            "missing-surface-ref", "invalid-surface-ref",
            "missing-surface-image", "missing-ai-ref",
            "invalid-ai-ref", "missing-ai-image",
        ):
            with self.subTest(damage=damage):
                result, _ = self.run_verifier(schema=4, damage=damage)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), "BOOT_DENIED")

    def test_v3_rejects_missing_surface_materialization(self):
        for damage in ("missing-surface-ref", "invalid-surface-ref", "missing-surface-image"):
            with self.subTest(damage=damage):
                result, _ = self.run_verifier(schema=3, damage=damage)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), "BOOT_DENIED")

    def test_agent_cannot_authorize_a_different_source_commit(self):
        result, _ = self.run_verifier(schema=4, selected="3" * 40)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "BOOT_DENIED")

    def test_unknown_manifest_family_cannot_authorize_boot(self):
        result, _ = self.run_verifier(schema=99)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "BOOT_DENIED")


if __name__ == "__main__":
    unittest.main()
