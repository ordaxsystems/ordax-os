from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CREATOR_PAYLOAD = ROOT / ".github/workflows/creator-payload-candidate.yml"
CACHE_SHA = "55cc8345863c7cc4c66a329aec7e433d2d1c52a9"


class CreatorKernelReuseWorkflowTests(unittest.TestCase):
    def workflow(self) -> str:
        return CREATOR_PAYLOAD.read_text(encoding="utf-8")

    def step_block(self, text: str, name: str) -> str:
        marker = f"      - name: {name}\n"
        start = text.index(marker)
        next_step = text.find("\n      - name: ", start + len(marker))
        if next_step < 0:
            next_step = len(text)
        return text[start:next_step]

    def test_creator_payload_reuses_only_verified_kernel_bytes(self):
        workflow = self.workflow()
        self.assertEqual(workflow.count(f"actions/cache/restore@{CACHE_SHA}"), 1)
        self.assertEqual(workflow.count(f"actions/cache/save@{CACHE_SHA}"), 1)
        self.assertNotIn("restore-keys:", workflow)
        self.assertIn("ORDAX_COMPONENT_CACHE_ENVIRONMENT", workflow)
        self.assertIn("${ImageOS}", workflow)
        self.assertIn("${ImageVersion}", workflow)
        self.assertIn("portable_component_cache.py fingerprints", workflow)

        build = self.step_block(workflow, "Build kernel candidate on verified cache miss")
        self.assertIn("if: steps.kernel-cache.outputs.cache-hit != 'true'", build)
        self.assertIn("bootstrap/kernel/build.py build --jobs 4", build)

        verify = self.step_block(
            workflow,
            "Verify kernel component and exact integration binding",
        )
        self.assertNotIn("if: steps.kernel-cache", verify)
        self.assertIn("bootstrap/kernel/verify.py out/kernel", verify)
        self.assertIn("portable_component_cache.py record", verify)
        self.assertIn("portable_component_cache.py verify", verify)
        self.assertIn("--component kernel", verify)
        self.assertIn("--integration-commit", verify)
        self.assertIn("kernel-component-reuse.json", verify)

    def test_creator_payload_never_uses_a_fallback_cache_key(self):
        workflow = self.workflow()
        restore = self.step_block(workflow, "Restore verified kernel component")
        self.assertNotIn("restore-keys:", restore)
        self.assertIn("steps.component-fingerprints.outputs.kernel", restore)

    def test_payload_assembly_and_non_destructive_gates_are_never_cache_skipped(self):
        workflow = self.workflow()
        for step in (
            "Assemble and verify canonical complete Creator payload",
            "Assert canonical payload is complete and non-destructive",
            "Prove complete payload crosses only non-destructive Creator gates",
        ):
            block = self.step_block(workflow, step)
            self.assertNotIn("cache-hit", block)


if __name__ == "__main__":
    unittest.main()
