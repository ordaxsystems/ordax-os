import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "kernel-build-environment.json"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")


class KernelBuildEnvironmentContractTests(unittest.TestCase):
    def load(self):
        return json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_environment_identity_is_immutable_source_plus_snapshot(self):
        value = self.load()
        self.assertEqual(value["$schema"], "prototype-ordax.kernel-build-environment/1")
        self.assertEqual(value["architecture"], "linux/amd64")
        digest = value["base_image"]["manifest_digest"]
        self.assertRegex(digest, r"^sha256:[0-9a-f]{64}$")
        self.assertRegex(value["apt"]["snapshot_id"], r"^20[0-9]{6}T[0-9]{6}Z$")
        self.assertIn("gcc", value["apt"]["packages"])
        self.assertIn("gcc-13", value["apt"]["packages"])
        self.assertIn("python3", value["apt"]["packages"])
        # OpenPGP is required by the current signed kernel source; it must be
        # installed from the exact same snapshot as the compiler and linker.
        source = json.loads((ROOT / "bootstrap/kernel/source.json").read_text(encoding="utf-8"))
        if source.get("upstream_signature"):
            self.assertIn("gpg", value["apt"]["packages"])
            self.assertIn("gpg-agent", value["apt"]["packages"])
            self.assertEqual(value["apt"]["expected_versions"]["gpg"], value["apt"]["expected_versions"]["gpg-agent"])
            verifier = (ROOT / "bootstrap/kernel/verify_environment.py").read_text(encoding="utf-8")
            self.assertIn('if "gpg-agent" not in packages:', verifier)
            self.assertIn('for tool in ("gpg", "gpg-agent"):', verifier)
            self.assertIn('observed["gpg"] != observed["gpg-agent"]', verifier)

    def test_promotion_requires_pinned_versions_and_repeat_digest_proof(self):
        value = self.load()
        proof = value["proof"]
        if not proof["package_versions_pinned"] or not proof["repeat_build_digest_match"]:
            self.assertFalse(proof["promotable_to_physical"])

        if value["status"] == "candidate-observation-required":
            self.assertEqual(value["apt"]["expected_versions"], {})
            self.assertFalse(proof["first_observation_complete"])
            self.assertFalse(proof["package_versions_pinned"])

        if value["status"] == "pinned-repeat-proof-required":
            self.assertTrue(proof["first_observation_complete"])
            self.assertTrue(proof["package_versions_pinned"])
            self.assertFalse(proof["repeat_build_digest_match"])
            self.assertFalse(proof["promotable_to_physical"])

        if value["status"] == "pinned-repeat-proof-complete":
            self.assertTrue(proof["first_observation_complete"])
            self.assertTrue(proof["package_versions_pinned"])
            self.assertTrue(proof["repeat_build_digest_match"])
            self.assertTrue(proof["promotable_to_physical"])

    def test_current_pinned_repeat_proof_matches_the_selected_kernel(self):
        source = json.loads((ROOT / "bootstrap/kernel/source.json").read_text(encoding="utf-8"))
        env = self.load()
        proof = env["repeat_proof"]
        version = source["version"]
        expected_names = {
            f"kernel-{version}.config",
            f"kernel-modules-{version}.tar",
            f"vmlinuz-{version}",
        }

        self.assertEqual(bool(source["build"]["pinned_environment_resolved"]), bool(env["proof"]["repeat_build_digest_match"]))
        if not source["build"]["pinned_environment_resolved"]:
            self.assertFalse(env["proof"]["promotable_to_physical"])
            return

        self.assertEqual(env["status"], "pinned-repeat-proof-complete")
        self.assertEqual(proof["kernel_version"], version)
        self.assertEqual(proof["result"], "pass")
        self.assertRegex(proof["source_commit"], COMMIT_RE)
        self.assertIsInstance(proof["workflow_run_id"], int)
        self.assertGreater(proof["workflow_run_id"], 0)
        self.assertEqual(set(proof["artifacts"]), expected_names)
        for digest in proof["artifacts"].values():
            self.assertRegex(digest, SHA256_RE)
        manifest = json.loads((ROOT / "docs/contracts/minimal-bootstrap.json").read_text(encoding="utf-8"))
        kernel = next(g for g in manifest["artifact_groups"] if g["id"] == "kernel")["artifacts"]
        self.assertEqual(len(kernel), 1)
        self.assertEqual(proof["artifacts"][f"vmlinuz-{version}"], kernel[0]["sha256"])
        self.assertFalse(source["build"]["physical_artifact_authorized"])
        self.assertFalse(manifest["physical_write_allowed"])

    def test_artifact_reproducibility_compares_same_current_source(self):
        value = self.load()
        policy = value["artifact_digest_policy"]
        self.assertTrue(policy["current_source_or_config_may_change_artifact_bytes"])
        self.assertTrue(policy["historical_reference_artifacts_are_environment_observation_only"])
        self.assertTrue(policy["promotion_requires_same_current_source_repeat_build_match"])
        self.assertTrue(policy["historical_artifact_digest_is_not_a_permanent_current_build_oracle"])
        self.assertTrue(policy["historical_proof_does_not_authorize_new_signed_source"])

        verifier = (
            ROOT / "bootstrap/kernel/verify_reproducibility.py"
        ).read_text(encoding="utf-8")
        self.assertIn("--repeat-artifact-dir", verifier)
        self.assertIn("current-source repeat digest mismatch", verifier)
        self.assertNotIn('if observed != expected_digest', verifier)

    def test_pinned_workflow_binds_source_to_exact_pr_head_without_expanding_toolchain(self):
        workflow = (
            ROOT / ".github/workflows/kernel-pinned-environment.yml"
        ).read_text(encoding="utf-8")
        identity = "${{ github.event.pull_request.head.sha || github.sha }}"
        self.assertIn(f"ref: {identity}", workflow)
        canonical = f"          ORDAX_SOURCE_COMMIT: {identity}\n"
        self.assertEqual(workflow.count(canonical), 2)
        self.assertIn('-e ORDAX_SOURCE_COMMIT="$ORDAX_SOURCE_COMMIT"', workflow)
        self.assertIn("'source_commit': os.environ['ORDAX_SOURCE_COMMIT']", workflow)
        self.assertNotIn('-e GITHUB_SHA="$GITHUB_SHA"', workflow)
        self.assertNotIn('"git"', self.load()["apt"]["packages"])

    def test_package_list_is_sorted_and_unique(self):
        packages = self.load()["apt"]["packages"]
        self.assertEqual(packages, sorted(set(packages)))

    def test_pinned_versions_cover_exact_package_set(self):
        value = self.load()
        packages = value["apt"]["packages"]
        expected = value["apt"]["expected_versions"]
        proof = value["proof"]
        if proof["package_versions_pinned"]:
            self.assertEqual(set(expected), set(packages))
            for package in packages:
                self.assertIsInstance(expected[package], str)
                self.assertTrue(expected[package].strip())

    def test_reference_observation_is_complete_once_first_measurement_is_promoted(self):
        value = self.load()
        if not value["proof"]["first_observation_complete"]:
            return

        reference = value["reference_observation"]
        self.assertRegex(reference["source_commit"], COMMIT_RE)
        self.assertRegex(reference["ca_bundle_sha256"], SHA256_RE)
        self.assertEqual(
            set(reference["artifacts"]),
            {
                "kernel-6.6.52.config",
                "kernel-modules-6.6.52.tar",
                "vmlinuz-6.6.52",
            },
        )
        for digest in reference["artifacts"].values():
            self.assertRegex(digest, SHA256_RE)


if __name__ == "__main__":
    unittest.main()
