from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "system" / "surface" / "runtime" / "ordax_browser_host.py"
LAUNCHER = ROOT / "system" / "surface" / "bin" / "ordax-surface"


class NativeProfileGtkConsentContractTests(unittest.TestCase):
    def test_trusted_dialog_lives_in_native_gtk_host(self):
        host = HOST.read_text(encoding="utf-8")
        self.assertIn("ProfileConsentIpcServer", host)
        self.assertIn("Gtk.Dialog(", host)
        self.assertIn("transient_for=self.window", host)
        self.assertIn("modal=True", host)
        self.assertIn("Ativar perfil", host)
        self.assertIn("Cancelar", host)
        self.assertIn("permissionDiff", host)
        self.assertIn("profile_consent_ipc.send_decision", host)

    def test_stable_mvp_does_not_open_profile_consent_socket(self):
        host = HOST.read_text(encoding="utf-8")
        self.assertIn('if self.distribution_profile == "owner-development":', host)
        self.assertIn("self.start_profile_consent_listener()", host)
        self.assertIn('choices=("owner-development", "stable-mvp")', host)

    def test_launcher_passes_distribution_profile_to_graphical_host(self):
        launcher = LAUNCHER.read_text(encoding="utf-8")
        self.assertIn('--distribution-profile "$DISTRIBUTION_PROFILE"', launcher)


if __name__ == "__main__":
    unittest.main()
