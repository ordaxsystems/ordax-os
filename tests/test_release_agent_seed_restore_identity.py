"""Fail-closed source and identity contracts for immutable Release Agent seed restore."""
import os
from pathlib import Path
import shutil
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "bootstrap/release-acquisition/restore_pinned_seed.sh"
WORKFLOWS = (
    ROOT / ".github/workflows/creator-payload-candidate.yml",
    ROOT / ".github/workflows/full-bootstrap-media-proof.yml",
)
SEED_SHA256 = "550df685679f1bf15a636729960fe6fc3ffc1afda1a346214ce96716f7170a66"
REPOSITORY_ID = "1371063347"
CANONICAL_REPOSITORY = "ordaxsystems/ordax-os"


class ReleaseSeedRestoreIdentityTests(unittest.TestCase):
    def test_one_canonical_seed_script_used_by_both_workflows(self):
        script = SCRIPT.read_text(encoding="utf-8")
        self.assertEqual(script.count(SEED_SHA256), 1)
        self.assertIn(f"expected_repository_id='{REPOSITORY_ID}'", script)
        self.assertIn(f"expected_repository='{CANONICAL_REPOSITORY}'", script)
        self.assertIn('"${GITHUB_REPOSITORY:-}" != "$expected_repository"', script)
        self.assertNotIn("prototipo-ordax-os", script)
        self.assertIn('"${GITHUB_REPOSITORY_ID:-}" != "$expected_repository_id"', script)
        self.assertIn('url="https://github.com/${GITHUB_REPOSITORY}/releases/download/', script)
        self.assertIn("sha256sum", script)
        self.assertIn("RELEASE_AGENT_SEED_REPOSITORY_ID_VERIFIED=YES", script)
        self.assertIn("--proto-redir '=https'", script)
        self.assertNotIn("ordaxsystems/prototipo-ordax-os", script)
        self.assertNotIn("washingtonmsdj/prototipo-ordax-os", script)
        for path in WORKFLOWS:
            text = path.read_text(encoding="utf-8")
            self.assertIn(
                "run: bash bootstrap/release-acquisition/restore_pinned_seed.sh", text
            )
            self.assertNotIn(SEED_SHA256, text)
            self.assertNotIn("curl --fail --location", text)

    @unittest.skipUnless(os.name == "posix" and shutil.which("bash"), "POSIX bash is required for shell policy test")
    def test_rejects_wrong_repository_id_before_any_download(self):
        env = {
            **os.environ,
            "GITHUB_REPOSITORY_ID": "0",
            "GITHUB_REPOSITORY": CANONICAL_REPOSITORY,
        }
        result = subprocess.run(
            ["bash", str(SCRIPT)],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("RELEASE_AGENT_SEED_REPOSITORY_ID=REJECTED", result.stderr)

    @unittest.skipUnless(os.name == "posix" and shutil.which("bash"), "POSIX bash is required for shell policy test")
    def test_rejects_previous_name_with_same_immutable_repo_id(self):
        env = {
            **os.environ,
            "GITHUB_REPOSITORY_ID": REPOSITORY_ID,
            "GITHUB_REPOSITORY": "ordaxsystems/prototipo-ordax-os",
        }
        result = subprocess.run(
            ["bash", str(SCRIPT)], cwd=ROOT, env=env,
            capture_output=True, text=True, timeout=10, check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("RELEASE_AGENT_SEED_REPOSITORY_NAME=REJECTED", result.stderr)

    @unittest.skipUnless(os.name == "posix" and shutil.which("bash"), "POSIX bash is required for shell policy test")
    def test_correct_owner_can_reach_exact_hash_proof_without_network(self):
        # A forged response from curl must fail the historical SHA pin
        # even when the executing repository name and ID both match.
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            fake_bin = Path(tmp)
            fake_curl = fake_bin / "curl"
            fake_curl.write_text(
                '#!/bin/sh\n'
                'prev=""\n'
                'for arg in "$@"; do\n'
                '  if [ "$prev" = "--output" ]; then\n'
                '    printf "wrong-pinned-seed" > "$arg"\n'
                '    exit 0\n'
                '  fi\n'
                '  prev="$arg"\n'
                'done\n'
                'exit 5\n', encoding="utf-8"
            )
            fake_curl.chmod(0o755)
            env = {
                **os.environ,
                "PATH": str(fake_bin) + os.pathsep + os.environ.get("PATH", ""),
                "GITHUB_REPOSITORY_ID": REPOSITORY_ID,
                "GITHUB_REPOSITORY": CANONICAL_REPOSITORY,
            }
            result = subprocess.run(
                ["bash", str(SCRIPT)], cwd=ROOT, env=env,
                capture_output=True, text=True, timeout=10, check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("canonical release-agent seed hash mismatch", result.stderr)
            self.assertNotIn("RELEASE_AGENT_SEED_REPOSITORY_NAME=REJECTED", result.stderr)
            self.assertNotIn("RELEASE_AGENT_SEED_REPOSITORY_ID=REJECTED", result.stderr)

    @unittest.skipUnless(os.name == "posix" and shutil.which("bash"), "POSIX bash is required for shell policy test")
    def test_rejects_repository_name_change_before_any_download(self):
        env = {
            **os.environ,
            "GITHUB_REPOSITORY_ID": REPOSITORY_ID,
            "GITHUB_REPOSITORY": "attacker/different-repository",
        }
        result = subprocess.run(
            ["bash", str(SCRIPT)],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("RELEASE_AGENT_SEED_REPOSITORY_NAME=REJECTED", result.stderr)


if __name__ == "__main__":
    unittest.main()
