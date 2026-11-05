from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/portable-v2-qemu-boot-proof.yml"
CACHE_SHA = "55cc8345863c7cc4c66a329aec7e433d2d1c52a9"


class PortableComponentReuseWorkflowTests(unittest.TestCase):
    def workflow(self) -> str:
        return WORKFLOW.read_text(encoding="utf-8")

    def step_block(self, name: str) -> str:
        text = self.workflow()
        marker = f"      - name: {name}\n"
        start = text.index(marker)
        next_step = text.find("\n      - name: ", start + len(marker))
        if next_step < 0:
            next_step = len(text)
        return text[start:next_step]

    def test_cache_action_is_exactly_pinned_and_never_uses_prefix_fallback(self):
        workflow = self.workflow()
        # Cache count may grow when a canonical candidate gains a verified
        # producer. All actions must still be pinned, with no prefix fallback.
        actions = re.findall(
            r"uses:\s+actions/cache/(restore|save)@([^\s#]+)", workflow
        )
        self.assertGreaterEqual(sum(kind == "restore" for kind, _ in actions), 4)
        self.assertGreaterEqual(sum(kind == "save" for kind, _ in actions), 3)
        self.assertTrue(all(ref == CACHE_SHA for _, ref in actions))
        self.assertNotIn("restore-keys:", workflow)
        self.assertNotRegex(workflow, r"actions/cache/(restore|save)@v[0-9]")

    def test_runner_image_identity_is_bound_into_component_fingerprint(self):
        block = self.step_block("Resolve reusable component fingerprints")
        self.assertIn("${ImageOS}", block)
        self.assertIn("${ImageVersion}", block)
        self.assertIn("ORDAX_COMPONENT_CACHE_ENVIRONMENT", block)
        self.assertIn("portable_component_cache.py fingerprints", block)

    def test_only_reusable_component_builds_are_conditional(self):
        expected = {
            "Build and verify exact local AI runtime on cache miss": "steps.local-ai-cache.outputs.cache-hit != 'true'",
            "Build exact kernel and kernel modules on cache miss": "steps.kernel-cache.outputs.cache-hit != 'true'",
            "Build exact release agent on cache miss": "steps.release-agent-cache.outputs.cache-hit != 'true'",
        }
        for step, condition in expected.items():
            with self.subTest(step=step):
                self.assertIn(f"if: {condition}", self.step_block(step))

        surface = self.step_block("Verify and bind canonical Surface EROFS for QEMU")
        self.assertIn("(inputs.surface_source || 'stable') == 'stable'", surface)
        self.assertIn("independent_surface_component_cache.py verify", surface)
        self.assertIn("--consumer", surface)
        self.assertIn("exit 1", surface)
        self.assertIn("surface-component-reuse.json", surface)
        self.assertNotIn("bootstrap/surface-runtime/build.py build", self.workflow())

    def test_surface_producer_artifact_is_verified_before_expensive_tool_setup(self):
        workflow = self.workflow()
        restore = workflow.index("Restore verified canonical Surface EROFS for QEMU")
        verify = workflow.index("Verify and bind canonical Surface EROFS for QEMU")
        intelligence = workflow.index("Resolve exact Intelligence builder for real local AI QEMU payload")
        go = workflow.index("Set up Go")
        broad_deps = workflow.index("Install bounded local AI build dependencies")
        self.assertLess(restore, verify)
        self.assertLess(verify, intelligence)
        self.assertLess(verify, go)
        self.assertLess(verify, broad_deps)
        self.assertLess(
            workflow.index("Validate portable-v2 QEMU contract"),
            verify,
        )
        self.assertLess(
            workflow.index("Resolve reusable component fingerprints"),
            restore,
        )
        minimal = self.step_block("Install minimal Surface EROFS verification tool")
        self.assertIn("steps.surface-artifact-cache.outputs.cache-hit == 'true'", minimal)
        self.assertIn("steps.surface-r2.outputs.hit == 'true'", minimal)
        self.assertIn("erofs-utils", minimal)
        self.assertIn("Never compile Surface inside the QEMU consumer", self.step_block(
            "Verify and bind canonical Surface EROFS for QEMU"
        ))
        self.assertEqual(
            workflow.count("      - name: Verify and bind canonical Surface EROFS for QEMU"),
            1,
        )

    def test_missing_surface_fails_before_any_expensive_qemu_component(self):
        workflow = self.workflow()
        early_gate = workflow.index("Verify and bind canonical Surface EROFS for QEMU")
        self.assertLess(early_gate, workflow.index("Build and verify exact local AI runtime on cache miss"))
        self.assertLess(early_gate, workflow.index("Build exact kernel and kernel modules on cache miss"))
        self.assertLess(early_gate, workflow.index("Build and verify canonical independent Buildroot base"))
        self.assertIn("exit 1", self.step_block("Verify and bind canonical Surface EROFS for QEMU"))

    def test_base_initramfs_and_runtime_proofs_remain_unconditional(self):
        for step in (
            "Build and verify canonical independent Buildroot base",
            "Build one initramfs pinned to the exact capsule and Stable Base",
            "Boot portable-v2 candidate PID1 in QEMU",
            "Prove armed candidate one-shot fallback in QEMU",
            "Prove invalid Ed25519 candidate, durable rollback and read-only rescue in QEMU",
            "Boot same portable-v2 disk through OVMF and systemd-boot",
        ):
            with self.subTest(step=step):
                block = self.step_block(step)
                self.assertNotRegex(block, r"\n\s+if:\s+steps\..*cache")

    def test_cached_local_ai_revalidates_original_build_commit_and_current_inputs(self):
        block = self.step_block("Verify local AI component and exact integration binding")
        self.assertIn("portable_component_cache.py verify", block)
        self.assertIn("--receipt \"$work/metadata/local-ai-cache-preflight.json\"", block)
        self.assertIn('manifest.get("build_source_commit")', block)
        self.assertIn('git worktree add --detach "$source" "$build_source_commit"', block)
        self.assertIn('ORDAX_SOURCE_COMMIT="$build_source_commit" python "$ORDAX_EXTERNAL_AI_BUILDER"', block)
        self.assertIn('"$source/bootstrap/local-ai-runtime/build.py" verify', block)
        self.assertIn("--integration-commit \"$ORDAX_SOURCE_COMMIT\"", block)
        self.assertIn("--cache-hit \"$cache_hit\"", block)

    def test_every_cache_hit_is_verified_without_rewriting_provenance(self):
        workflow = self.workflow()
        for component in ("local-ai", "kernel", "release-agent"):
            with self.subTest(component=component):
                self.assertIn(f"--component {component}", workflow)
                self.assertIn(f"{component}-component-reuse.json", workflow)
        self.assertIn("independent_surface_component_cache.py verify", workflow)
        self.assertIn("surface-component-reuse.json", workflow)
        helper = (ROOT / "tools/ci/portable_component_cache.py").read_text(encoding="utf-8")
        self.assertIn('"provenance_rewritten": False', helper)
        self.assertNotIn("provenance_path.write_text", helper)

    def test_reuse_receipts_remain_in_uploaded_exact_head_metadata(self):
        workflow = self.workflow()
        upload = self.step_block("Upload proof metadata only")
        self.assertIn("${{ runner.temp }}/portable-v2-qemu/metadata/", upload)
        self.assertIn("portable_component_cache.py verify", workflow)

    def test_current_source_tests_still_run_for_cached_release_agent(self):
        test_block = self.step_block("Test exact release-agent source")
        self.assertIn("go test -count=1 ./...", test_block)
        self.assertNotIn("cache-hit", test_block)

    def test_cache_owner_paths_trigger_proof_without_markdown_noise(self):
        workflow = self.workflow()
        for path in (
            "tests/test_portable_component_cache.py",
            "tests/test_portable_component_reuse_workflow.py",
            "tools/ci/portable_component_cache.py",
        ):
            self.assertEqual(workflow.count(f"- '{path}'"), 2, path)
        for exclusion in (
            "!bootstrap/kernel/**/*.md",
            "!bootstrap/surface-runtime/**/*.md",
            "!bootstrap/release-acquisition/**/*.md",
        ):
            self.assertEqual(workflow.count(f"- '{exclusion}'"), 2, exclusion)

if __name__ == "__main__":
    unittest.main()
