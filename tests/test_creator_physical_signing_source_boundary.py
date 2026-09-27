from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
PUBLISHER = ROOT / "tools/release-signing/windows/8-Sign-Publish-CreatorPhysical.ps1"


class CreatorPhysicalSigningSourceBoundaryTests(unittest.TestCase):
    def test_private_key_gate_requires_exact_clean_candidate_checkout(self):
        text = PUBLISHER.read_text(encoding="utf-8")

        required = (
            "physical_write_authorization_sha256",
            "Candidate physical authorization SHA-256 differs from provenance",
            "Get-Command git",
            "rev-parse HEAD",
            "status --porcelain=v1 --untracked-files=no",
            "Signing checkout HEAD differs from candidate writer source commit",
            "Signing checkout contains tracked changes",
            "computed_authorization_context_sha256",
            "authorization_context_sha256",
            "Current authorization context differs from the candidate-authorized context",
            "canonical_v4_release_source_commit",
            "Current canonical release binding differs from the candidate provenance",
        )
        for marker in required:
            self.assertIn(marker, text)

        source_gate = text.index("# Bind the signing checkout to the exact candidate source before the private key is resolved.")
        promotion_gate = text.index("# Re-evaluate the exact source-controlled authorization context immediately before the private key is touched.")
        private_key_resolution = text.index("$PrivateKeyPath = Resolve-RealLeaf $PrivateKeyPath 'Canonical private key'")
        signer_invocation = text.index("--private-key $PrivateKeyPath")

        self.assertLess(source_gate, promotion_gate)
        self.assertLess(promotion_gate, private_key_resolution)
        self.assertLess(private_key_resolution, signer_invocation)


if __name__ == "__main__":
    unittest.main()
