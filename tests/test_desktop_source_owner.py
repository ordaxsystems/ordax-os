"""Single-owner Desktop cutover gates: OS ships exactly one Electron host."""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs/contracts/distribution-profiles.json"
PRODUCER = ROOT / ".github/workflows/windows-desktop-dev.yml"


class DesktopSourceOwnerTests(unittest.TestCase):
    def test_os_does_not_ship_a_second_electron_source(self):
        self.assertFalse((ROOT / "tools/windows-desktop").exists(),
                         "Do not restore tools/windows-desktop as a second host")

    def test_os_distribution_contract_links_canonical_desktop_owner(self):
        profile = json.loads(CONTRACT.read_text(encoding="utf-8"))
        adapters = profile["profiles"]["owner-development"]["runtime_host_adapters"]
        desktop = adapters["windows-desktop"]
        self.assertEqual(desktop["git_main_materializer"],
                         "ordaxsystems/ordax-os/desktop/dev-update.cjs")
        self.assertEqual(desktop["health_promotion_owner"],
                         "ordaxsystems/ordax-os/desktop/dev-update.cjs")
        self.assertEqual(desktop["application_relaunch_owner"],
                         "ordaxsystems/ordax-os/desktop/main.cjs")
        self.assertFalse(desktop["electron_shell_self_update_implemented"])

    def test_single_os_repo_owns_windows_installer_producer(self):
        workflow = PRODUCER.read_text(encoding="utf-8")
        header = workflow.split("\npermissions:", 1)[0]
        self.assertIn("\n  workflow_call:", header)
        self.assertNotIn("\n  pull_request:", header)
        self.assertNotIn("\n  push:", header)
        self.assertIn("\n  workflow_dispatch:", header)
        self.assertIn("repository: ordaxsystems/ordax-os", workflow)
        self.assertNotIn("repository: ordaxsystems/ordax-desktop", workflow)
        self.assertIn("ref: ${{ inputs.os_sha }}", workflow)
        self.assertNotIn("inputs.desktop_sha", workflow)
        self.assertIn("node desktop/standalone-stage.cjs", workflow)
        self.assertIn(
            "$verified = & python tools/surface-source/materialize.py verify --os-root .",
            workflow,
        )
        self.assertIn("[IO.File]::WriteAllText(", workflow)
        self.assertIn("$proof.source_commit -cne $sha", workflow)
        self.assertLess(
            workflow.index("surface-source-receipt.json"),
            workflow.index("name: Bind installer to exact OS + Surface Native provenance"),
            "The canonical same-commit Surface receipt must exist before binding",
        )

    def test_windows_installer_preserves_verified_private_dependencies(self):
        workflow = PRODUCER.read_text(encoding="utf-8")
        lock = json.loads(
            (ROOT / "system/services/local-ai/source-lock.json").read_text(encoding="utf-8")
        )
        windows = lock["engine"]["windows_artifact"]
        vc = windows["msvc_runtime"]
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
            "Fetch and stage exact proven offline Aura payload",
            "windows-local-ai-engine-$shortBuilder-$proofRun",
            "Get-FileHash -LiteralPath $archive -Algorithm SHA256",
            "fetch-pinned-local-ai-model.py",
            "Reject unprovided MSVC dependencies in Windows Aura package",
            "pe-dependency-audit.cjs",
            "ORDAX_VC143_REDIST_SOURCE",
        ):
            self.assertIn(marker, workflow)
        self.assertIn(
            "materialize-local-ai.cjs $candidate $model out/windows-local-ai-runtime $env:ORDAX_VC143_REDIST_SOURCE",
            workflow,
        )
        self.assertNotIn("windows-candidate.py", workflow)
        self.assertNotIn("Acquire exact Intelligence source for Windows engine", workflow)
        self.assertNotIn("repository: ordaxsystems/ordax-intelligence", workflow)
        helper = (ROOT / "tools/windows-emulator/fetch-pinned-local-ai-model.py").read_text(encoding="utf-8")
        self.assertIn("builder.download_exact(", helper)
        self.assertIn("builder.model_url(lock)", helper)
        self.assertNotIn("urllib", helper)
        self.assertNotIn("requests", helper)
        mingit = workflow.index("Restore exact private MinGit source archive cache")
        aura = workflow.index("Restore content-pinned Windows Aura engine and model cache")
        vc_gate = workflow.index("Select exact Microsoft-signed app-local VC143 dependency set")
        materialize = workflow.index("Fetch and stage exact proven offline Aura payload")
        pe_gate = workflow.index("Reject unprovided MSVC dependencies in Windows Aura package")
        save = workflow.index("Save verified content-pinned Windows Aura cache")
        self.assertTrue(mingit < aura < vc_gate < materialize < pe_gate < save)

    def test_installer_consumes_same_commit_desktop_from_monorepo(self):
        workflow = PRODUCER.read_text(encoding="utf-8")
        self.assertIn("desktop/standalone-stage.cjs", workflow)
        self.assertIn("WINDOWS_DESKTOP_MONOREPO_SOURCE=VERIFIED", workflow)
        self.assertIn("Verify isolated NSIS installation and Native files", workflow)
        self.assertNotIn("tools/windows-desktop/", workflow)
        self.assertNotIn("ordax-desktop-owner-source-handoff", workflow)
        self.assertNotIn("out/ordax-desktop-source", workflow)
        self.assertNotIn("--desktop-root", workflow)


if __name__ == "__main__":
    unittest.main()
