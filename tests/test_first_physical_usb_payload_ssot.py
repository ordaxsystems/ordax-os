"""Ensure the physical USB payload uses one release identity SSOT.

This is a source-contract regression check; it does not test physical USB I/O.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "first-physical-usb-payload.yml"


class PhysicalUsbPayloadIdentityTests(unittest.TestCase):
    @staticmethod
    def _resolver():
        import textwrap
        source = WORKFLOW.read_text(encoding="utf-8")
        start = source.index("id: canonical")
        header = "          python3 - <<'PY'\n"
        begin = source.index(header, start) + len(header)
        end = source.index("          PY\n", begin)
        return textwrap.dedent(source[begin:end])

    def test_resolver_python_is_valid(self):
        import ast
        ast.parse(self._resolver())

    def test_resolver_accepts_only_bound_authorized_proof(self):
        import json
        import os
        import subprocess
        import sys
        import tempfile

        auth = json.loads((ROOT / "docs/contracts/physical-write-authorization.json").read_text(encoding="utf-8"))
        proof = (ROOT / "docs/evidence/canonical-v4-release-proof.json").read_bytes()
        expected_commit = auth["release_binding"]["source_commit"]
        expected_url = auth["release_binding"]["canonical_envelope_url"]
        with tempfile.TemporaryDirectory(prefix="ordax-usb-ssot-test-") as directory:
            base = Path(directory)
            auth_file = base / "operator/docs/contracts/physical-write-authorization.json"
            proof_file = base / "operator/docs/evidence/canonical-v4-release-proof.json"
            auth_file.parent.mkdir(parents=True)
            proof_file.parent.mkdir(parents=True)
            out = base / "github-output"
            envfile = base / "github-env"
            env = dict(os.environ, GITHUB_OUTPUT=str(out), GITHUB_ENV=str(envfile))

            def exercise(status, *, tamper_proof=False, wrong_url=False):
                fixture = json.loads(json.dumps(auth))
                fixture["status"] = status
                fixture["physical_write_allowed"] = status == "authorized"
                fixture["explicit_owner_authorization"] = status == "authorized"
                if wrong_url:
                    fixture["release_binding"]["canonical_envelope_url"] = "https://invalid.example/release-envelope.json"
                auth_file.write_text(json.dumps(fixture), encoding="utf-8")
                proof_file.write_bytes(proof + (b" " if tamper_proof else b""))
                out.write_text("", encoding="utf-8")
                envfile.write_text("", encoding="utf-8")
                result = subprocess.run(
                    [sys.executable, "-c", self._resolver()],
                    cwd=base, env=env, text=True, capture_output=True, timeout=10,
                    check=False,
                )
                return result, out.read_text(encoding="utf-8"), envfile.read_text(encoding="utf-8")

            blocked, output, variables = exercise("blocked-explicit-physical-authorization-pending")
            self.assertNotEqual(blocked.returncode, 0)
            self.assertEqual((output, variables), ("", ""))

            tampered, output, variables = exercise("authorized", tamper_proof=True)
            self.assertNotEqual(tampered.returncode, 0)
            self.assertEqual((output, variables), ("", ""))

            invalid_url, output, variables = exercise("authorized", wrong_url=True)
            self.assertNotEqual(invalid_url.returncode, 0)
            self.assertEqual((output, variables), ("", ""))

            valid, output, variables = exercise("authorized")
            self.assertEqual(valid.returncode, 0, valid.stderr)
            self.assertEqual(output, f"release_source_commit={expected_commit}\n")
            self.assertEqual(
                variables,
                f"RELEASE_SOURCE_COMMIT={expected_commit}\nENVELOPE_URL={expected_url}\n",
            )

    def test_release_identity_comes_only_from_authorization(self):
        source = WORKFLOW.read_text(encoding="utf-8")
        self.assertNotIn("inputs.release_source_commit", source)
        self.assertNotIn("inputs.envelope_url", source)
        self.assertNotIn("b924ff8d74d1761232381ae3f9604bba17497cfd", source)
        self.assertIn("id: canonical", source)
        self.assertIn("steps.canonical.outputs.release_source_commit", source)
        self.assertIn("operator/docs/contracts/physical-write-authorization.json", source)
        self.assertIn("operator/docs/evidence/canonical-v4-release-proof.json", source)
        self.assertIn("canonical_v4_release_proof_sha256", source)
        self.assertIn("CANONICAL_RELEASE_FROM_AUTHORIZATION_SSOT=PASS", source)
        self.assertIn("if auth.get('status') != 'authorized':", source)


if __name__ == "__main__":
    unittest.main()
