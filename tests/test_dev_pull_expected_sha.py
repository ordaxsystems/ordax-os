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
        self.seed.mkdir(parents=True)
        self.state.mkdir(parents=True)

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
            ["git", "clone", str(self.remote), str(self.worktree)],
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

    def test_exact_candidate_is_atomically_activated(self):
        second = self._publish("two")
        completed = self._pull(second)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(run_git("rev-parse", "HEAD", cwd=self.worktree), second)
        self.assertEqual((self.worktree / "system" / "marker.txt").read_text().strip(), "two")
        self.assertEqual((self.state / "current-commit").read_text().strip(), second)
        self.assertEqual((self.state / "previous-commit").read_text().strip(), self.first)
        self.assertIn("checkout atomico ativado", completed.stdout)

    def test_remote_movement_rejects_stale_expected_sha_without_mutating_checkout(self):
        second = self._publish("two")
        first_update = self._pull(second)
        self.assertEqual(first_update.returncode, 0, first_update.stderr)
        third = self._publish("three")
        self.assertNotEqual(third, second)

        completed = self._pull(second)
        self.assertNotEqual(completed.returncode, 0)
        self.assertEqual(run_git("rev-parse", "HEAD", cwd=self.worktree), second)
        self.assertEqual((self.worktree / "system" / "marker.txt").read_text().strip(), "two")
        self.assertIn("main mudou durante a transacao", completed.stderr)


if __name__ == "__main__":
    unittest.main()