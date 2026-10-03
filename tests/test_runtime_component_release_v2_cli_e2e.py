import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHANNEL = ROOT / "tools" / "runtime-component-channel"
PACKAGE_TOOL = ROOT / "tools" / "component-package" / "build.py"
RELEASE_V2_TOOL = ROOT / "tools" / "component-package" / "release_v2.py"


def run(*args: str, cwd: Path = ROOT) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(args),
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
        timeout=60,
    )


class RuntimeComponentReleaseV2CliE2ETests(unittest.TestCase):
    def test_build_sign_verify_stage_and_verify_slot_without_activation(self):
        source_commit = run("git", "rev-parse", "HEAD").stdout.strip()
        self.assertRegex(source_commit, r"^[0-9a-f]{40}$")

        with tempfile.TemporaryDirectory() as temp:
            work = Path(temp)
            package = work / "local-ai-service.zip"
            compatibility = work / "local-ai-service.compatibility.json"
            release = work / "local-ai-service.release-v2.json"
            private_key = work / "runtime-component-private.pem"
            trust = work / "runtime-component-trust.json"
            envelope = work / "runtime-component-envelope-v2.json"
            slots = work / "slots"
            binary = work / "ordax-runtime-component-channel"

            run(
                "python",
                str(PACKAGE_TOOL),
                "build",
                "--component",
                "local-ai-service",
                "--source-commit",
                source_commit,
                "--out",
                str(package),
            )
            run(
                "python",
                str(RELEASE_V2_TOOL),
                "build",
                "--package",
                str(package),
                "--compatibility-out",
                str(compatibility),
                "--out",
                str(release),
            )
            run(
                "python",
                str(RELEASE_V2_TOOL),
                "verify",
                "--package",
                str(package),
                "--compatibility",
                str(compatibility),
                "--release",
                str(release),
            )

            run("go", "build", "-o", str(binary), ".", cwd=CHANNEL)
            generated = run(
                str(binary),
                "generate-key",
                "--private-key",
                str(private_key),
                "--trust",
                str(trust),
                "--key-id",
                "runtime-components-v2-e2e",
            )
            self.assertIn("RUNTIME_COMPONENT_KEY_GENERATED=YES", generated.stdout)
            if os.name != "nt":
                self.assertEqual(private_key.stat().st_mode & 0o777, 0o600)

            signed = run(
                str(binary),
                "sign-v2",
                "--release",
                str(release),
                "--compatibility",
                str(compatibility),
                "--private-key",
                str(private_key),
                "--trust",
                str(trust),
                "--out",
                str(envelope),
                "--key-id",
                "runtime-components-v2-e2e",
            )
            self.assertIn("RUNTIME_COMPONENT_RELEASE_V2_SIGNED=YES", signed.stdout)
            self.assertIn("DIRECT_ACTIVATION_ALLOWED=NO", signed.stdout)

            verified = run(
                str(binary),
                "verify-envelope-v2",
                "--envelope",
                str(envelope),
                "--trust",
                str(trust),
                "--compatibility",
                str(compatibility),
            )
            self.assertIn("RUNTIME_COMPONENT_RELEASE_V2_VERIFIED=YES", verified.stdout)
            self.assertIn("PENDING_HEALTH_REQUIRED=YES", verified.stdout)

            staged = run(
                str(binary),
                "stage-v2",
                "--envelope",
                str(envelope),
                "--trust",
                str(trust),
                "--package",
                str(package),
                "--compatibility",
                str(compatibility),
                "--root",
                str(slots),
            )
            self.assertIn("RUNTIME_COMPONENT_RELEASE_V2_STAGED=YES", staged.stdout)
            self.assertIn("ACTIVATED=NO", staged.stdout)

            release_value = json.loads(release.read_text("utf-8"))
            slot = (
                slots
                / release_value["component"]["id"]
                / "versions"
                / release_value["component"]["version"]
                / release_value["source_commit"]
            )
            self.assertTrue(slot.is_dir())

            slot_verified = run(
                str(binary),
                "verify-slot-v2",
                "--slot",
                str(slot),
                "--trust",
                str(trust),
            )
            self.assertIn(
                "RUNTIME_COMPONENT_RELEASE_V2_SLOT_VERIFIED=YES",
                slot_verified.stdout,
            )
            self.assertIn("DIRECT_ACTIVATION_ALLOWED=NO", slot_verified.stdout)

            self.assertFalse(any(slots.rglob("activation-state.json")))

            legacy = subprocess.run(
                [
                    str(binary),
                    "verify-envelope",
                    "--envelope",
                    str(envelope),
                    "--trust",
                    str(trust),
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertNotEqual(legacy.returncode, 0)
            self.assertIn("unsupported runtime component release schema", legacy.stderr)


if __name__ == "__main__":
    unittest.main()
