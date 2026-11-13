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

    def test_windows_installer_preserves_verified_private_dependencies(self):
        workflow = PRODUCER.read_text(encoding="utf-8")
        lock = json.loads(
            (ROOT / "system/services/local-ai/source-lock.json").read_text(encoding="utf-8")
        )
        vc = lock["engine"]["windows_artifact"]["msvc_runtime"]
        self.assertEqual(vc["publisher"], "Microsoft Corporation")
        self.assertEqual(vc["version"], "14.44.35211.0")
        self.assertEqual(
            [entry["name"] for entry in vc["files"]],
            ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"],
        )
        for marker in (
            "Restore exact private MinGit source archive cache",
            "Materialize pinned private MinGit for Windows Dev updates",
            "Verify source-pinned private MinGit on cache hit and miss",
            "Select exact Microsoft-signed app-local VC143 dependency set",
            "Reject unprovided MSVC dependencies in Windows Aura package",
            "pe-dependency-audit.cjs",
            "ORDAX_VC143_REDIST_SOURCE",
        ):
            self.assertIn(marker, workflow)
        self.assertIn(
            "materialize-local-ai.cjs $candidate $model out/windows-local-ai-runtime $env:ORDAX_VC143_REDIST_SOURCE",
            workflow,
        )
        mingit = workflow.index("Restore exact private MinGit source archive cache")
        aura = workflow.index("Restore content-pinned Windows Aura engine and model cache")
        vc_gate = workflow.index("Select exact Microsoft-signed app-local VC143 dependency set")
        materialize = workflow.index("Build and stage exact verified offline Aura payload")
        pe_gate = workflow.index("Reject unprovided MSVC dependencies in Windows Aura package")
        save = workflow.index("Save verified content-pinned Windows Aura cache")
        self.assertTrue(mingit < aura < vc_gate < materialize < pe_gate < save)

    def test_installer_consumes_external_desktop_checkout_not_retired_path(self):
        workflow = PRODUCER.read_text(encoding="utf-8")
        self.assertIn("out/ordax-desktop-source/standalone-stage.cjs", workflow)
        self.assertIn("WINDOWS_DESKTOP_DETACHED_SOURCE=VERIFIED", workflow)
        self.assertIn("Verify isolated NSIS installation and Native files", workflow)
        self.assertNotIn("tools/windows-desktop/", workflow)
        self.assertNotIn("ordax-desktop-owner-source-handoff", workflow)


if __name__ == "__main__":
    unittest.main()
