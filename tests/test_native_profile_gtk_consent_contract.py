from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "system" / "surface" / "runtime" / "ordax_browser_host.py"
CONTROL_SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
ACTIVATION_COMMAND = ROOT / "system" / "surface" / "runtime" / "native_profile_activation_command.py"
ACTIVATION_ADAPTER = ROOT / "system" / "adapters" / "native" / "profile-activation-state.mjs"
LAUNCHER = ROOT / "system" / "surface" / "bin" / "ordax-surface"


class NativeProfileGtkConsentContractTests(unittest.TestCase):
    def test_trusted_dialog_lives_in_native_gtk_host(self):
        host = HOST.read_text(encoding="utf-8")
        self.assertIn("ProfileConsentIpcServer", host)
        self.assertIn("Gtk.Dialog(", host)
        self.assertIn("transient_for=self.window", host)
        self.assertIn("modal=True", host)
        self.assertIn("profile_consent_messages", host)
        self.assertIn("read_native_security_locale", host)
        self.assertIn('messages["approve"]', host)
        self.assertIn('messages["cancel"]', host)
        self.assertIn("permissionDiff", host)
        self.assertIn("profile_consent_ipc.send_decision", host)

    def test_human_consent_receipt_never_crosses_surface_or_http_boundary(self):
        adapter = ACTIVATION_ADAPTER.read_text(encoding="utf-8")
        server = CONTROL_SERVER.read_text(encoding="utf-8")
        command = ACTIVATION_COMMAND.read_text(encoding="utf-8")

        self.assertNotIn("humanConsent", adapter)
        self.assertNotIn('payload.get("humanConsent")', command)
        self.assertIn("human_consent_resolver=self.server.resolve_profile_human_consent", server)
        self.assertIn("receipt = human_consent_resolver(", command)
        self.assertIn("human_consent_authority.consume(", command)

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
