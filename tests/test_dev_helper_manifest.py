from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "system/services/base-update/dev-helper-manifest.tsv"
INSTALLER = ROOT / "system/services/base-update/dev-helpers.sh"
SUPERVISOR = ROOT / "system/supervisor"


class DevHelperManifestContractTests(unittest.TestCase):
    def test_manifest_is_unique_safe_and_complete(self):
        entries = []
        for raw in MANIFEST.read_text(encoding="utf-8").splitlines():
            if not raw or raw.startswith("#"):
                continue
            source, target, *native = raw.split("\t")
            if source == "bootstrap/dev-base/ordax-pull":
                self.assertEqual(native, [
                    "usr/local/bin/ordax-checkout-exchange@prototype-ordax.checkout-exchange/1"
                ])
            else:
                self.assertEqual(native, [])
            self.assertFalse(source.startswith("/"))
            self.assertNotIn("..", source)
            self.assertFalse(target.startswith("/"))
            self.assertNotIn("..", target)
            self.assertTrue((ROOT / source).is_file(), source)
            entries.append((source, target))
        self.assertEqual(len(entries), len(set(entries)))
        self.assertGreaterEqual(len(entries), 9)
        sources = {source for source, _ in entries}
        self.assertIn("bootstrap/dev-base/ordax-main-watch", sources)
        self.assertIn("bootstrap/base-update/owner-development/ordax-remote", sources)

    def test_installer_and_supervisor_consume_same_manifest(self):
        installer = INSTALLER.read_text(encoding="utf-8")
        supervisor = SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("HELPER_MANIFEST=$WORKTREE/system/services/base-update/dev-helper-manifest.tsv", installer)
        self.assertIn('done <"$HELPER_MANIFEST"', installer)
        self.assertIn('show "$new_sha:system/services/base-update/dev-helper-manifest.tsv"', supervisor)
        self.assertNotIn("bootstrap/dev-base/ordax-dev-init|bootstrap/dev-base/ordax-diagnose", supervisor)

    def test_shell_consumers_remain_syntax_valid(self):
        subprocess.run(["sh", "-n", str(INSTALLER)], check=True)
        subprocess.run(["sh", "-n", str(SUPERVISOR)], check=True)


if __name__ == "__main__":
    unittest.main()
