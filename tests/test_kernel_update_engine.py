"""Future LTS patch discovery and update policy; no internet in unit tests."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "bootstrap/kernel/update_engine.py"
SPEC = importlib.util.spec_from_file_location("ordax_kernel_update_engine", PATH)
UPDATER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(UPDATER)


class KernelUpdateEngineTests(unittest.TestCase):
    def setUp(self):
        self.url = "https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.6.159.tar.xz"
        self.record = {"moniker": "longterm", "version": "6.6.159", "iseol": False,
                       "source": self.url,
                       "pgp": self.url.removesuffix(".xz").removesuffix(".tar") + ".tar.sign"}
        self.feed = {"releases": [
            {"moniker": "mainline", "version": "7.3-rc7", "iseol": False,
             "source": "untrusted", "pgp": None},
            {"moniker": "longterm", "version": "6.12.112", "iseol": False,
             "source": "ignore", "pgp": None},
            self.record
        ]}

    def test_latest_patch_is_selected_in_active_series_only(self):
        chosen = UPDATER.signed_feed_entry(self.feed, "6.6.158")
        self.assertEqual(chosen["version"], "6.6.159")
        self.assertEqual(chosen["source"], self.url)

    def test_unsupported_downgrade_mismatch_and_ambiguous_feed_fail(self):
        with self.assertRaises(UPDATER.UpdateError):
            UPDATER.signed_feed_entry(self.feed, "6.1.188")
        with self.assertRaises(UPDATER.UpdateError):
            UPDATER.signed_feed_entry(
                {"releases": [self.record, self.record]}, "6.6.158"
            )
        bad = dict(self.record, source="https://attacker.invalid/fake.tar.xz")
        with self.assertRaises(UPDATER.UpdateError):
            UPDATER.signed_feed_entry({"releases": [bad]}, "6.6.158")
        with self.assertRaises(UPDATER.UpdateError):
            UPDATER.signed_feed_entry({"releases": [dict(self.record, iseol=True)]}, "6.6.158")

    def test_reuses_signed_immutable_trust_without_auto_key_rotation(self):
        selected = {
            "configuration": {"base": "defconfig", "fragment": "bootstrap/kernel/config/ordax.fragment", "embedded_initramfs": False},
            "upstream_signature": {
                "algorithm": "openpgp-detached-tar",
                "trusted_primary_fingerprint": "647F28654894E3BD457199BE38DBBDC86092693E",
                "trusted_public_key_url": (
                    "https://kernel.googlesource.com/pub/scm/docs/kernel/pgpkeys/+/"
                    "9518bddaef900dd832e3e16be1d88923c620b749/keys/38DBBDC86092693E.asc?format=TEXT"
                ),
            },
        }
        candidate = UPDATER.candidate_record(
            {"version": "6.6.159", "source": self.url, "pgp": self.record["pgp"]},
            selected, "a" * 64
        )
        self.assertEqual(candidate["version"], "6.6.159")
        self.assertEqual(candidate["upstream_signature"], selected["upstream_signature"])
        self.assertFalse(candidate["build"]["physical_artifact_authorized"])
        self.assertFalse(candidate["build"]["pinned_environment_resolved"])

    def test_existing_reviewed_manifest_must_never_be_rewritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "6.6.159.json"
            self.assertTrue(UPDATER.write_exact(path, b"immutable\n"))
            self.assertFalse(UPDATER.write_exact(path, b"immutable\n"))
            with self.assertRaises(UPDATER.UpdateError):
                UPDATER.write_exact(path, b"changed\n")
            self.assertEqual(path.read_bytes(), b"immutable\n")

    def test_update_does_not_attempt_network_on_current_candidate(self):
        path, current = UPDATER.PIPELINE.select_candidate()
        feed = {"version": current["version"], "source": current["archive_url"],
                "pgp": current["signature_url"]}
        with mock.patch.object(UPDATER, "download_bounded", side_effect=AssertionError("network")):
            result = UPDATER.prepare_new_candidate(feed)
        self.assertEqual(result["status"], "up-to-date")


if __name__ == "__main__":
    unittest.main()
