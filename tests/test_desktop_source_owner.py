"""Single-owner Desktop cutover gates: OS ships Native, not an Electron fork."""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs/contracts/distribution-profiles.json"
PRODUCER = ROOT / ".github/workflows/windows-desktop-dev.yml"


class DesktopSourceOwnerTests(unittest.TestCase):
    def test_os_does_not_ship_a_second_electron_source(self):
        self.assertFalse((ROOT / "tools/windows-desktop").exists(),
                         "Electron implementation belongs exclusively to ordax-desktop")

    def test_os_distribution_contract_links_canonical_desktop_owner(self):
        profile = json.loads(CONTRACT.read_text(encoding="utf-8"))
        adapters = profile["profiles"]["owner-development"]["runtime_host_adapters"]
        desktop = adapters["windows-desktop"]
        self.assertEqual(desktop["git_main_materializer"],
                         "ordaxsystems/ordax-desktop/dev-update.cjs")
        self.assertEqual(desktop["health_promotion_owner"],
                         "ordaxsystems/ordax-desktop/dev-update.cjs")
        self.assertEqual(desktop["application_relaunch_owner"],
                         "ordaxsystems/ordax-desktop/main.cjs")
        self.assertFalse(desktop["electron_shell_self_update_implemented"])

    def test_only_desktop_repo_can_invoke_single_windows_installer_producer(self):
        workflow = PRODUCER.read_text(encoding="utf-8")
        header = workflow.split("\npermissions:", 1)[0]
        self.assertIn("\n  workflow_call:", header)
        self.assertNotIn("\n  pull_request:", header)
        self.assertNotIn("\n  push:", header)
        self.assertNotIn("\n  workflow_dispatch:", header)
        self.assertIn("repository: ordaxsystems/ordax-os", workflow)
        self.assertIn("repository: ordaxsystems/ordax-desktop", workflow)
        self.assertIn("ref: ${{ inputs.os_sha }}", workflow)
        self.assertIn("ref: ${{ inputs.desktop_sha }}", workflow)
        self.assertIn("DESKTOP_OWNER_SHA: ${{ inputs.desktop_sha }}", workflow)

    def test_installer_consumes_external_desktop_checkout_not_retired_path(self):
        workflow = PRODUCER.read_text(encoding="utf-8")
        self.assertIn("out/ordax-desktop-source/standalone-stage.cjs", workflow)
        self.assertIn("WINDOWS_DESKTOP_DETACHED_SOURCE=VERIFIED", workflow)
        self.assertIn("Verify isolated NSIS installation and Native files", workflow)
        self.assertNotIn("tools/windows-desktop/", workflow)
        self.assertNotIn("ordax-desktop-owner-source-handoff", workflow)


if __name__ == "__main__":
    unittest.main()
