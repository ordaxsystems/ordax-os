import os
from pathlib import Path
import shutil
import shlex
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
    @classmethod
    def setUpClass(cls):
        # Same production C source as the static Base helper; no fake syscall.
        compiler = shutil.which("cc")
        if not compiler:
            raise unittest.SkipTest("Linux C compiler required for atomic checkout E2E")
        cls.exchange_build = tempfile.TemporaryDirectory()
        cls.exchange_binary = Path(cls.exchange_build.name) / "ordax-checkout-exchange"
        subprocess.run([
            compiler, "-O2", "-Wall", "-Wextra", "-Werror",
            "-o", str(cls.exchange_binary),
            str(ROOT / "bootstrap/dev-base/ordax_checkout_exchange.c"),
        ], check=True, capture_output=True, text=True, timeout=30)

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "exchange_build"):
            cls.exchange_build.cleanup()

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

    def _pull(self, expected_sha: str, git_error=None, reconcile_previous_sha=None) -> subprocess.CompletedProcess[str]:
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
                "ORDAX_CHECKOUT_EXCHANGE_BIN": str(self.exchange_binary),
            }
        )
        if reconcile_previous_sha is not None:
            env["ORDAX_RECONCILE_PREVIOUS_SHA"] = reconcile_previous_sha
        if git_error is not None:
            shim_dir = self.root / "git-shim"
            shim_dir.mkdir(exist_ok=True)
            shim = shim_dir / "git"
            shim.write_text(
                "#!/bin/sh\n"
                "for argument do\n"
                '    if [ "$argument" = "ls-remote" ]; then\n'
                '        printf \'%s\\n\' "$ORDAX_TEST_GIT_ERROR" >&2\n'
                "        exit 128\n"
                "    fi\n"
                "done\n"
                f"exec {shlex.quote(shutil.which('git'))} \"$@\"\n",
                encoding="utf-8",
            )
            shim.chmod(0o755)
            env["ORDAX_TEST_GIT_ERROR"] = git_error
            env["PATH"] = str(shim_dir) + os.pathsep + env["PATH"]
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

    def _diverged_main_fixture(self) -> tuple[str, str]:
        # A Development device observed a now-abandoned main head before
        # another branch was integrated instead. The old checkout is clean.
        old = self._publish("old-main")
        self._supervisor_fetch()
        installed = self._pull(old)
        self.assertEqual(installed.returncode, 0, installed.stderr)

        run_git("reset", "--hard", self.first, cwd=self.seed)
        self._write_release("replacement-main")
        run_git("add", ".", cwd=self.seed)
        run_git("commit", "-m", "independent canonical main lineage", cwd=self.seed)
        new = run_git("rev-parse", "HEAD", cwd=self.seed)
        run_git("push", "--force", "origin", "main", cwd=self.seed)
        run_git(
            "fetch", "--no-tags", "origin",
            "+refs/heads/main:refs/remotes/origin/main",
            cwd=self.worktree,
        )
        return old, new

    def test_automatic_lineage_recovery_keeps_old_object_and_needs_no_remote_refetch(self):
        old, new = self._diverged_main_fixture()
        # A normal handoff must still reject non-FF. Only the Supervisor's
        # explicit guarded reconciliation may take the alternate path.
        refused = self._pull(new)
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(run_git("rev-parse", "HEAD", cwd=self.worktree), old)

        self.remote.rename(self.root / "temporarily-offline.git")
        result = self._pull(new, reconcile_previous_sha=old)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(run_git("rev-parse", "HEAD", cwd=self.worktree), new)
        self.assertEqual(
            run_git("rev-parse", "refs/ordax/known-good", cwd=self.worktree), old,
        )
        self.assertEqual((self.state / "previous-commit").read_text().strip(), old)
        self.assertEqual((self.state / "current-commit").read_text().strip(), new)
        # Rollback can recover this SHA despite its not being a new-main ancestor.
        run_git("reset", "--hard", old, cwd=self.worktree)
        self.assertEqual(run_git("rev-parse", "HEAD", cwd=self.worktree), old)

    def test_lineage_recovery_refuses_missing_provenance_and_dirty_checkout(self):
        old, new = self._diverged_main_fixture()
        (self.state / "current-commit").write_text(self.first + "\n", encoding="ascii")
        refused = self._pull(new, reconcile_previous_sha=old)
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(run_git("rev-parse", "HEAD", cwd=self.worktree), old)
        self.assertFalse((self.worktree / "system" / "marker.txt").read_text().strip() == "replacement-main")

        (self.state / "current-commit").write_text(old + "\n", encoding="ascii")
        (self.worktree / "system" / "marker.txt").write_text("uncommitted\n", encoding="ascii")
        refused_dirty = self._pull(new, reconcile_previous_sha=old)
        self.assertNotEqual(refused_dirty.returncode, 0)
        self.assertEqual(run_git("rev-parse", "HEAD", cwd=self.worktree), old)
        self.assertEqual(
            (self.worktree / "system" / "marker.txt").read_text().strip(), "uncommitted",
        )

    def test_lineage_recovery_never_accepts_downgrade(self):
        old = self._publish("old-main")
        self._supervisor_fetch()
        self.assertEqual(self._pull(old).returncode, 0)
        run_git("push", "--force", "origin", self.first + ":refs/heads/main", cwd=self.seed)
        run_git(
            "fetch", "--no-tags", "origin",
            "+refs/heads/main:refs/remotes/origin/main",
            cwd=self.worktree,
        )
        refused = self._pull(self.first, reconcile_previous_sha=old)
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(run_git("rev-parse", "HEAD", cwd=self.worktree), old)

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
        self.assertEqual((self.run_dir / "pull-result").read_text().strip(), "handoff-ref-mismatch")

    def test_missing_supervisor_fetch_is_specific_handoff_error_not_remote_retry(self):
        second = self._publish("two")
        completed = self._pull(second)
        self.assertNotEqual(completed.returncode, 0)
        self.assertEqual((self.run_dir / "pull-result").read_text().strip(), "handoff-ref-mismatch")
        self.assertIn("tracking ref differs from verified candidate", completed.stderr)
        self.assertEqual(run_git("rev-parse", "HEAD", cwd=self.worktree), self.first)
        self.assertFalse((self.state / "current-commit").exists())


    def test_supervisor_handoff_reports_origin_mismatch_without_refetch(self):
        second = self._publish("two")
        self._supervisor_fetch()
        run_git("remote", "set-url", "origin", self.root.joinpath("wrong.git").as_uri(), cwd=self.worktree)
        completed = self._pull(second)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("invalid checkout metadata", completed.stderr)
        self.assertEqual((self.run_dir / "pull-result").read_text().strip(), "handoff-metadata-origin")
        self.assertEqual(run_git("rev-parse", "HEAD", cwd=self.worktree), self.first)

    def test_supervisor_handoff_reports_wrong_branch_without_mutation(self):
        second = self._publish("two")
        self._supervisor_fetch()
        run_git("checkout", "-b", "temporary-fixture", cwd=self.worktree)
        completed = self._pull(second)
        self.assertNotEqual(completed.returncode, 0)
        self.assertEqual((self.run_dir / "pull-result").read_text().strip(), "handoff-metadata-branch")
        self.assertEqual(run_git("rev-parse", "HEAD", cwd=self.worktree), self.first)

    def test_supervisor_handoff_reports_missing_entrypoint_without_mutation(self):
        second = self._publish("two")
        self._supervisor_fetch()
        (self.worktree / "system" / "entrypoint").chmod(0o644)
        completed = self._pull(second)
        self.assertNotEqual(completed.returncode, 0)
        self.assertEqual((self.run_dir / "pull-result").read_text().strip(), "handoff-metadata-entrypoint")
        self.assertEqual(run_git("rev-parse", "HEAD", cwd=self.worktree), self.first)



    def test_standalone_pull_discovers_main_and_updates(self):
        second = self._publish("two")
        completed = self._pull("")
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(run_git("rev-parse", "HEAD", cwd=self.worktree), second)
        self.assertEqual((self.run_dir / "pull-result").read_text().strip(), "completed")

    def test_standalone_remote_errors_emit_only_fixed_private_phase_codes(self):
        cases = (
            ("dns", "fatal: Could not resolve host: example.invalid", "remote-discovery-dns"),
            ("tls", "fatal: SSL certificate problem: certificate verify failed", "remote-discovery-tls"),
            ("timeout", "fatal: Operation timed out", "remote-discovery-timeout"),
            ("network", "fatal: Network is unreachable", "remote-discovery-connectivity"),
            ("auth", "fatal: The requested URL returned error: 403", "remote-discovery-auth"),
            ("unknown", "fatal: secret-sentinel-unclassified", "remote-discovery"),
        )
        for case, error, phase in cases:
            with self.subTest(case=case):
                completed = self._pull("", git_error=error)
                self.assertNotEqual(completed.returncode, 0)
                self.assertEqual((self.run_dir / "pull-result").read_text().strip(), phase)
                self.assertIn(phase, completed.stderr)
                self.assertNotIn(error, completed.stderr)
                self.assertEqual(run_git("rev-parse", "HEAD", cwd=self.worktree), self.first)
                self.assertFalse(list(self.run_dir.glob(".pull-remote.*")))
                self.assertFalse((self.state / "current-commit").exists())

if __name__ == "__main__":
    unittest.main()