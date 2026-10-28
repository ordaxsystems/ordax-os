#!/usr/bin/env python3
"""C6 Owner source cutover: OS produces the media; pinned Creator owns Go."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/creator-owner-dev-git.yml"
SOURCE_CONTRACT = ROOT / "docs/contracts/native-release-assembly.json"


class CreatorOwnerExternalSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")
        cls.stage = (ROOT / "tools/creator/owner_dev_stage.sh").read_text(encoding="utf-8")
        cls.raw = (ROOT / "tools/creator/owner_dev_raw.py").read_text(encoding="utf-8")
        cls.source = json.loads(SOURCE_CONTRACT.read_text(encoding="utf-8"))["creator_source"]

    def test_immutable_standalone_checkout_and_only_one_go_source(self):
        w = self.workflow
        self.assertEqual(self.source["repository"], "ordaxsystems/ordax-creator")
        self.assertEqual(self.source["publisher_authority"], "ordaxsystems/ordax-os")
        self.assertIs(self.source["physical_apply_authorized"], False)
        self.assertEqual(w.count("uses: ./.github/actions/resolve-creator-source"), 1)
        self.assertIn('git -C "$creator" rev-parse HEAD', w)
        self.assertIn("rev-parse 'HEAD^{tree}'", w)
        self.assertIn('ORDAX_OS_CONTRACTS_DIR="$GITHUB_WORKSPACE/docs/contracts" go test', w)
        self.assertIn('pushd "$ORDAX_CREATOR_NATIVE_SOURCE"', w)
        self.assertNotIn("cd tools/creator && go test", w)
        self.assertNotIn("pushd tools/creator", w)
        self.assertNotIn("go run ./cmd/ordax-creator", w)

    def test_exact_cli_and_non_destructive_payload(self):
        w = self.workflow
        self.assertIn('"$RUNNER_TEMP/owner-creator-cli/ordax-creator"', w)
        self.assertIn("bash tools/creator/owner_dev_stage.sh", w)
        self.assertIn('creator_cli="$4"', self.stage)
        self.assertIn('test -x "$creator_cli"', self.stage)
        self.assertIn('"$creator_cli" verify-payload', self.stage)
        self.assertIn('"$creator_cli" stage-tree', self.stage)
        self.assertIn("PAYLOAD_VERIFIED=YES", self.stage)
        self.assertIn("DISPOSABLE_TREE_STAGED=YES", self.stage)
        self.assertEqual(self.stage.count("PHYSICAL_WRITE_STATUS=blocked"), 2)
        self.assertIn("ORDAX_OWNER_SOURCE_COMMIT: ${{ github.event.pull_request.head.sha || github.sha }}", w)
        self.assertIn("invalid independently pinned Creator version", w)
        self.assertIn('ORDAX_CREATOR_PRODUCT_VERSION', w)
        self.assertNotIn("tools/creator/version.json", w)
        self.assertIn("'creator_source_repository': os.environ['ORDAX_CREATOR_SOURCE_REPOSITORY']", w)
        self.assertIn("'creator_source_commit': os.environ['ORDAX_CREATOR_SOURCE_COMMIT']", w)
        self.assertIn("'creator_source_tree': os.environ['ORDAX_CREATOR_SOURCE_TREE']", w)

    def test_os_authority_and_writer_gate_unchanged(self):
        w = self.workflow
        for marker in (
            "bash tools/creator/owner_dev_stage.sh",
            "tools/creator/owner_dev_raw.py",
            "tools/creator/proof/owner_qemu_offline_boot.py",
            "tools/creator/verify_owner_dev_bundle.py",
            "system/services/surface-source/owner-stage.sh ready",
            "gh release upload creator-owner-prototype",
            "if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
            "-tags 'ordax_raw_backend'",
            "-tags 'ordax_owner_prototype'",
            "-X main.buildStorageProfile=owner-development",
        ):
            self.assertIn(marker, w)
        for marker in (
            "python3 tools/creator/assemble.py build",
            "python3 tools/creator/assemble.py verify",
            "grep -Fxq 'PHYSICAL_WRITE_STATUS=blocked'",
        ):
            self.assertIn(marker, self.stage)
        self.assertIn("tools/creator/proof/disposable_media.py", self.raw)
        self.assertEqual(w.count("gh release upload creator-owner-prototype"), 1)
        self.assertIn(".github/actions/resolve-creator-source/**", w)
        self.assertIn("docs/contracts/native-release-assembly.json", w)


if __name__ == "__main__":
    unittest.main()
