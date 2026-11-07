#!/usr/bin/env python3
"""Source-level guards for the runtime-component trust toolkit."""

from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = (ROOT / ".github" / "workflows" / "component-trust-toolkit.yml").read_text(
    encoding="utf-8"
)
INITIALIZER = (
    ROOT
    / "tools"
    / "runtime-component-channel"
    / "windows"
    / "Initialize-OrdaXComponentTrust.ps1"
).read_text(encoding="utf-8")
FINALIZER = (
    ROOT
    / "tools"
    / "runtime-component-channel"
    / "windows"
    / "Complete-OrdaXComponentTrust.ps1"
).read_text(encoding="utf-8")


PROMOTER = (
    ROOT / "tools" / "runtime-component-channel" / "promote_public_trust.py"
).read_text(encoding="utf-8")
PACKAGE_POLICY = json.loads(
    (ROOT / "docs" / "contracts" / "runtime-component-package.json").read_text(
        encoding="utf-8"
    )
)



class ComponentTrustToolkitTests(unittest.TestCase):
    def test_toolkit_is_canonical_only_for_main_push_with_prerequisites(self):
        self.assertIn("prototype-ordax.component-trust-toolkit/1", WORKFLOW)
        self.assertIn("canonical_component_trust_ceremony_eligible", WORKFLOW)
        self.assertIn("os.environ['GITHUB_EVENT_NAME'] == 'push'", WORKFLOW)
        self.assertIn("os.environ['GITHUB_REF'] == 'refs/heads/main'", WORKFLOW)
        self.assertIn("all(prerequisites.values())", WORKFLOW)
        self.assertIn("'native_read_broker_available'", WORKFLOW)
        self.assertIn("'production_activation_still_blocked'", WORKFLOW)
        self.assertIn("contract.get('publish_allowed') is False", WORKFLOW)
        self.assertIn(
            "contract.get('canonical_component_trust_anchor_pinned') is False",
            WORKFLOW,
        )

    def test_toolkit_contains_no_key_and_requires_local_generation(self):
        self.assertIn("'private_key_included': False", WORKFLOW)
        self.assertIn("'canonical_public_trust_included': False", WORKFLOW)
        self.assertIn("'key_generation_requires_local_user_action': True", WORKFLOW)
        self.assertIn("'whole_os_release_key_reuse_allowed': False", WORKFLOW)
        self.assertIn("'policy_sha256': digest('component-trust-policy.json')", WORKFLOW)
        self.assertIn("'ceremony_doc_sha256': digest('COMPONENT-TRUST-CEREMONY.md')", WORKFLOW)
        self.assertIn("cp docs/COMPONENT-TRUST-CEREMONY.md", WORKFLOW)
        self.assertIn("cp docs/contracts/runtime-component-trust-policy.json", WORKFLOW)
        self.assertIn("COMPONENT_TRUST_TOOLKIT_SECRET_MATERIAL=NONE", WORKFLOW)
        self.assertNotIn("generate-key --private-key", WORKFLOW)
        self.assertNotIn("runtime-component-private.pem", WORKFLOW)

    def test_initializer_preflight_is_read_only_and_generation_is_explicit(self):
        self.assertIn("[switch]$PreflightOnly", INITIALIZER)
        self.assertIn("[switch]$GenerateKey", INITIALIZER)
        self.assertIn("[switch]$ResumeExistingKey", INITIALIZER)
        self.assertIn("COMPONENT_TRUST_TOOLKIT_PREFLIGHT=PASS", INITIALIZER)
        self.assertIn("PRIVATE_KEY_TOUCHED=NO", INITIALIZER)
        self.assertIn("FILESYSTEM_MUTATION=NO", INITIALIZER)
        self.assertIn("if ($PreflightOnly)", INITIALIZER)
        self.assertIn("if (-not $GenerateKey -and -not $ResumeExistingKey)", INITIALIZER)
        self.assertIn("Refusing key generation without explicit -GenerateKey", INITIALIZER)
        self.assertLess(
            INITIALIZER.index("if ($PreflightOnly)"),
            INITIALIZER.index("New-Item -ItemType Directory"),
        )
        self.assertLess(
            INITIALIZER.index("if (-not $GenerateKey -and -not $ResumeExistingKey)"),
            INITIALIZER.index("& $Signer generate-key"),
        )

    def test_resume_preserves_legacy_public_files_and_is_explicit(self):
        self.assertIn("GenerateKey and ResumeExistingKey are mutually exclusive", INITIALIZER)
        self.assertIn("Assert-PublicBytesEqual $OldTrust $OldDerived", INITIALIZER)
        self.assertIn("Assert-PublicBytesEqual $OldDerived $DerivedPath", INITIALIZER)
        self.assertIn("resumed-current-toolkit", INITIALIZER)
        self.assertIn("Move-Item -LiteralPath $ResumeStage -Destination $ResumeTarget", INITIALIZER)
        self.assertIn("COMPONENT_TRUST_RESUME=ALREADY_COMPLETE", INITIALIZER)
        self.assertIn("production_authority = $false", INITIALIZER)
        self.assertIn("Resumed component ceremony no longer matches", FINALIZER)
        self.assertIn("2-Resume-OrdaXComponentTrust.cmd", WORKFLOW)

    def test_initializer_binds_toolkit_hashes_and_source_commit(self):
        self.assertIn("prototype-ordax.component-trust-toolkit/1", INITIALIZER)
        self.assertIn("source_event -ne 'push'", INITIALIZER)
        self.assertIn("source_ref -ne 'refs/heads/main'", INITIALIZER)
        self.assertIn("canonical_component_trust_ceremony_eligible -ne $true", INITIALIZER)
        self.assertIn("components.component_signer.sha256", INITIALIZER)
        self.assertIn("components.trust_initializer.sha256", INITIALIZER)
        self.assertIn("Get-FileHash -Algorithm SHA256", INITIALIZER)
        self.assertIn("component-trust-policy.json", INITIALIZER)
        self.assertIn("COMPONENT-TRUST-CEREMONY.md", INITIALIZER)
        self.assertIn("policy/document bytes do not match toolkit provenance", INITIALIZER)
        self.assertIn("operator-ceremony-pending", INITIALIZER)
        self.assertIn("system/trust/runtime-components-ed25519.json", INITIALIZER)
        self.assertIn("^[0-9a-f]{40}$", INITIALIZER)

    def test_protocol_proof_is_an_os_owned_packaging_only_component(self):
        self.assertIn("local-ai-service", PACKAGE_POLICY["supported_components"])
        self.assertIn("local-ai-service", PACKAGE_POLICY["packaging_only_components"])
        self.assertNotIn(
            "local-ai-service",
            PACKAGE_POLICY["canonical_package_source_repository_by_component"],
        )
        self.assertEqual(PACKAGE_POLICY["default_source_repository"], "ordaxsystems/ordax-os")
        self.assertEqual(
            PACKAGE_POLICY["canonical_package_source_repository_by_component"]["internet"],
            "ordaxsystems/ordax-apps",
        )
        self.assertIn('PROOF_COMPONENT_ID = "local-ai-service"', PROMOTER)
        self.assertIn('"release_mode": "bundled"', PROMOTER)
        self.assertNotIn('PROOF_COMPONENT_ID = "internet"', PROMOTER)

    def test_initializer_proves_independent_derivation_and_real_protocol_signature(self):
        self.assertIn("ordax-runtime-components-v1", INITIALIZER)
        self.assertIn("prototype-ordax.runtime-component-trust/1", INITIALIZER)
        self.assertIn("prototype-ordax.runtime-component-release/1", INITIALIZER)
        self.assertIn("release_mode = 'bundled'", INITIALIZER)
        self.assertIn("id = 'local-ai-service'", INITIALIZER)
        self.assertIn("name = 'local-ai-service.zip'", INITIALIZER)
        self.assertNotIn("id = 'internet'", INITIALIZER)
        self.assertIn("pending_health_required = $true", INITIALIZER)
        self.assertIn("& $Signer derive-trust", INITIALIZER)
        self.assertIn("& $Signer sign", INITIALIZER)
        self.assertIn("& $Signer verify-envelope", INITIALIZER)
        self.assertIn("INDEPENDENT_PUBLIC_DERIVATION_MATCH=YES", INITIALIZER)
        self.assertIn("READY_TO_PIN_PUBLIC_ANCHOR=NO", INITIALIZER)

    def test_recovery_requires_distinct_restored_key_and_public_only_handoff(self):
        self.assertIn("Recovered private key must be a distinct restored file", FINALIZER)
        self.assertIn("& $Signer derive-trust", FINALIZER)
        self.assertIn("& $Signer sign", FINALIZER)
        self.assertIn("& $Signer verify-envelope", FINALIZER)
        self.assertIn("offline_encrypted_backup_recovery_verified = $true", FINALIZER)
        self.assertIn("private_key_in_public_evidence = $false", FINALIZER)
        self.assertIn("PUBLIC_HANDOFF_SECRET_MATERIAL=NO", FINALIZER)
        self.assertIn("READY_TO_PIN_PUBLIC_ANCHOR=YES", FINALIZER)
        self.assertIn("OrdaX-Component-Public-Trust-Handoff.zip", FINALIZER)
        self.assertIn("proof_release_sha256", FINALIZER)
        self.assertIn("proof_envelope_sha256", FINALIZER)
        self.assertIn("Initial component trust ceremony files changed", FINALIZER)
        self.assertIn("Initial component trust envelope no longer verifies", FINALIZER)
        self.assertIn("$ProofRelease.component.id -ne 'local-ai-service'", FINALIZER)
        self.assertIn("$ProofRelease.component.release_mode -ne 'bundled'", FINALIZER)
        self.assertIn("Expand-Archive", FINALIZER)
        self.assertIn("handoff ZIP changed bytes", FINALIZER)
        self.assertIn("component-trust-policy.json", FINALIZER)
        self.assertIn("COMPONENT-TRUST-CEREMONY.md", FINALIZER)
        self.assertIn("recovery toolkit/policy bytes do not match provenance", FINALIZER)
        self.assertIn("operator-ceremony-pending", FINALIZER)

    def test_ceremony_scripts_have_single_canonical_body(self):
        self.assertEqual(INITIALIZER.count("[CmdletBinding()]"), 1)
        self.assertEqual(INITIALIZER.count("COMPONENT_TRUST_INITIALIZATION=PASS"), 1)
        self.assertEqual(INITIALIZER.count("Refusing key generation without explicit -GenerateKey"), 1)
        self.assertEqual(FINALIZER.count("[CmdletBinding()]"), 1)
        self.assertEqual(FINALIZER.count("COMPONENT_TRUST_RECOVERY=PASS"), 1)
        self.assertEqual(FINALIZER.count("READY_TO_PIN_PUBLIC_ANCHOR=YES"), 1)

    def test_windows_ci_parses_both_scripts(self):
        self.assertIn("runs-on: windows-latest", WORKFLOW)
        self.assertIn("Initialize-OrdaXComponentTrust.ps1", WORKFLOW)
        self.assertIn("Complete-OrdaXComponentTrust.ps1", WORKFLOW)
        self.assertIn("2-Resume-OrdaXComponentTrust.cmd", WORKFLOW)
        self.assertIn("COMPONENT_TRUST_POWERSHELL_PARSE=PASS", WORKFLOW)


if __name__ == "__main__":
    unittest.main()
