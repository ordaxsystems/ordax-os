from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PORTABLE = (ROOT / ".github/workflows/portable-v2-qemu-boot-proof.yml").read_text(encoding="utf-8")
SURFACE = (ROOT / ".github/workflows/independent-surface-runtime.yml").read_text(encoding="utf-8")


class IndependentSurfaceQemuBindingTests(unittest.TestCase):
    def test_surface_workflow_calls_canonical_portable_proof_after_build(self):
        for marker in (
            "portable-qemu:",
            "needs: buildroot-surface",
            "uses: ./.github/workflows/portable-v2-qemu-boot-proof.yml",
            "base_source: independent",
            "surface_source: independent",
            "force_run: true",
            "if-no-files-found: error",
        ):
            self.assertIn(marker, SURFACE)
        self.assertNotIn("qemu-system-x86_64", SURFACE)

    def test_canonical_workflow_consumes_same_run_buildroot_artifact(self):
        for marker in (
            "surface_source:",
            "same-run verified independent Buildroot Surface artifact",
            "Download same-run independent Surface runtime",
            "actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333",
            "ordax-independent-surface-runtime-${{ github.run_id }}",
            "bootstrap/independent-surface-runtime/build.py verify",
            "provenance['source_commit'] == expected",
            "ORDAX_INDEPENDENT_SURFACE_PROVENANCE=VERIFIED",
            "ORDAX_INDEPENDENT_SURFACE_ARTIFACT_BINDING=VERIFIED",
            "native-surface-runtime-buildroot.erofs",
            'target="$work/surface-runtime/native-surface-runtime.erofs"',
            'test "$source_sha" = "$target_sha"',
            'test "$source_sha" = "$provenance_sha"',
        ):
            self.assertIn(marker, PORTABLE)

    def test_independent_binding_does_not_rebuild_alpine_surface(self):
        independent = PORTABLE.split(
            "      - name: Download same-run independent Surface runtime", 1
        )[1].split("      - name: Restore verified release-agent component", 1)[0]
        self.assertNotIn("bootstrap/surface-runtime/build.py build", independent)
        self.assertNotIn("actions/cache/restore", independent)
        self.assertIn("bootstrap/independent-surface-runtime/build.py verify", independent)
        self.assertIn("native-surface-runtime-buildroot.erofs", independent)
        self.assertIn("native-surface-runtime.erofs", independent)

    def test_stable_surface_path_remains_default_and_separate(self):
        self.assertIn("default: stable", PORTABLE)
        self.assertIn("Restore verified Surface runtime component", PORTABLE)
        self.assertIn("Build exact offline Surface runtime on cache miss", PORTABLE)
        self.assertIn("bootstrap/surface-runtime/build.py build", PORTABLE)
        self.assertIn("bootstrap/surface-runtime/build.py verify", PORTABLE)
        self.assertIn("(inputs.surface_source || 'stable') == 'stable'", PORTABLE)

    def test_invalid_cross_mode_combination_fails_closed(self):
        self.assertIn(
            "independent Surface proof currently requires the independent base candidate",
            PORTABLE,
        )
        self.assertIn("unsupported Surface proof source", PORTABLE)


if __name__ == "__main__":
    unittest.main()
