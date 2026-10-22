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

            def exercise(status, *, event_name='workflow_dispatch', tamper_proof=False, wrong_url=False):
                fixture = json.loads(json.dumps(auth))
                fixture["status"] = status
                fixture["physical_write_allowed"] = status == "authorized"
                fixture["explicit_owner_authorization"] = status == "authorized"
                # A blocked-mode test must not inherit a previous authorized
                # source-context digest from a live owner-approved repository.
                fixture["authorization_context_sha256"] = (
                    auth["authorization_context_sha256"] if status == "authorized" else None
                )
                if wrong_url:
                    fixture["release_binding"]["canonical_envelope_url"] = "https://invalid.example/release-envelope.json"
                auth_file.write_text(json.dumps(fixture), encoding="utf-8")
                proof_file.write_bytes(proof + (b" " if tamper_proof else b""))
                out.write_text("", encoding="utf-8")
                envfile.write_text("", encoding="utf-8")
                result = subprocess.run(
                    [sys.executable, "-c", self._resolver()],
                    cwd=base, env=dict(env, GITHUB_EVENT_NAME=event_name), text=True, capture_output=True, timeout=10,
                    check=False,
                )
                return result, out.read_text(encoding="utf-8"), envfile.read_text(encoding="utf-8")

            blocked, output, variables = exercise("blocked-explicit-physical-authorization-pending")
            self.assertNotEqual(blocked.returncode, 0)
            self.assertEqual((output, variables), ("", ""))

            proof_only, output, variables = exercise(
                "blocked-explicit-physical-authorization-pending",
                event_name="pull_request",
            )
            self.assertEqual(proof_only.returncode, 0, proof_only.stderr)
            self.assertEqual(output, f"release_source_commit={expected_commit}\n")
            self.assertEqual(
                variables,
                f"RELEASE_SOURCE_COMMIT={expected_commit}\nENVELOPE_URL={expected_url}\n",
            )

            wrong_mode, output, variables = exercise(
                "authorized", event_name="pull_request"
            )
            self.assertNotEqual(wrong_mode.returncode, 0)
            self.assertEqual((output, variables), ("", ""))

            tampered_proof_only, output, variables = exercise(
                "blocked-explicit-physical-authorization-pending",
                event_name="pull_request", tamper_proof=True,
            )
            self.assertNotEqual(tampered_proof_only.returncode, 0)
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

    def test_writer_source_is_exact_operator_context_not_arbitrary_commit(self):
        source = WORKFLOW.read_text(encoding="utf-8")
        context = (ROOT / "tools/creator/physical_promotion.py").read_text(
            encoding="utf-8"
        )
        self.assertIn(
            'if [[ "$WRITER_SOURCE_COMMIT" != "$ORDAX_SOURCE_COMMIT" ]]; then',
            source,
        )
        self.assertIn("PHYSICAL_WRITER_CONTEXT_MATCH=PASS", source)
        self.assertIn(
            'WRITER_SOURCE_COMMIT: ${{ github.event.pull_request.head.sha || github.sha }}',
            source,
        )
        self.assertNotIn("inputs.writer_source_commit", source)
        self.assertNotIn("name: Checkout exact published writer source", source)
        self.assertNotIn("writer-source", source)
        self.assertEqual(source.count("path: operator"), 1)
        self.assertIn("working-directory: operator/tools/creator", source)
        self.assertLess(
            source.index("PHYSICAL_WRITER_CONTEXT_MATCH=PASS"),
            source.index("OFFICIAL_PHYSICAL_PROMOTION=READY"),
        )
        self.assertIn(
            '".github/workflows/first-physical-usb-payload.yml",',
            context,
        )
        self.assertIn(
            'ref: ${{ steps.canonical.outputs.release_source_commit }}',
            source,
        )
        self.assertIn(
            'ref: ${{ github.event.pull_request.head.sha || github.sha }}',
            source,
        )

    def test_canonical_17_sources_derive_only_from_creator_core(self):
        source = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("go run ./cmd/ordax-creator bind-portable-sources", source)
        self.assertIn("PHYSICAL_PAYLOAD_SOURCE_BINDINGS=CORE_SSOT", source)
        producer_step = source.split(
            "      - name: Assemble the exact 17-source physical payload", 1
        )[1].split(
            "      - name: Generate exact target-specific media and application plans", 1
        )[0]
        self.assertNotIn("          ids = [", producer_step)
        self.assertNotIn("path.read_bytes()", producer_step)
        core = (ROOT / "tools/creator/core/portable_sources.go").read_text(encoding="utf-8")
        self.assertIn("func BindPortableSources(", core)
        self.assertIn("portableMediaTargets", core)
        self.assertIn("VerifyPortableSources(bindings, root)", core)

    def test_pre_authorization_real_sources_are_proved_but_never_uploaded(self):
        source = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("pull_request:", source)
        self.assertIn("push:", source)
        self.assertIn("if: ${{ github.event_name != 'workflow_dispatch' }}", source)
        self.assertIn("if: ${{ github.event_name == 'workflow_dispatch' }}", source)
        self.assertIn("pre_authorization_ready", source)
        self.assertIn("authorized_candidate_materialization_allowed", source)
        self.assertIn("verify-portable-sources", source)
        self.assertIn("PORTABLE_SOURCE_COUNT=17", source)
        self.assertIn("REAL_V4_17_SOURCE_PREFLIGHT=PASS_NON_DESTRUCTIVE", source)
        self.assertIn("'application_operations_planned': 39", source)
        self.assertIn("'artifact_readbacks_on_physical_media': 0", source)
        self.assertIn("'physical_target_selected': False", source)
        self.assertIn("'physical_write_authorized': False", source)
        self.assertIn("'physical_write_performed': False", source)
        self.assertIn("name: Materialize real 17 signed sources on disposable FAT32 and exFAT twin", source)
        self.assertIn("operator/tools/creator/proof/portable_prepared_media.py", source)
        self.assertIn("REAL_V4_DISPOSABLE_TWIN=17_OF_17_READBACK_PASS", source)
        self.assertIn("'disposable_twin_artifacts_readback'] = 17", source)
        self.assertIn("'disposable_twin_raw_image_deleted'] = True", source)
        self.assertIn("sudo rm -f \"$work/portable-v4-disposable-twin.raw\"", source)
        self.assertIn("name: Upload proof metadata only (never physical source bytes)", source)
        self.assertIn(
            "path: ${{ runner.temp }}/first-physical-payload/out/preauthorization-proof.json",
            source,
        )
        self.assertIn("name: Upload first physical USB operator payload\n"
                      "        if: ${{ github.event_name == 'workflow_dispatch' }}", source)
        self.assertIn("name: Destroy temporary signed release and 17 source files", source)

    def test_release_identity_comes_only_from_authorization(self):
        source = WORKFLOW.read_text(encoding="utf-8")
        self.assertNotIn("inputs.release_source_commit", source)
        self.assertNotIn("inputs.envelope_url", source)
        self.assertNotIn("b924ff8d74d1761232381ae3f9604bba17497cfd", source)
        self.assertIn("id: canonical", source)
        self.assertIn("python3 operator/tools/creator/physical_promotion.py --repo-root operator --require-ready", source)
        self.assertLess(source.index("OFFICIAL_PHYSICAL_PROMOTION=READY"), source.index("id: canonical"))
        self.assertIn("steps.canonical.outputs.release_source_commit", source)
        self.assertIn("operator/docs/contracts/physical-write-authorization.json", source)
        self.assertIn("operator/docs/evidence/canonical-v4-release-proof.json", source)
        self.assertIn("canonical_v4_release_proof_sha256", source)
        self.assertIn("CANONICAL_RELEASE_FROM_AUTHORIZATION_SSOT=PASS", source)
        self.assertIn("'blocked-explicit-physical-authorization-pending'", source)
        self.assertIn("auth.get('physical_write_allowed') is not physical_mode", source)


if __name__ == "__main__":
    unittest.main()
