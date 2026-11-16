"""Focused tests for the non-activating Owner USB Git transport."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "bootstrap" / "dev-base" / "ordax-owner-usb-git"
GIT = shutil.which("git")
BASH = shutil.which("bash") or r"C:\Program Files\Git\bin\bash.exe"


def posix_path(path):
    absolute = Path(path).resolve().as_posix()
    if os.name == "nt":
        return "/" + absolute[0].lower() + absolute[2:]
    return absolute


def git(*args):
    return subprocess.run([GIT, *map(str, args)], capture_output=True, text=True, check=True).stdout.strip()


@unittest.skipUnless(GIT and Path(BASH).exists() if os.name == "nt" else bool(GIT and shutil.which("sh")), "Git and POSIX shell required")
class OwnerUSBGitTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / "source"
        self.runtime = self.root / "runtime"
        self.delivery = self.root / "delivery"
        self.delivery.mkdir()
        self.rundir = self.root / "run"
        self.rundir.mkdir()
        git("init", "-b", "main", self.source)
        git("-C", self.source, "config", "user.email", "test@example.invalid")
        git("-C", self.source, "config", "user.name", "test")
        (self.source / "file.txt").write_text("original\n", encoding="utf-8")
        git("-C", self.source, "add", "file.txt")
        git("-C", self.source, "commit", "-m", "start")
        self.old = git("-C", self.source, "rev-parse", "HEAD")
        git("clone", self.source, self.runtime)
        git("-C", self.runtime, "config", "remote.origin.url", "https://github.com/ordaxsystems/ordax-os.git")
        (self.source / "file.txt").write_text("updated\n", encoding="utf-8")
        git("-C", self.source, "commit", "-am", "update")
        self.new = git("-C", self.source, "rev-parse", "HEAD")
        git("-C", self.source, "bundle", "create", self.delivery / "ordax-main.bundle", "main")
        blob = (self.delivery / "ordax-main.bundle").read_bytes()
        self.lines = [
            "schema=ordax.owner-dev-usb-git/1",
            "repository=ordaxsystems/ordax-os",
            "source_commit=" + self.new,
            "bundle_sha256=" + hashlib.sha256(blob).hexdigest(),
            "bundle_bytes=" + str(len(blob)),
        ]
        self.write_manifest()

    def write_manifest(self):
        (self.delivery / "owner-git-bundle.txt").write_text(
            "\n".join(self.lines) + "\n", encoding="ascii")

    def run_tool(self, action="inspect", profile="owner-development"):
        env = os.environ.copy()
        env.update({
            "ORDAX_DISTRIBUTION_PROFILE": profile,
            "ORDAX_WORKTREE": posix_path(self.runtime),
            "ORDAX_UPDATE_RUN_DIR": posix_path(self.rundir),
        })
        shell = BASH if os.name == "nt" else shutil.which("sh")
        return subprocess.run(
            [shell, posix_path(SCRIPT), action, posix_path(self.delivery)],
            env=env, capture_output=True, text=True, timeout=35)

    def test_inspect_only_preserves_checkout_and_refs(self):
        result = self.run_tool()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(self.new, result.stdout)
        self.assertEqual(git("-C", self.runtime, "rev-parse", "HEAD"), self.old)
        absent = subprocess.run([GIT, "-C", str(self.runtime), "show-ref", "--verify", "--quiet",
                                 "refs/ordax/offline/main"], capture_output=True)
        self.assertNotEqual(absent.returncode, 0)

    def test_stage_imports_only_candidate_objects(self):
        result = self.run_tool("stage")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("ORDAX_OFFLINE_CANDIDATE_SHA=" + self.new, result.stdout)
        self.assertEqual(git("-C", self.runtime, "rev-parse", "refs/ordax/offline/main"), self.new)
        self.assertEqual(git("-C", self.runtime, "rev-parse", "HEAD"), self.old)

    def test_tampered_bundle_blocked_before_import(self):
        with (self.delivery / "ordax-main.bundle").open("ab") as handle:
            handle.write(b"tampered")
        result = self.run_tool("stage")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("size differs", result.stderr)
        self.assertEqual(git("-C", self.runtime, "rev-parse", "HEAD"), self.old)

    def test_manifest_commit_mismatch_blocked(self):
        self.lines[2] = "source_commit=" + "f" * 40
        self.write_manifest()
        result = self.run_tool("stage")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("exactly one pinned main", result.stderr)

    def test_profile_gate_and_trailing_fields(self):
        self.assertNotEqual(self.run_tool(profile="stable-mvp").returncode, 0)
        with (self.delivery / "owner-git-bundle.txt").open("a") as handle:
            handle.write("unexpected=value\n")
        self.assertNotEqual(self.run_tool().returncode, 0)

    def test_origin_cannot_be_rebound(self):
        git("-C", self.runtime, "remote", "set-url", "origin", "https://evil.example/repo")
        result = self.run_tool("stage")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("origin is not canonical", result.stderr)


    def test_owner_base_packages_transport_but_stable_rejects_it(self):
        root = Path(__file__).resolve().parents[1]
        post = (root / "bootstrap/independent-base/post-build.sh").read_text(encoding="utf-8")
        builder = (root / "bootstrap/independent-base/build.py").read_text(encoding="utf-8")
        self.assertIn("ordax-pull ordax-owner-usb-git ordax-rollback", post)
        self.assertIn('"$TARGET_DIR/usr/local/bin/ordax-owner-usb-git"', post)
        self.assertIn('"usr/local/bin/ordax-owner-usb-git": ROOT / "bootstrap/dev-base/ordax-owner-usb-git"', builder)


if __name__ == "__main__":
    unittest.main()
