from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "system" / "surface" / "runtime" / "native_store_catalog.py"
_spec = importlib.util.spec_from_file_location("native_store_catalog", MODULE_PATH)
store = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(store)

COMMIT = "a" * 40


def artifact(name: str, char: str) -> dict:
    return {"name": name, "sha256": char * 64, "size": 123}


def verified(sequence: int = 7, digest: str | None = None) -> dict:
    return {
        "schema": "ordax.verified-app-store-catalog/1",
        "state": "ready",
        "sequence": sequence,
        "catalogSha256": digest or (f"{sequence:x}"[-1] * 64),
        "source": {
            "repository": "washingtonmsdj/ordax-apps",
            "commit": COMMIT,
        },
        "trust": {
            "domain": "runtime-components",
            "keyId": "ordax-runtime-components-v1",
        },
        "entries": [
            {
                "appId": "notes",
                "title": "Notas",
                "version": "0.4.3",
                "releaseMode": "component-slot",
                "sourceCommit": COMMIT,
                "artifacts": {
                    "package": artifact("notes.zip", "b"),
                    "release": artifact("notes.release.json", "c"),
                    "compatibility": artifact("notes.compatibility.json", "d"),
                },
            }
        ],
        "reason": None,
        "authority": "none",
    }


class NativeStoreCatalogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.watermark = self.root / "store-catalog-watermark.json"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_first_catalog_persists_watermark_and_exact_replay_is_idempotent(self) -> None:
        catalog = verified(7, "7" * 64)
        accepted, changed = store.accept_verified_catalog(catalog, self.watermark)
        self.assertTrue(changed)
        self.assertEqual(accepted, catalog)
        self.assertEqual(
            json.loads(self.watermark.read_text(encoding="utf-8")),
            {
                "schema": "ordax.store-catalog-watermark/1",
                "sequence": 7,
                "catalogSha256": "7" * 64,
            },
        )

        replay, changed = store.accept_verified_catalog(catalog, self.watermark)
        self.assertFalse(changed)
        self.assertEqual(replay, catalog)

    def test_lower_sequence_and_equal_sequence_different_digest_fail_closed(self) -> None:
        store.accept_verified_catalog(verified(8, "8" * 64), self.watermark)

        with self.assertRaisesRegex(store.StoreCatalogReplayError, "rollback"):
            store.accept_verified_catalog(verified(7, "7" * 64), self.watermark)

        with self.assertRaisesRegex(store.StoreCatalogReplayError, "equivocation"):
            store.accept_verified_catalog(verified(8, "9" * 64), self.watermark)

        persisted = json.loads(self.watermark.read_text(encoding="utf-8"))
        self.assertEqual(persisted["sequence"], 8)
        self.assertEqual(persisted["catalogSha256"], "8" * 64)

    def test_higher_sequence_advances_watermark_only_after_validation(self) -> None:
        store.accept_verified_catalog(verified(7, "7" * 64), self.watermark)
        invalid = verified(8, "8" * 64)
        invalid["authority"] = "platform-component-lifecycle"
        with self.assertRaisesRegex(store.StoreCatalogError, "authority:none"):
            store.accept_verified_catalog(invalid, self.watermark)

        persisted = json.loads(self.watermark.read_text(encoding="utf-8"))
        self.assertEqual(persisted["sequence"], 7)

        accepted, changed = store.accept_verified_catalog(
            verified(8, "8" * 64),
            self.watermark,
        )
        self.assertTrue(changed)
        self.assertEqual(accepted["sequence"], 8)
        persisted = json.loads(self.watermark.read_text(encoding="utf-8"))
        self.assertEqual(persisted["sequence"], 8)

    def test_corrupt_or_symlink_watermark_never_resets_replay_history(self) -> None:
        self.watermark.write_text('{"schema":"broken"}\n', encoding="utf-8")
        with self.assertRaisesRegex(store.StoreCatalogError, "watermark (fields|identity)"):
            store.accept_verified_catalog(verified(9, "9" * 64), self.watermark)

        self.watermark.unlink()
        target = self.root / "elsewhere.json"
        target.write_text("{}\n", encoding="utf-8")
        try:
            self.watermark.symlink_to(target)
        except (OSError, NotImplementedError):
            self.skipTest("symlink creation unavailable")
        with self.assertRaisesRegex(store.StoreCatalogError, "non-symlink"):
            store.accept_verified_catalog(verified(9, "9" * 64), self.watermark)

    def test_verified_projection_rejects_entry_trust_or_unknown_fields(self) -> None:
        catalog = verified()
        catalog["entries"][0]["trust"] = {
            "domain": "runtime-components",
            "requiredKeyId": "ordax-runtime-components-v1",
        }
        with self.assertRaisesRegex(store.StoreCatalogError, "entry fields"):
            store.validate_verified_catalog(catalog)

        catalog = verified()
        catalog["extra"] = True
        with self.assertRaisesRegex(store.StoreCatalogError, "fields are not canonical"):
            store.validate_verified_catalog(catalog)

    def test_native_boundary_invokes_only_fixed_verifier_command_then_commits_watermark(self) -> None:
        helper = self.root / "ordax-runtime-component-channel"
        helper.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        helper.chmod(helper.stat().st_mode | stat.S_IXUSR)
        trust = self.root / "trust.json"
        trust.write_text("{}\n", encoding="utf-8")
        envelope = self.root / "catalog-envelope.json"
        envelope.write_text("{}\n", encoding="utf-8")
        calls = []

        class Result:
            returncode = 0
            stdout = ""
            stderr = ""

        def runner(argv, **kwargs):
            calls.append((argv, kwargs))
            out = Path(argv[argv.index("--out") + 1])
            out.write_text(
                json.dumps(verified(11, "a" * 64), indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            return Result()

        accepted, changed = store.verify_and_accept_store_catalog(
            helper_path=helper,
            trust_path=trust,
            envelope_path=envelope,
            watermark_path=self.watermark,
            runner=runner,
        )
        self.assertTrue(changed)
        self.assertEqual(accepted["sequence"], 11)
        self.assertEqual(len(calls), 1)
        argv, kwargs = calls[0]
        self.assertEqual(argv[0], str(helper))
        self.assertEqual(argv[1], "verify-store-catalog")
        self.assertNotIn("shell", kwargs)
        self.assertFalse(kwargs["check"])
        self.assertTrue(kwargs["capture_output"])
        self.assertEqual(
            json.loads(self.watermark.read_text(encoding="utf-8"))["sequence"],
            11,
        )

    def test_failed_crypto_verification_never_mutates_watermark(self) -> None:
        helper = self.root / "ordax-runtime-component-channel"
        helper.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
        helper.chmod(helper.stat().st_mode | stat.S_IXUSR)
        trust = self.root / "trust.json"
        trust.write_text("{}\n", encoding="utf-8")
        envelope = self.root / "catalog-envelope.json"
        envelope.write_text("{}\n", encoding="utf-8")

        class Result:
            returncode = 1
            stdout = ""
            stderr = "signature invalid"

        with self.assertRaisesRegex(store.StoreCatalogError, "cryptographic verification failed"):
            store.verify_and_accept_store_catalog(
                helper_path=helper,
                trust_path=trust,
                envelope_path=envelope,
                watermark_path=self.watermark,
                runner=lambda *args, **kwargs: Result(),
            )
        self.assertFalse(self.watermark.exists())


    def test_snapshot_reader_reports_missing_envelope_without_invoking_verifier(self) -> None:
        helper = self.root / "ordax-runtime-component-channel"
        helper.write_text("#!/bin/sh\nexit 99\n", encoding="utf-8")
        helper.chmod(helper.stat().st_mode | stat.S_IXUSR)
        trust = self.root / "trust.json"
        trust.write_text("{}\n", encoding="utf-8")
        calls = []

        snapshot = store.read_native_store_catalog_snapshot(
            helper_path=helper,
            trust_path=trust,
            envelope_path=self.root / "missing-envelope.json",
            watermark_path=self.watermark,
            runner=lambda *args, **kwargs: calls.append((args, kwargs)),
        )

        self.assertEqual(snapshot["state"], "unavailable")
        self.assertEqual(snapshot["reason"], "catalog-envelope-unavailable")
        self.assertEqual(snapshot["authority"], "none")
        self.assertEqual(snapshot["entries"], [])
        self.assertEqual(calls, [])
        self.assertFalse(self.watermark.exists())

    def test_snapshot_reader_hides_verifier_failure_and_never_mutates_watermark(self) -> None:
        helper = self.root / "ordax-runtime-component-channel"
        helper.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
        helper.chmod(helper.stat().st_mode | stat.S_IXUSR)
        trust = self.root / "trust.json"
        trust.write_text("{}\n", encoding="utf-8")
        envelope = self.root / "catalog-envelope.json"
        envelope.write_text("{}\n", encoding="utf-8")

        class Result:
            returncode = 1
            stdout = ""
            stderr = "signature invalid"

        snapshot = store.read_native_store_catalog_snapshot(
            helper_path=helper,
            trust_path=trust,
            envelope_path=envelope,
            watermark_path=self.watermark,
            runner=lambda *args, **kwargs: Result(),
        )

        self.assertEqual(snapshot["state"], "unavailable")
        self.assertEqual(snapshot["reason"], "catalog-verification-unavailable")
        self.assertFalse(self.watermark.exists())

    def test_snapshot_reader_returns_ready_only_after_verified_watermark_commit(self) -> None:
        helper = self.root / "ordax-runtime-component-channel"
        helper.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        helper.chmod(helper.stat().st_mode | stat.S_IXUSR)
        trust = self.root / "trust.json"
        trust.write_text("{}\n", encoding="utf-8")
        envelope = self.root / "catalog-envelope.json"
        envelope.write_text("{}\n", encoding="utf-8")

        class Result:
            returncode = 0
            stdout = ""
            stderr = ""

        def runner(argv, **kwargs):
            out = Path(argv[argv.index("--out") + 1])
            out.write_text(
                json.dumps(verified(12, "c" * 64), indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            return Result()

        snapshot = store.read_native_store_catalog_snapshot(
            helper_path=helper,
            trust_path=trust,
            envelope_path=envelope,
            watermark_path=self.watermark,
            runner=runner,
        )

        self.assertEqual(snapshot["state"], "ready")
        self.assertEqual(snapshot["sequence"], 12)
        persisted = json.loads(self.watermark.read_text(encoding="utf-8"))
        self.assertEqual(persisted["sequence"], 12)
        self.assertEqual(persisted["catalogSha256"], "c" * 64)


if __name__ == "__main__":
    unittest.main()
