import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

WORKFLOWS = {
    "system": ROOT / ".github/workflows/portable-release-image.yml",
    "surface": ROOT / ".github/workflows/independent-surface-runtime.yml",
    "local-ai": ROOT / ".github/workflows/local-ai-runtime-candidate.yml",
}


class CanonicalV4OperatorInputsTests(unittest.TestCase):
    def test_real_erofs_bytes_are_exported_only_for_manual_operator_runs(self):
        texts = {name: path.read_text(encoding="utf-8") for name, path in WORKFLOWS.items()}

        self.assertIn("workflow_dispatch:", texts["system"])
        self.assertIn("canonical-v4-operator-system-${{ github.sha }}", texts["system"])
        self.assertIn("${{ runner.temp }}/portable-release/a/system.erofs", texts["system"])
        self.assertIn("operator_receipt.py", texts["system"])
        self.assertIn("operator-receipt.json", texts["system"])

        self.assertIn("workflow_dispatch:", texts["surface"])
        self.assertIn("canonical-v4-operator-surface-${{ github.sha }}", texts["surface"])
        self.assertIn("native-surface-runtime.erofs", texts["surface"])
        self.assertIn("operator_receipt.py", texts["surface"])
        self.assertIn("operator-receipt.json", texts["surface"])

        self.assertIn("workflow_dispatch:", texts["local-ai"])
        self.assertIn("canonical-v4-operator-local-ai-${{ github.sha }}", texts["local-ai"])
        self.assertIn("local-ai-runtime.erofs", texts["local-ai"])
        self.assertIn("system/services/local-ai/source-lock.json", texts["local-ai"])
        self.assertIn("operator_receipt.py", texts["local-ai"])
        self.assertIn("operator-receipt.json", texts["local-ai"])

        for name, text in texts.items():
            with self.subTest(workflow=name):
                self.assertIn("github.event_name == 'workflow_dispatch'", text)
                self.assertIn("retention-days: 1", text)
                self.assertNotIn("ordax-release-private.pem", text)
                self.assertNotIn("canonical-v4-operator-private", text)
                self.assertIn("--source-commit \"$GITHUB_SHA\"", text)

    def test_normal_ci_still_does_not_preserve_surface_or_ai_runtime_bytes(self):
        surface = WORKFLOWS["surface"].read_text(encoding="utf-8")
        local_ai = WORKFLOWS["local-ai"].read_text(encoding="utf-8")

        self.assertIn(
            "if: github.event_name != 'workflow_dispatch'\n        run: |",
            surface,
        )
        self.assertIn(
            "if: always() && github.event_name != 'workflow_dispatch'\n        run: |",
            local_ai,
        )
        self.assertIn("rm -f", surface)
        self.assertIn("rm -f", local_ai)

    def test_operator_artifacts_are_not_claimed_as_canonical_publication(self):
        system = WORKFLOWS["system"].read_text(encoding="utf-8")
        local_ai = WORKFLOWS["local-ai"].read_text(encoding="utf-8")
        self.assertIn("SYSTEM_EROFS_ARTIFACT_PUBLISHED_AS_RELEASE=NO", system)
        self.assertIn("LOCAL_AI_RUNTIME_PUBLISHED=NO", local_ai)
        self.assertIn("PHYSICAL_WRITE_AUTHORIZED=NO", local_ai)


if __name__ == "__main__":
    unittest.main()
