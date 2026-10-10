#!/usr/bin/env python3
"""Dynamic tests for the Portable Stable activation state helper."""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "bootstrap" / "initramfs" / "portable_state.c"

OLD = "1" * 40
OLDER = "0" * 40
NEW = "2" * 40
NEXT = "3" * 40


def write_release(root: Path, commit: str) -> None:
    release = root / "releases" / commit
    release.mkdir(parents=True)
    image = bytearray(4096)
    image[1024:1028] = bytes((0xE2, 0xE1, 0xF5, 0xE0))
    (release / "system.erofs").write_bytes(image)
    (release / "release-manifest.json").write_text("{}\n", encoding="utf-8")
    (release / "release-envelope.json").write_text("{}\n", encoding="utf-8")


class PortableActivationStateHelperTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        compiler = shutil.which("cc")
        if compiler is None:
            raise unittest.SkipTest("host C compiler is unavailable")
        cls._build = tempfile.TemporaryDirectory()
        cls.binary = Path(cls._build.name) / "ordax-portable-state"
        subprocess.run(
            [
                compiler,
                "-O2",
                "-Wall",
                "-Wextra",
                "-Werror",
                "-o",
                str(cls.binary),
                str(SOURCE),
            ],
            check=True,
        )

    @classmethod
    def tearDownClass(cls) -> None:
        if hasattr(cls, "_build"):
            cls._build.cleanup()

    def fixture(self) -> tuple[Path, Path, Path]:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        state = root / "state"
        portable = root / "portable"
        activation = state / "ordax" / "portable-release"
        activation.mkdir(parents=True)
        portable.mkdir()
        for commit in (OLDER, OLD, NEW, NEXT):
            write_release(portable, commit)
        (activation / "current").write_text(OLD + "\n", encoding="ascii")
        (activation / "known-good").write_text(OLDER + "\n", encoding="ascii")
        return state, portable, activation

    def run_helper(
        self,
        *args: str | Path,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(self.binary), *(str(arg) for arg in args)],
            text=True,
            capture_output=True,
            check=check,
        )

    def test_prepare_and_uncommitted_boot_is_one_shot(self):
        state, portable, activation = self.fixture()

        prepared = self.run_helper("prepare", state, portable, NEW)
        self.assertEqual(prepared.stdout.strip(), NEW)
        self.assertEqual((activation / "current").read_text().strip(), OLD)
        self.assertEqual((activation / "known-good").read_text().strip(), OLDER)
        self.assertEqual((activation / "candidate").read_text().strip(), NEW)

        transaction = json.loads(
            (activation / "activation-transaction.json").read_text(encoding="utf-8")
        )
        self.assertEqual(transaction["previous"], OLD)
        self.assertEqual(transaction["candidate"], NEW)
        self.assertEqual(transaction["attempt"], 0)

        first = self.run_helper("select-boot", state, portable)
        self.assertEqual(first.stdout.strip(), f"candidate {NEW}")
        transaction = json.loads(
            (activation / "activation-transaction.json").read_text(encoding="utf-8")
        )
        self.assertEqual(transaction["attempt"], 1)

        second = self.run_helper("select-boot", state, portable)
        self.assertEqual(second.stdout.strip(), f"current {OLD}")
        self.assertEqual((activation / "current").read_text().strip(), OLD)
        self.assertFalse((activation / "candidate").exists())
        self.assertFalse((activation / "activation-transaction.json").exists())
        self.assertEqual((activation / "rejected").read_text().strip(), NEW)

    def test_missing_candidate_before_first_boot_preserves_previous(self):
        state, portable, activation = self.fixture()
        self.run_helper("prepare", state, portable, NEW)
        (portable / "releases" / NEW / "system.erofs").unlink()

        selected = self.run_helper("select-boot", state, portable)
        self.assertEqual(selected.stdout.strip(), f"current {OLD}")
        self.assertEqual((activation / "current").read_text().strip(), OLD)
        self.assertEqual((activation / "known-good").read_text().strip(), OLDER)
        self.assertEqual((activation / "rejected").read_text().strip(), NEW)
        self.assertFalse((activation / "candidate").exists())
        self.assertFalse((activation / "activation-transaction.json").exists())

    def test_corrupted_candidate_after_one_shot_falls_back_durably(self):
        state, portable, activation = self.fixture()
        self.run_helper("prepare", state, portable, NEW)
        self.assertEqual(
            self.run_helper("select-boot", state, portable).stdout.strip(),
            f"candidate {NEW}",
        )
        # A power failure left an unusable candidate but not a damaged current.
        (portable / "releases" / NEW / "system.erofs").write_bytes(b"bad")
        selected = self.run_helper("select-boot", state, portable)
        self.assertEqual(selected.stdout.strip(), f"current {OLD}")
        self.assertEqual((activation / "rejected").read_text().strip(), NEW)
        self.assertFalse((activation / "activation-transaction.json").exists())

    def test_candidate_identity_mismatch_never_triggers_rollback(self):
        state, portable, activation = self.fixture()
        self.run_helper("prepare", state, portable, NEW)
        (activation / "candidate").write_text(NEXT + "\n", encoding="ascii")
        result = self.run_helper("select-boot", state, portable, check=False)
        self.assertEqual(result.returncode, 4)
        self.assertIn("unsafe release state", result.stderr)
        self.assertEqual((activation / "current").read_text().strip(), OLD)
        self.assertFalse((activation / "rejected").exists())
        self.assertTrue((activation / "activation-transaction.json").exists())

    def test_damaged_known_good_never_grants_fallback_authority(self):
        state, portable, activation = self.fixture()
        self.run_helper("prepare", state, portable, NEW)
        (portable / "releases" / OLDER / "system.erofs").unlink()
        (portable / "releases" / NEW / "system.erofs").unlink()
        result = self.run_helper("select-boot", state, portable, check=False)
        self.assertEqual(result.returncode, 4)
        self.assertIn("unsafe release state", result.stderr)
        self.assertTrue((activation / "activation-transaction.json").exists())

    def test_rejected_candidate_is_not_rearmed_until_channel_advances(self):
        state, portable, activation = self.fixture()

        self.run_helper("prepare", state, portable, NEW)
        self.run_helper("select-boot", state, portable)
        self.run_helper("select-boot", state, portable)

        rejected = self.run_helper(
            "prepare",
            state,
            portable,
            NEW,
            check=False,
        )
        self.assertEqual(rejected.returncode, 4)
        self.assertIn("candidate was already rejected", rejected.stderr)
        self.assertEqual((activation / "rejected").read_text().strip(), NEW)

        prepared = self.run_helper("prepare", state, portable, NEXT)
        self.assertEqual(prepared.stdout.strip(), NEXT)
        self.assertFalse((activation / "rejected").exists())
        self.assertEqual((activation / "candidate").read_text().strip(), NEXT)

    def test_orphan_candidate_without_transaction_has_no_boot_authority(self):
        state, portable, activation = self.fixture()

        # Model power loss after durable transaction removal but before the
        # advisory candidate file is removed.
        (activation / "candidate").write_text(NEW + "\n", encoding="ascii")

        selected = self.run_helper("select-boot", state, portable)
        self.assertEqual(selected.stdout.strip(), f"current {OLD}")
        self.assertEqual((activation / "candidate").read_text().strip(), NEW)

        # The next different candidate arm cleans the harmless orphan first.
        prepared = self.run_helper("prepare", state, portable, NEXT)
        self.assertEqual(prepared.stdout.strip(), NEXT)
        self.assertEqual((activation / "candidate").read_text().strip(), NEXT)

    def test_successful_candidate_commit_rotates_known_good(self):
        state, portable, activation = self.fixture()

        self.run_helper("prepare", state, portable, NEW)
        self.assertEqual(
            self.run_helper("select-boot", state, portable).stdout.strip(),
            f"candidate {NEW}",
        )
        committed = self.run_helper("commit", state, portable, NEW)

        self.assertEqual(committed.stdout.strip(), NEW)
        self.assertEqual((activation / "current").read_text().strip(), NEW)
        self.assertEqual((activation / "known-good").read_text().strip(), OLD)
        self.assertFalse((activation / "candidate").exists())
        self.assertFalse((activation / "activation-transaction.json").exists())
        self.assertEqual(
            self.run_helper("select-boot", state, portable).stdout.strip(),
            f"current {NEW}",
        )

    def test_explicit_candidate_rollback_keeps_current(self):
        state, portable, activation = self.fixture()

        self.run_helper("prepare", state, portable, NEW)
        self.run_helper("select-boot", state, portable)
        rolled_back = self.run_helper("rollback", state, portable, NEW)

        self.assertEqual(rolled_back.stdout.strip(), OLD)
        self.assertEqual((activation / "current").read_text().strip(), OLD)
        self.assertEqual((activation / "known-good").read_text().strip(), OLDER)
        self.assertFalse((activation / "candidate").exists())
        self.assertFalse((activation / "activation-transaction.json").exists())
        self.assertEqual((activation / "rejected").read_text().strip(), NEW)

    def test_interrupted_commit_is_finalized_on_next_boot(self):
        state, portable, activation = self.fixture()

        self.run_helper("prepare", state, portable, NEW)
        self.run_helper("select-boot", state, portable)

        # Model a crash after durable known-good/current replacements but before
        # candidate/transaction cleanup.
        (activation / "known-good").write_text(OLD + "\n", encoding="ascii")
        (activation / "current").write_text(NEW + "\n", encoding="ascii")

        selected = self.run_helper("select-boot", state, portable)
        self.assertEqual(selected.stdout.strip(), f"current {NEW}")
        self.assertEqual((activation / "known-good").read_text().strip(), OLD)
        self.assertFalse((activation / "candidate").exists())
        self.assertFalse((activation / "activation-transaction.json").exists())

    def test_invalid_or_replaced_transaction_fails_closed(self):
        state, portable, activation = self.fixture()

        self.run_helper("prepare", state, portable, NEW)
        transaction = activation / "activation-transaction.json"
        transaction.unlink()
        transaction.symlink_to(activation / "current")

        result = self.run_helper("select-boot", state, portable, check=False)
        self.assertEqual(result.returncode, 4)
        self.assertIn("activation transaction is invalid", result.stderr)
        self.assertEqual((activation / "current").read_text().strip(), OLD)


if __name__ == "__main__":
    unittest.main()
