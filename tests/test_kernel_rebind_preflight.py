"""Canonical kernel rebind cannot bypass two-build provenance or pinned media."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bootstrap/kernel"))
import rebind_preflight as stage

COMMIT = "a" * 40


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


class KernelRebindPreflightTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "repo"
        self.first = Path(self.tmp.name) / "first"
        self.second = Path(self.tmp.name) / "second"
        for path in (
            "bootstrap/kernel/source.json",
            "bootstrap/kernel/config/ordax.fragment",
            "docs/contracts/minimal-bootstrap.json",
            "system/base-update/candidate.json",
        ):
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / path, target)
        self.source = json.loads((self.root / "bootstrap/kernel/source.json").read_text())
        self._candidate(self.first)
        self._candidate(self.second)

    def _candidate(self, directory: Path, *, bytes_changed=False, source_commit=COMMIT, status="verified-build-environment"):
        directory.mkdir(parents=True, exist_ok=True)
        version = self.source["version"]
        artifacts = {
            f"kernel-{version}.config": b"CONFIG_FOO=y\n",
            f"kernel-modules-{version}.tar": b"independent synthetic module archive",
            f"vmlinuz-{version}": b"reproducible synthetic kernel" + (b" DIFFERENT" if bytes_changed else b""),
        }
        for name, raw in artifacts.items():
            (directory / name).write_bytes(raw)
        source_digest = stage.kernel_verify.sha256_file(self.root / "bootstrap/kernel/source.json")
        fragment_digest = stage.kernel_verify.sha256_file(self.root / "bootstrap/kernel/config/ordax.fragment")
        source = self.source
        provenance = {
            "$schema": "prototype-ordax.kernel-provenance/1",
            "status": status,
            "source_commit": source_commit,
            "kernel_version": version,
            "source_contract_sha256": source_digest,
            "fragment_sha256": fragment_digest,
            "upstream_archive_sha256": source["archive_sha256"],
            "build_environment": {"immutable_environment_pinned": True},
            "physical_artifact_authorized": False,
            "promotable_to_physical": False,
            "upstream_authentication": {
                "status": "verified",
                "kernel_version": version,
                "archive_sha256": source["archive_sha256"],
                "source_contract_sha256": source_digest,
                "trusted_primary_fingerprint": source["upstream_signature"]["trusted_primary_fingerprint"],
            },
            "artifacts": {name: digest(raw) for name, raw in artifacts.items()},
        }
        (directory / "kernel-provenance.json").write_text(
            json.dumps(provenance, sort_keys=True) + "\n", encoding="utf-8"
        )
        artifacts["kernel-provenance.json"] = (directory / "kernel-provenance.json").read_bytes()
        (directory / "SHA256SUMS").write_text(
            "".join(f"{digest(raw)}  {name}\n" for name, raw in sorted(artifacts.items())),
            encoding="utf-8",
        )

    def _patch_provenance(self, directory: Path, change):
        file = directory / "kernel-provenance.json"
        value = json.loads(file.read_text(encoding="utf-8"))
        change(value)
        file.write_text(json.dumps(value, sort_keys=True) + "\n", encoding="utf-8")
        lines = (directory / "SHA256SUMS").read_text().splitlines()
        lines = [
            f"{stage.kernel_verify.sha256_file(file)}  kernel-provenance.json"
            if line.endswith("  kernel-provenance.json") else line
            for line in lines
        ]
        (directory / "SHA256SUMS").write_text("\n".join(lines) + "\n")

    def _plan(self):
        return stage.plan(self.root, self.first, self.second, COMMIT)

    def test_two_identical_signed_source_builds_emit_inert_candidate_only(self):
        media = self.root / "docs/contracts/minimal-bootstrap.json"
        update = self.root / "system/base-update/candidate.json"
        before = (media.read_bytes(), update.read_bytes())
        output = self._plan()
        self.assertEqual(output["status"], "candidate-needs-release-proofs")
        self.assertEqual(output["source_commit"], COMMIT)
        self.assertTrue(output["independent_byte_identical_builds"])
        self.assertFalse(output["manual_hash_substitution_authorized"])
        self.assertFalse(output["physical_write_authorized"])
        self.assertFalse(output["signed_release_published"])
        self.assertIn("docs/contracts/minimal-bootstrap.json", output["proposed_binding_paths"])
        self.assertIn("system/base-update/candidate.json", output["proposed_binding_paths"])
        self.assertNotEqual(output["current_kernel_sha256"], output["candidate_kernel_sha256"])
        self.assertEqual((media.read_bytes(), update.read_bytes()), before)
        self.assertFalse((self.root / f"bootstrap/kernel/vmlinuz-{self.source['version']}").exists())

    def test_corrupted_kernel_byte_rejected_before_any_proposal(self):
        with (self.second / f"vmlinuz-{self.source['version']}").open("ab") as out:
            out.write(b"tampered")
        with self.assertRaisesRegex(stage.RebindError, "invalid kernel candidate"):
            self._plan()

    def test_two_independently_valid_but_different_builds_fail(self):
        self._candidate(self.second, bytes_changed=True)
        with self.assertRaisesRegex(stage.RebindError, "independent kernel build digests differ"):
            self._plan()

    def test_forged_or_wrong_source_commit_is_rejected(self):
        with self.assertRaisesRegex(stage.RebindError, "reviewed exact 40-hex"):
            stage.plan(self.root, self.first, self.second, "main")
        with self.assertRaisesRegex(stage.RebindError, "source commit"):
            stage.plan(self.root, self.first, self.second, "b" * 40)
        self._patch_provenance(self.second, lambda p: p.update(source_commit="b" * 40))
        with self.assertRaisesRegex(stage.RebindError, "source commit"):
            self._plan()

    def test_unpinned_environment_and_unverified_upstream_are_rejected(self):
        self._patch_provenance(
            self.first,
            lambda p: p["build_environment"].update(immutable_environment_pinned=False),
        )
        with self.assertRaisesRegex(stage.RebindError, "environment was not pinned"):
            self._plan()
        self._candidate(self.first)
        self._patch_provenance(
            self.second, lambda p: p["upstream_authentication"].update(status="skipped")
        )
        with self.assertRaisesRegex(stage.RebindError, "upstream authentication"):
            self._plan()

    def test_source_or_fragment_drift_is_rejected(self):
        fragment = self.root / "bootstrap/kernel/config/ordax.fragment"
        fragment.write_text(fragment.read_text() + "\n# changed after build\n")
        with self.assertRaisesRegex(stage.RebindError, "fragment digest mismatch"):
            self._plan()

    def test_creator_and_ab_disagreement_is_rejected(self):
        path = self.root / "system/base-update/candidate.json"
        value = json.loads(path.read_text())
        value["kernel_sha256"] = "0" * 64
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(stage.RebindError, "pins already disagree"):
            self._plan()

    def test_shared_artifact_inode_and_linked_build_roots_are_rejected(self):
        with self.assertRaisesRegex(stage.RebindError, "two distinct"):
            stage.plan(self.root, self.first, self.first, COMMIT)
        file = f"vmlinuz-{self.source['version']}"
        (self.second / file).unlink()
        os.link(self.first / file, self.second / file)
        with self.assertRaisesRegex(stage.RebindError, "share an inode"):
            self._plan()

    def test_proposal_cannot_claim_physical_release(self):
        self._patch_provenance(
            self.first, lambda p: p.update(physical_artifact_authorized=True)
        )
        with self.assertRaisesRegex(stage.RebindError, "physically authorized"):
            self._plan()

    def test_missing_or_symlinked_media_contract_is_rejected(self):
        path = self.root / "docs/contracts/minimal-bootstrap.json"
        target = path.with_name("indirect.json")
        path.rename(target)
        path.symlink_to(target)
        with self.assertRaisesRegex(stage.RebindError, "missing, linked"):
            self._plan()


if __name__ == "__main__":
    unittest.main()
