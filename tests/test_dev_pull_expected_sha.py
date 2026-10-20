import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PULL = ROOT / "bootstrap" / "dev-base" / "ordax-pull"


def run_git(*args, cwd: Path) -> str:
    completed = subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return completed.stdout.strip()


@unittest.skipUnless(
    shutil.which("git") and shutil.which("sh") and shutil.which("timeout"),
    "requires POSIX shell, git and timeout",
)
class DevPullExpectedShaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.seed = self.root / "seed"
        self.remote = self.root / "remote.git"
        self.worktree = self.root / "workspace" / "ordax"
        self.state = self.root / "state"
        self.run_dir = self.root / "run" / "ordax-update"
        self.seed.mkdir(parents=True)
        self.state.mkdir(parents=True)
        self.run_dir.mkdir(parents=True)

        run_git("init", "-b", "main", cwd=self.seed)
        run_git("config", "user.name", "OrdaX Test", cwd=self.seed)
        run_git("config", "user.email", "test@ordax.invalid", cwd=self.seed)
        self._write_release("one")
        run_git("add", ".", cwd=self.seed)
        run_git("update-index", "--chmod=+x", "system/entrypoint", cwd=self.seed)
        run_git("commit", "-m", "release one", cwd=self.seed)
        self.first = run_git("rev-parse", "HEAD", cwd=self.seed)

        subprocess.run(
            ["git", "clone", "--bare", str(self.seed), str(self.remote)],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        run_git("remote", "add", "origin", str(self.remote), cwd=self.seed)
        subprocess.run(
            ["git", "clone", self.remote.as_uri(), str(self.worktree)],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    def tearDown(self):
        self.temp.cleanup()

    def _write_release(self, marker: str) -> None:
        entrypoint = self.seed / "system" / "entrypoint"
        entrypoint.parent.mkdir(parents=True, exist_ok=True)
        entrypoint.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        entrypoint.chmod(entrypoint.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        (self.seed / "system" / "marker.txt").write_text(marker + "\n", encoding="utf-8")
        # Mirror the canonical runtime sparse allowlist so exact-candidate
        # materialization exercises all required paths without fake fallbacks.
        for relative in (
            "bootstrap/base-update/manifest.txt",
            "bootstrap/dev-base/manifest.txt",
            "bootstrap/recovery/entrypoint",
            "bootstrap/trust/release-ed25519.json",
            "bootstrap/config/release-envelope-url",
            "docs/contracts/base-update.json",
            "docs/contracts/release-trust-policy.json",
            "docs/contracts/minimal-bootstrap.json",
            "docs/evidence/release-trust-ceremony.json",
            "docs/evidence/release-trust-proof-manifest.json",
            "docs/evidence/release-trust-recovery-envelope.json",
        ):
            required = self.seed / relative
            required.parent.mkdir(parents=True, exist_ok=True)
            if not required.exists():
                required.write_text("test fixture\\n", encoding="utf-8")


    def _publish(self, marker: str) -> str:
        self._write_release(marker)
        run_git("add", ".", cwd=self.seed)
        run_git("update-index", "--chmod=+x", "system/entrypoint", cwd=self.seed)
        run_git("commit", "-m", f"release {marker}", cwd=self.seed)
        sha = run_git("rev-parse", "HEAD", cwd=self.seed)
        run_git("push", "origin", "main", cwd=self.seed)
        return sha

    def _pull(self, expected_sha: str) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env.update(
            {
                "ORDAX_REPO_URL": self.remote.as_uri(),
                "ORDAX_REPO_BRANCH": "main",
                "ORDAX_WORKTREE": str(self.worktree),
                "ORDAX_STATE_DIR": str(self.state),
                "ORDAX_UPDATE_RUN_DIR": str(self.run_dir),
                "ORDAX_EXPECTED_SHA": expected_sha,
                "ORDAX_BOOT_GIT_TIMEOUT_SECONDS": "30",
            }
        )
        return subprocess.run(
            ["sh", str(PULL)],
            cwd=ROOT,
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def _supervisor_fetch(self) -> None:
        run_git(
            "fetch", "--no-tags", "origin",
            "refs/heads/main:refs/remotes/origin/main",
            cwd=self.worktree,
        )

    def test_exact_candidate_is_atomically_activated_with_remote_offline(self):
        second = self._publish("two")
        self._supervisor_fetch()
        # Supervisor already fetched this exact commit; removing the fixture
        # remote proves ordax-pull does not attempt another network discovery.
        self.remote.rename(self.root / "disconnected-origin.git")
        completed = self._pull(second)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(run_git("rev-parse", "HEAD", cwd=self.worktree), second)
        self.assertEqual((self.worktree / "system" / "marker.txt").read_text().strip(), "two")
        self.assertEqual((self.state / "current-commit").read_text().strip(), second)
        self.assertEqual((self.state / "previous-commit").read_text().strip(), self.first)
        self.assertIn("checkout atomico ativado", completed.stdout)

    def test_supervisor_handoff_rejects_expected_sha_not_in_tracking_ref(self):
        second = self._publish("two")
        self._supervisor_fetch()
        first_update = self._pull(second)
        self.assertEqual(first_update.returncode, 0, first_update.stderr)
        third = self._publish("three")
        self._supervisor_fetch()
        self.assertNotEqual(third, second)

        completed = self._pull(second)
        self.assertNotEqual(completed.returncode, 0)
        self.assertEqual(run_git("rev-parse", "HEAD", cwd=self.worktree), second)
        self.assertEqual((self.worktree / "system" / "marker.txt").read_text().strip(), "two")
        self.assertIn("tracking ref differs from verified candidate", completed.stderr)
        self.assertEqual((self.run_dir / "pull-result").read_text().strip(), "handoff-validation")

    def test_missing_supervisor_fetch_is_specific_handoff_error_not_remote_retry(self):
        second = self._publish("two")
        completed = self._pull(second)
        self.assertNotEqual(completed.returncode, 0)
        self.assertEqual((self.run_dir / "pull-result").read_text().strip(), "handoff-validation")
        self.assertIn("tracking ref differs from verified candidate", completed.stderr)
        self.assertEqual(run_git("rev-parse", "HEAD", cwd=self.worktree), self.first)
        self.assertFalse((self.state / "current-commit").exists())


if __name__ == "__main__":
    unittest.main()