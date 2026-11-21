"""Behavioral tests for USB Git objects as cache, never a target authority."""
from pathlib import Path
import os
import shlex
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SUPERVISOR = ROOT / "system/supervisor"
BASH = shutil.which("bash") or r"C:\Program Files\Git\bin\bash.exe"
GIT = shutil.which("git")


def path_for_shell(path):
    v = Path(path).resolve().as_posix()
    return "/" + v[0].lower() + v[2:] if os.name == "nt" else v


def git(*args):
    return subprocess.run([GIT, *map(str, args)], capture_output=True,
                          text=True, check=True, timeout=25).stdout.strip()


@unittest.skipUnless(GIT and Path(BASH).exists(), "Git and POSIX shell required")
class USBGitCacheTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.folder = Path(temp.name)
        self.source = self.folder / "source"
        self.runtime = self.folder / "runtime"
        git("init", "-b", "main", self.source)
        git("-C", self.source, "config", "user.name", "Test")
        git("-C", self.source, "config", "user.email", "test@example.invalid")
        (self.source / "file.txt").write_text("old\n")
        git("-C", self.source, "add", "file.txt")
        git("-C", self.source, "commit", "-m", "old")
        self.old = git("-C", self.source, "rev-parse", "HEAD")
        git("clone", self.source, self.runtime)
        git("-C", self.runtime, "remote", "set-url", "origin",
            "https://github.com/ordaxsystems/ordax-os.git")
        (self.source / "file.txt").write_text("new\n")
        git("-C", self.source, "commit", "-am", "new")
        self.new = git("-C", self.source, "rev-parse", "HEAD")
        bundle = self.folder / "main.bundle"
        git("-C", self.source, "bundle", "create", bundle, "main")
        git("-C", self.runtime, "fetch", "--no-tags", bundle,
            "+refs/heads/main:refs/ordax/offline/main")

    def handoff(self, requested, profile="owner-development"):
        text = SUPERVISOR.read_text(encoding="utf-8")
        begin = "    # The USB manifest is not signed, so it never selects an update target."
        self.assertEqual(text.count(begin), 1)
        block = text.split(begin, 1)[1].split("    checkout_fetched_sha=", 1)[0]
        prefix = f"""set -eu
DISTRIBUTION_PROFILE={shlex.quote(profile)}
PRODUCT_MODE=usb
BRANCH=main
REPO_URL=https://github.com/ordaxsystems/ordax-os.git
WORKTREE={shlex.quote(path_for_shell(self.runtime))}
GIT_BIN=git
FETCH_TIMEOUT=20
FETCH_ERROR_FILE={shlex.quote(path_for_shell(self.folder / "fetch-error"))}
FETCH_RETRY_FILE={shlex.quote(path_for_shell(self.folder / "fetch-retry"))}
UPDATE_LOG={shlex.quote(path_for_shell(self.folder / "update.log"))}
checkout_target_sha={shlex.quote(requested)}
fetch_started=0
log() {{ :; }}
is_sha() {{ [ "$(printf %s "$1" | wc -c)" -eq 40 ]; }}
run_bounded_git() {{
  shift
  for param in "$@"; do
    if [ "$param" = fetch ]; then echo 'UNEXPECTED_ONLINE_FETCH' >> "$UPDATE_LOG"; return 55; fi
  done
  git "$@"
}}
classify_fetch_error() {{ printf 'missing'; }}
record_fetch_failure() {{ :; }}
"""
        script = (prefix + 'simulate_apply() {\n' + begin + "\n" + block
                  + '\nprintf "APPROVED=%s\\n" "$owner_cached_objects_approved"\n}\n'
                  + 'simulate_apply\n')
        return subprocess.run([BASH, "-c", script], capture_output=True, text=True, timeout=30)

    def test_matching_git_hash_reuses_cache_without_network_or_activation(self):
        result = self.handoff(self.new)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("APPROVED=1", result.stdout)
        self.assertNotIn("UNEXPECTED_ONLINE_FETCH", result.stderr)
        self.assertEqual(git("-C", self.runtime, "rev-parse", "refs/remotes/origin/main"), self.new)
        self.assertEqual(git("-C", self.runtime, "rev-parse", "HEAD"), self.old)

    def test_wrong_hash_never_promotes_offline_cache(self):
        result = self.handoff("f" * 40)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("UNEXPECTED_ONLINE_FETCH",
                      (self.folder / "update.log").read_text(encoding="utf-8"))
        self.assertEqual(git("-C", self.runtime, "rev-parse", "refs/remotes/origin/main"), self.old)
        self.assertEqual(git("-C", self.runtime, "rev-parse", "HEAD"), self.old)

    def test_stable_profile_cannot_promote_development_cache(self):
        result = self.handoff(self.new, "stable-mvp")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("UNEXPECTED_ONLINE_FETCH",
                      (self.folder / "update.log").read_text(encoding="utf-8"))
        self.assertEqual(git("-C", self.runtime, "rev-parse", "refs/remotes/origin/main"), self.old)

    def test_same_supervisor_read_only_owner_path(self):
        source = SUPERVISOR.read_text(encoding="utf-8")
        self.assertEqual(source.count("        owner_stage_usb_git_once\n"), 1)
        # Prefetch can run without Wi-Fi onboarding; no update is authorized there.
        self.assertIn('if [ "$OWNER_INITIAL_HEALTH_PENDING" -eq 0 ]; then\n        owner_stage_usb_git_once\n    fi\n    reconcile_dev_base_promotion\n    check_for_update', source)
        first_run_gate = source.split("check_for_update() {", 1)[1].split("record_owner_poll_boot_stage git-remote-started", 1)[0]
        self.assertNotIn("owner_stage_usb_git_once", first_run_gate)
        self.assertIn("owner_root_sys=/sys/dev/block/$owner_root_mm", source)
        self.assertIn('[ "$owner_data_count" -eq 1 ] || return 1', source)
        self.assertIn("mount -t exfat -o ro,nosuid,nodev,noexec", source)
        self.assertIn('stage "$owner_bundle_dir"', source)
        self.assertIn('run_bounded_git "$REMOTE_TIMEOUT" -C "$WORKTREE" ls-remote', source)
        stage = source.split("owner_stage_usb_git_once() {", 1)[1].split("\n}\n", 1)[0]
        for forbidden in ("ordax-pull", "update-ref", "reboot"):
            self.assertNotIn(forbidden, stage)
        builder = (ROOT / "bootstrap/independent-base/build.py").read_text(encoding="utf-8")
        fragment = (ROOT / "bootstrap/independent-base/configs/owner-development.busybox.fragment").read_text(encoding="utf-8")
        self.assertIn('"wget", "blkid",', builder)
        self.assertIn("CONFIG_BLKID=y", fragment)
        self.assertIn("CONFIG_FEATURE_VOLUMEID_EXFAT=y", fragment)
        subprocess.run([BASH, "-n", str(SUPERVISOR)], check=True, timeout=15)


if __name__ == "__main__":
    unittest.main()
