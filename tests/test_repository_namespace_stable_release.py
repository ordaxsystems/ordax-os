"""Read-only, no-network regressions for the stable GitHub channel cutover gate."""
from __future__ import annotations

import copy
import importlib.util
import json
import os
from pathlib import Path
from unittest import TestCase, main, mock

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools/verify/repository_namespace_stable_release.py"
spec = importlib.util.spec_from_file_location("namespace_stable_release", SCRIPT)
gate = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(gate)


def post_transfer_contracts():
    owner = json.loads(
        (ROOT / "docs/contracts/repository-ownership.json").read_text(encoding="utf-8")
    )
    channel = json.loads(
        (ROOT / "docs/contracts/release-channel.json").read_text(encoding="utf-8")
    )
    owner["repositories"]["platform"]["repo"] = gate.REPOSITORY
    migration = owner["namespace_migration"]
    migration["current_namespace"] = "ordaxsystems"
    migration["status"] = "complete"
    migration["completed_transfers"] = ["runtime", "apps", "control_plane", "platform"]
    channel["source_authority"]["repository"] = gate.REPOSITORY
    channel["publication"]["latest_envelope_url"] = (
        f"https://github.com/{gate.REPOSITORY}/releases/latest/download/{gate.ENVELOPE_ASSET}"
    )
    return owner, channel


def metadata():
    tag = "v1.0.0"
    return {
        "draft": False,
        "prerelease": False,
        "published_at": "2026-10-08T00:00:00Z",
        "tag_name": tag,
        "html_url": f"https://github.com/{gate.REPOSITORY}/releases/tag/{tag}",
        "assets": [{
            "name": gate.ENVELOPE_ASSET,
            "state": "uploaded",
            "size": 512,
            "browser_download_url": (
                f"https://github.com/{gate.REPOSITORY}/releases/download/{tag}/{gate.ENVELOPE_ASSET}"
            ),
        }],
    }


class NamespaceStableReleaseGateTests(TestCase):
    def test_current_legacy_owner_rejected_without_network(self):
        owner, channel = post_transfer_contracts()
        owner["repositories"]["platform"]["repo"] = gate.REPOSITORY.replace(
            "ordaxsystems/", "washingtonmsdj/"
        )
        owner["namespace_migration"]["current_namespace"] = "washingtonmsdj"
        owner["namespace_migration"]["status"] = "in-progress"
        owner["namespace_migration"]["completed_transfers"].pop()
        with self.assertRaisesRegex(gate.StableReleaseError, "not physically cut over"):
            gate.validate_current_identity(owner, channel, {
                "GITHUB_REPOSITORY": gate.REPOSITORY,
                "GITHUB_REPOSITORY_ID": gate.REPOSITORY_ID,
            })

    def test_posttransfer_requires_original_repo_id(self):
        owner, channel = post_transfer_contracts()
        good = {"GITHUB_REPOSITORY": gate.REPOSITORY, "GITHUB_REPOSITORY_ID": gate.REPOSITORY_ID}
        self.assertEqual(gate.validate_current_identity(owner, channel, good), gate.REPOSITORY)
        for drift in [
            {"GITHUB_REPOSITORY": gate.REPOSITORY.replace("ordaxsystems/", "washingtonmsdj/")},
            {"GITHUB_REPOSITORY_ID": "0"},
        ]:
            with self.subTest(drift=drift), self.assertRaises(gate.StableReleaseError):
                gate.validate_current_identity(owner, channel, {**good, **drift})

    def test_posttransfer_rejects_incomplete_ssot_and_unsigned_policy(self):
        owner, channel = post_transfer_contracts()
        good = {"GITHUB_REPOSITORY": gate.REPOSITORY, "GITHUB_REPOSITORY_ID": gate.REPOSITORY_ID}
        owner["namespace_migration"]["completed_transfers"].pop()
        with self.assertRaises(gate.StableReleaseError):
            gate.validate_current_identity(owner, channel, good)
        owner, channel = post_transfer_contracts()
        channel["release"]["manifest_authenticity_required_before_production"] = False
        with self.assertRaisesRegex(gate.StableReleaseError, "signed manifest requirement"):
            gate.validate_current_identity(owner, channel, good)

    def test_only_one_uploaded_envelope_in_actual_stable_release(self):
        actual = gate.verify_stable_release_metadata(metadata(), gate.REPOSITORY)
        self.assertEqual(actual["tag"], "v1.0.0")
        self.assertEqual(actual["asset"], gate.ENVELOPE_ASSET)
        self.assertEqual(actual["size"], 512)

    def test_missing_stable_prerelease_draft_and_empty_published_are_denied(self):
        for change in (
            {"draft": True},
            {"prerelease": True},
            {"published_at": None},
            {"tag_name": "../unsafe"},
            {"html_url": "https://github.com/other/prototipo-ordax-os/releases/tag/v1.0.0"},
        ):
            candidate = {**metadata(), **change}
            with self.subTest(change=change), self.assertRaises(gate.StableReleaseError):
                gate.verify_stable_release_metadata(candidate, gate.REPOSITORY)

    def test_missing_duplicate_external_or_partial_envelope_rejected(self):
        baseline = metadata()
        for artifacts in (
            [],
            baseline["assets"] * 2,
            [{**baseline["assets"][0], "size": 0}],
            [{**baseline["assets"][0], "state": "new"}],
            [{**baseline["assets"][0], "browser_download_url": "https://evil.example/asset"}],
            [{"name": "not-release-envelope.json", "size": 512, "state": "uploaded"}],
        ):
            with self.subTest(artifacts=artifacts), self.assertRaises(gate.StableReleaseError):
                gate.verify_stable_release_metadata({**baseline, "assets": artifacts}, gate.REPOSITORY)

    def test_current_owner_blocks_cli_before_http_request(self):
        from tempfile import TemporaryDirectory
        owner, channel = post_transfer_contracts()
        owner["repositories"]["platform"]["repo"] = gate.REPOSITORY.replace(
            "ordaxsystems/", "washingtonmsdj/"
        )
        owner["namespace_migration"]["current_namespace"] = "washingtonmsdj"
        owner["namespace_migration"]["status"] = "in-progress"
        owner["namespace_migration"]["completed_transfers"].pop()
        with TemporaryDirectory() as temporary:
            fake_root = Path(temporary)
            contracts = fake_root / "docs/contracts"
            contracts.mkdir(parents=True)
            (contracts / "repository-ownership.json").write_text(json.dumps(owner))
            (contracts / "release-channel.json").write_text(json.dumps(channel))
            with mock.patch.object(gate, "ROOT", fake_root):
                with mock.patch.object(gate, "fetch_github_latest", side_effect=AssertionError("HTTP must not occur")):
                    with mock.patch.dict(os.environ, {
                        "GITHUB_REPOSITORY": gate.REPOSITORY,
                        "GITHUB_REPOSITORY_ID": gate.REPOSITORY_ID,
                    }):
                        self.assertEqual(gate.main(), 1)

    def test_metadata_is_not_misrepresented_as_crypto_verification(self):
        workflow = (ROOT / ".github/workflows/repository-namespace-transfer-preflight.yml").read_text()
        self.assertIn("repository_namespace_stable_release.py", workflow)
        self.assertIn("go run . inspect", workflow)
        self.assertIn("--repository \"$GITHUB_REPOSITORY\"", workflow)
        self.assertIn("release-ed25519.json", workflow)
        self.assertIn("github.repository == 'ordaxsystems/prototipo-ordax-os'", workflow)
        self.assertIn("github.repository == 'ordaxsystems/ordax-os'", workflow)
        self.assertIn("--require-cutover", workflow)
        self.assertIn(
            "github.ref == 'refs/heads/main' && github.event_name != 'pull_request'",
            workflow,
        )
        signed_gate = workflow.split(
            "- name: Require published stable Ed25519-signed release after transfer", 1
        )[1]
        self.assertIn("github.ref == 'refs/heads/main'", signed_gate)
        self.assertIn("github.event_name != 'pull_request'", signed_gate)
        self.assertIn("go run . inspect", signed_gate)
        self.assertIn("--trust ../../bootstrap/trust/release-ed25519.json", signed_gate)


if __name__ == "__main__":
    main()
