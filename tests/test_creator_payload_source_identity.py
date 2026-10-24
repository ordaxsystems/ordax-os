#!/usr/bin/env python3
"""Regress exact source identity across Creator payload/media proofs."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
ASSEMBLER = ROOT / "tools/creator/assemble.py"
FULL = ROOT / ".github/workflows/full-bootstrap-media-proof.yml"
PAYLOAD = ROOT / ".github/workflows/creator-payload-candidate.yml"
GROWTH = ROOT / "bootstrap/initramfs/prove_ext4_growth.sh"
PREPARED = ROOT / "tools/creator/proof/prove_prepared_ext4_growth.sh"

spec = importlib.util.spec_from_file_location("ordax_creator_assemble_identity", ASSEMBLER)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


class CreatorPayloadSourceIdentityTests(unittest.TestCase):
    def test_explicit_ordax_source_commit_has_priority_over_github_merge_sha(self):
        exact = "1" * 40
        merge = "2" * 40
        with mock.patch.dict(
            os.environ,
            {"ORDAX_SOURCE_COMMIT": exact, "GITHUB_SHA": merge},
            clear=False,
        ):
            self.assertEqual(module.source_commit(ROOT), exact)

    def test_invalid_explicit_source_commit_fails_closed(self):
        with mock.patch.dict(
            os.environ,
            {"ORDAX_SOURCE_COMMIT": "not-a-commit", "GITHUB_SHA": "2" * 40},
            clear=False,
        ):
            with self.assertRaisesRegex(module.AssembleError, "ORDAX_SOURCE_COMMIT"):
                module.source_commit(ROOT)

    def test_creator_workflows_bind_all_steps_to_exact_head_sha(self):
        for path in (FULL, PAYLOAD):
            text = path.read_text(encoding="utf-8")
            self.assertIn(
                "ORDAX_SOURCE_COMMIT: ${{ github.event.pull_request.head.sha || github.sha }}",
                text,
            )
        full = FULL.read_text(encoding="utf-8")
        self.assertNotIn("environ['GITHUB_SHA']", full)
        self.assertIn("environ['ORDAX_SOURCE_COMMIT']", full)

    def test_prepared_ext4_proof_uses_only_verified_independent_creator_source(self):
        source = PREPARED.read_text(encoding="utf-8")
        self.assertIn('CREATOR_SOURCE="${ORDAX_CREATOR_NATIVE_SOURCE:-}"', source)
        self.assertIn("docs/contracts/native-release-assembly.json", source)
        self.assertIn("ORDAX_CREATOR_SOURCE_COMMIT", source)
        self.assertIn("ORDAX_CREATOR_SOURCE_TREE", source)
        self.assertIn("git('rev-parse', 'HEAD^{tree}')", source)
        self.assertIn("git('status', '--porcelain', '--untracked-files=all')", source)
        self.assertIn('cd "$CREATOR_SOURCE"', source)
        self.assertIn("CREATOR_PREPARED_IMAGE_SOURCE=PINNED_INDEPENDENT", source)
        self.assertIn("CREATOR_PREPARED_PHYSICAL_WRITE=NOT_AUTHORIZED", source)
        self.assertNotIn('pushd "$ROOT/tools/creator"', source)
        self.assertIn('"creator_source_repository": "$ORDAX_CREATOR_SOURCE_REPOSITORY"', source)
        self.assertIn('"creator_source_commit": "$ORDAX_CREATOR_SOURCE_COMMIT"', source)
        self.assertIn('"creator_source_tree": "$ORDAX_CREATOR_SOURCE_TREE"', source)

    def test_media_proofs_prefer_explicit_ordax_source_identity(self):
        for path in (GROWTH, PREPARED):
            text = path.read_text(encoding="utf-8")
            self.assertIn(
                'SOURCE_COMMIT="${ORDAX_SOURCE_COMMIT:-${GITHUB_SHA:-unknown}}"',
                text,
            )


if __name__ == "__main__":
    unittest.main()
