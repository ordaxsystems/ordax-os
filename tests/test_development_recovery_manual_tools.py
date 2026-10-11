"""Developer-only manual maintenance in local OrdaX recovery."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "bootstrap/recovery/entrypoint"
SOURCE = SCRIPT.read_text(encoding="utf-8")


class DevelopmentRecoveryManualToolsTests(unittest.TestCase):
    def test_recovery_script_parses_and_remains_non_mutating(self):
        subprocess.run(["sh", "-n", str(SCRIPT)], check=True)
        self.assertIn("No network, remote access or automatic mutation is started in recovery.", SOURCE)
        self.assertIn('exec sh', SOURCE)
        self.assertIn('ORDAX_DISTRIBUTION_PROFILE:-}', SOURCE)
        self.assertIn('ORDAX_PRODUCT_MODE:-}', SOURCE)
        self.assertIn('[ -x /usr/local/bin/ordax-pull ]', SOURCE)
        self.assertIn('[ -x /usr/local/bin/ordax-run ]', SOURCE)
        self.assertNotIn('\nordax-pull\n', SOURCE)
        self.assertNotIn('\nordax-run\n', SOURCE)
        self.assertNotIn('\nordax-network\n', SOURCE)

    def _manual_path_for(self, profile, mode, install_pull=True, install_run=True):
        with tempfile.TemporaryDirectory() as temp:
            bin_dir = Path(temp) / "bin"
            sbin_dir = Path(temp) / "sbin"
            bin_dir.mkdir()
            sbin_dir.mkdir()
            for filename, installed in (("ordax-pull", install_pull), ("ordax-run", install_run)):
                if installed:
                    executable = bin_dir / filename
                    executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
                    executable.chmod(0o755)

            # Exercise the actual shell condition using disposable executables;
            # do not launch an interactive shell or perform device I/O.
            start = SOURCE.index("PATH=/sbin:/bin:/usr/sbin:/usr/bin")
            end = SOURCE.index("export PATH", start) + len("export PATH")
            shell = SOURCE[start:end]
            shell = shell.replace("/usr/local/bin/", str(bin_dir) + "/")
            shell = shell.replace("/usr/local/sbin:", str(sbin_dir) + ":")
            env = os.environ.copy()
            env["ORDAX_DISTRIBUTION_PROFILE"] = profile
            env["ORDAX_PRODUCT_MODE"] = mode
            proc = subprocess.run(
                ["sh", "-c", shell + '\nprintf "%s" "$PATH"\n'],
                env=env, text=True, capture_output=True, check=True,
            )
            return str(bin_dir) in proc.stdout.split(":")

    def test_development_usb_with_both_tools_exposes_commands(self):
        self.assertTrue(self._manual_path_for("owner-development", "usb"))

    def test_stable_mvp_keeps_minimal_recovery(self):
        self.assertFalse(self._manual_path_for("stable-mvp", "usb"))

    def test_other_product_mode_keeps_minimal_recovery(self):
        self.assertFalse(self._manual_path_for("owner-development", "native-disk"))

    def test_incomplete_or_missing_tools_keeps_minimal_recovery(self):
        self.assertFalse(self._manual_path_for("owner-development", "usb", install_pull=False))
        self.assertFalse(self._manual_path_for("owner-development", "usb", install_run=False))


if __name__ == "__main__":
    unittest.main()
