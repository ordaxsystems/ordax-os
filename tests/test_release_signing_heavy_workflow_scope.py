import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

HEAVY_WORKFLOWS = (
    ".github/workflows/base-update-fat32-proof.yml",
    ".github/workflows/portable-release-image.yml",
    ".github/workflows/portable-boot-handoff-proof.yml",
    ".github/workflows/full-bootstrap-media-proof.yml",
    ".github/workflows/portable-v2-qemu-boot-proof.yml",
    ".github/workflows/creator-owner-dev-git.yml",
    ".github/workflows/local-ai-runtime-candidate.yml",
)

SIGNER_SOURCE_BOUND_HEAVY_WORKFLOWS = tuple(
    relative
    for relative in HEAVY_WORKFLOWS
    if relative != ".github/workflows/full-bootstrap-media-proof.yml"
)
CANONICAL_TRUST_BOUND_WORKFLOW = ".github/workflows/full-bootstrap-media-proof.yml"

BROAD_OWNER_WORKFLOWS = (
    ".github/workflows/release-signing.yml",
    ".github/workflows/release-pipeline.yml",
    ".github/workflows/windows-prototype-toolkit.yml",
)

ADMIN_EXCLUDES = (
    "!tools/release-signing/windows/**",
    "!tools/release-signing/promote_public_trust.py",
    "!tools/release-signing/cmd/ordax-physical-release-signing/**",
    "!tools/release-signing/README.md",
)


class ReleaseSigningHeavyWorkflowScopeTests(unittest.TestCase):
    def test_heavy_media_workflows_ignore_administrative_trust_only_changes(self):
        for relative in SIGNER_SOURCE_BOUND_HEAVY_WORKFLOWS:
            text = (ROOT / relative).read_text(encoding="utf-8")
            self.assertIn("tools/release-signing/**", text, relative)
            for excluded in ADMIN_EXCLUDES:
                self.assertIn(excluded, text, f"{relative}: {excluded}")

        canonical = (ROOT / CANONICAL_TRUST_BOUND_WORKFLOW).read_text(
            encoding="utf-8"
        )
        self.assertIn("bootstrap/trust/**", canonical)
        self.assertNotIn("tools/release-signing/**", canonical)
        for excluded in ADMIN_EXCLUDES:
            self.assertNotIn(excluded, canonical)

    def test_local_ai_runtime_still_tracks_canonical_release_signer(self):
        relative = ".github/workflows/local-ai-runtime-candidate.yml"
        text = (ROOT / relative).read_text(encoding="utf-8")
        canonical = "- 'tools/release-signing/**'"
        self.assertIn(canonical, text)
        self.assertLess(
            text.index(canonical),
            text.index("- '!tools/release-signing/cmd/ordax-physical-release-signing/**'"),
        )
        # Only administrative and unrelated physical-signer paths are excluded.
        # The canonical release signer, manifest builder, and acquisition proof
        # remain direct trigger inputs for Local AI reproducibility.
        self.assertNotIn("!tools/release-signing/main.go", text)
        self.assertNotIn("!tools/release-signing/trust_transition.go", text)
        self.assertIn("- 'tools/release-manifest/**'", text)
        self.assertIn("- 'bootstrap/release-acquisition/**'", text)
        self.assertIn("- 'bootstrap/local-ai-runtime/**'", text)

    def test_dedicated_signing_and_toolkit_owners_remain_broad(self):
        for relative in BROAD_OWNER_WORKFLOWS:
            text = (ROOT / relative).read_text(encoding="utf-8")
            self.assertIn("tools/release-signing/**", text, relative)
            self.assertNotIn(
                "!tools/release-signing/promote_public_trust.py",
                text,
                relative,
            )

    def test_heavy_media_jobs_do_not_execute_administrative_trust_tools(self):
        forbidden = (
            "promote_public_trust.py",
            "Initialize-OrdaXReleaseTrust.ps1",
            "Complete-OrdaXReleaseTrust.ps1",
            "ordax-physical-release-signing",
        )
        for relative in HEAVY_WORKFLOWS:
            body = (ROOT / relative).read_text(encoding="utf-8")
            executable_body = "\n".join(
                line
                for line in body.splitlines()
                if not line.strip().startswith("- '!tools/release-signing/")
            )
            for token in forbidden:
                self.assertNotIn(
                    token,
                    executable_body,
                    f"{relative}: {token}",
                )


if __name__ == "__main__":
    unittest.main()
