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

            def exercise(status, *, purpose=None, event_name='workflow_dispatch', tamper_proof=False, wrong_url=False):
                if purpose is None:
                    purpose = 'authorized-physical' if status == 'authorized' else 'source-review'
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
                    cwd=base, env=dict(env, GITHUB_EVENT_NAME=event_name, ORDAX_PAYLOAD_PURPOSE=purpose), text=True, capture_output=True, timeout=10,
                    check=False,
                )
                return result, out.read_text(encoding="utf-8"), envfile.read_text(encoding="utf-8")

            review, output, variables = exercise("blocked-explicit-physical-authorization-pending")
            self.assertEqual(review.returncode, 0, review.stderr)
            self.assertEqual(output, f"release_source_commit={expected_commit}\n")
            self.assertEqual(
                variables,
                f"RELEASE_SOURCE_COMMIT={expected_commit}\nENVELOPE_URL={expected_url}\n",
            )

            for bad_status, bad_purpose, event in (
                ("blocked-explicit-physical-authorization-pending", "authorized-physical", "workflow_dispatch"),
                ("authorized", "source-review", "workflow_dispatch"),
                ("blocked-explicit-physical-authorization-pending", "invalid", "workflow_dispatch"),
                ("blocked-explicit-physical-authorization-pending", "source-review", "pull_request"),
                ("authorized", "authorized-physical", "push"),
            ):
                with self.subTest(status=bad_status, purpose=bad_purpose, event=event):
                    invalid, output, variables = exercise(bad_status, purpose=bad_purpose, event_name=event)
                    self.assertNotEqual(invalid.returncode, 0)
                    self.assertEqual((output, variables), ("", ""))

            tampered_proof_only, output, variables = exercise(
                "blocked-explicit-physical-authorization-pending",
                tamper_proof=True,
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
        self.assertNotIn("working-directory: operator/tools/creator", source)
        self.assertIn("uses: ./operator/.github/actions/resolve-creator-source", source)
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

    def test_ci_proof_and_signed_owner_payload_are_separate(self):
        source = WORKFLOW.read_text(encoding="utf-8")
        portable = (ROOT / ".github/workflows/portable-usb-v2-proof.yml").read_text(encoding="utf-8")
        self.assertIn("validate-independent-core:", source)
        self.assertIn("payload:\n    if: ${{ github.event_name == 'workflow_dispatch' }}", source)
        self.assertIn("CREATOR_17_SOURCE_DEV_GATE=PASS_READ_ONLY", source)
        self.assertIn("PHYSICAL_PREAUTHORIZATION=ELIGIBLE_NOT_AUTHORIZED", source)
        self.assertIn("PHYSICAL_TARGET_DEVICE_TOUCHED=NO", source)
        self.assertIn("tests.test_first_physical_usb_payload_ssot", source)
        self.assertIn("Build and verify exact Stable Base", source)
        self.assertIn("ref: ${{ steps.canonical.outputs.release_source_commit }}", source)
        self.assertIn("PORTABLE_APPLICATION_OPERATIONS=39", source)
        self.assertIn("Upload source-review or authorized physical operator payload", source)
        self.assertIn("ORDAX_PAYLOAD_PURPOSE: ${{ inputs.purpose }}", source)
        self.assertIn("default: source-review", source)
        self.assertIn("authorized-physical", source)
        self.assertIn("PORTABLE_17_SOURCE_REVIEW=PREAUTHORIZATION_ONLY", source)
        self.assertIn("gate.get('pre_authorization_ready') is True", source)
        self.assertIn("gate.get('authorized_candidate_materialization_allowed') is False", source)
        self.assertIn("verified-source-review-not-published", source)
        self.assertIn("verify-portable-sources --bindings", source)
        self.assertIn("Destroy temporary signed release and 17 source files", source)
        self.assertNotIn("REAL_V4_17_SOURCE_PREFLIGHT=PASS_NON_DESTRUCTIVE", source)
        self.assertIn(".github/workflows/first-physical-usb-payload.yml", portable)
        self.assertIn("verify-portable-sources", portable)
        self.assertIn("PORTABLE_SOURCE_COUNT=17", portable)
        self.assertIn("PHYSICAL_WRITE_AUTHORIZED=NO", portable)

    def test_single_verified_independent_creator_core_owns_portable_bindings(self):
        import json
        source = WORKFLOW.read_text(encoding="utf-8")
        action = (ROOT / ".github/actions/resolve-creator-source/action.yml").read_text(encoding="utf-8")
        contract = json.loads((ROOT / "docs/contracts/native-release-assembly.json").read_text(encoding="utf-8"))
        self.assertEqual(contract["creator_source"]["repository"], "ordaxsystems/ordax-creator")
        self.assertIs(contract["creator_source"]["physical_apply_authorized"], False)
        self.assertEqual(source.count("uses: ./operator/.github/actions/resolve-creator-source"), 1)
        self.assertIn("working-directory: ${{ inputs.source-root }}", action)
        self.assertIn("source-root: ${{ github.workspace }}/operator", source)
        self.assertIn("rev-parse 'HEAD^{tree}'", source)
        self.assertIn("TestBindPortableSources(CoreInventory|RejectsIncompleteExtraOrUnsafeInput|RejectsSymlinkedRoot)$", source)
        self.assertIn('"$creator" bind-portable-sources --sources-root "$out/sources"', source)
        self.assertIn("PHYSICAL_PAYLOAD_SOURCE_BINDINGS=INDEPENDENT_CORE_SSOT", source)
        self.assertNotIn("go run ./cmd/ordax-creator", source)
        self.assertNotIn("ids = [\n              'systemd-boot'", source)
        self.assertIn("python3 operator/tools/creator/physical_promotion.py --repo-root operator --require-ready", source)
        self.assertIn("elif [[ \"$ORDAX_PAYLOAD_PURPOSE\" == 'source-review' ]]; then", source)
        self.assertIn("ORDAX_PAYLOAD_PURPOSE", source)
        self.assertIn("get('ready') is False", source)
        self.assertIn("app['physical_write_authorized'] is False", source)
        self.assertIn("contents: read", source)

    def test_surface_policy_reads_only_pinned_ephemeral_external_source(self):
        source = WORKFLOW.read_text(encoding="utf-8")
        action = (ROOT / ".github/actions/assemble-surface/action.yml").read_text(encoding="utf-8")
        self.assertEqual(
            source.count("uses: ./operator/.github/actions/assemble-surface"), 1
        )
        self.assertIn("source-root: ${{ github.workspace }}/operator", source)
        self.assertIn("working-directory: ${{ inputs.source-root }}", action)
        self.assertIn("docs/contracts/surface-source.json", action)
        self.assertIn("PHYSICAL_POLICY_SURFACE_SOURCE=PINNED_EXTERNAL_DISPOSABLE", source)
        self.assertIn("PHYSICAL_POLICY_SURFACE_TRACKED_COPY=NO", source)
        self.assertIn("test -z \"$(git -C operator ls-files -- system/surface/ui system/surface/workspace)\"", source)
        self.assertLess(
            source.index("Stage verified visual source only in disposable operator checkout"),
            source.index("Validate official physical promotion gate before resolving payload"),
        )
        self.assertLess(
            source.index("Assemble exact verified external Surface for read-only physical policy"),
            source.index("Validate official physical promotion gate before resolving payload"),
        )

    def test_release_identity_comes_only_from_authorization(self):
        source = WORKFLOW.read_text(encoding="utf-8")
        self.assertNotIn("inputs.release_source_commit", source)
        self.assertNotIn("inputs.envelope_url", source)
        self.assertNotIn("b924ff8d74d1761232381ae3f9604bba17497cfd", source)
        self.assertIn("id: canonical", source)
        self.assertIn("python3 operator/tools/creator/physical_promotion.py --repo-root operator --require-ready", source)
        self.assertIn("elif [[ \"$ORDAX_PAYLOAD_PURPOSE\" == 'source-review' ]]; then", source)
        self.assertIn("ORDAX_PAYLOAD_PURPOSE", source)
        self.assertIn("get('ready') is False", source)
        self.assertLess(source.index("OFFICIAL_PHYSICAL_PROMOTION=READY"), source.index("id: canonical"))
        self.assertIn("steps.canonical.outputs.release_source_commit", source)
        self.assertIn("operator/docs/contracts/physical-write-authorization.json", source)
        self.assertIn("operator/docs/evidence/canonical-v4-release-proof.json", source)
        self.assertIn("canonical_v4_release_proof_sha256", source)
        self.assertIn("CANONICAL_RELEASE_FROM_AUTHORIZATION_SSOT=PASS", source)
        self.assertIn("'blocked-explicit-physical-authorization-pending'", source)
        self.assertIn("auth.get('physical_write_allowed') is not physical_mode", source)
        self.assertEqual(source.count("physical_mode = purpose == 'authorized-physical'"), 2)
        self.assertNotIn("physical_mode = os.environ['GITHUB_EVENT_NAME'] == 'workflow_dispatch'", source)


if __name__ == "__main__":
    unittest.main()
