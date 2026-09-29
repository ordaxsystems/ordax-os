#!/usr/bin/env python3
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
WORKFLOW=(ROOT/'.github/workflows/profile-content-trust-toolkit.yml').read_text(encoding='utf-8')
INIT=(ROOT/'tools/profile-content-channel/windows/Initialize-OrdaXProfileContentTrust.ps1').read_text(encoding='utf-8')
FINAL=(ROOT/'tools/profile-content-channel/windows/Complete-OrdaXProfileContentTrust.ps1').read_text(encoding='utf-8')
DOC=(ROOT/'docs/PROFILE-CONTENT-TRUST-CEREMONY.md').read_text(encoding='utf-8')

class ProfileContentTrustToolkitTests(unittest.TestCase):
    def test_only_main_push_can_be_canonical(self):
        self.assertIn("prototype-ordax.profile-content-trust-toolkit/1",WORKFLOW)
        self.assertIn("GITHUB_EVENT_NAME']=='push'",WORKFLOW)
        self.assertIn("GITHUB_REF']=='refs/heads/main'",WORKFLOW)
        self.assertIn("canonical_profile_content_trust_ceremony_eligible",WORKFLOW)
        self.assertIn("private_key_included':False",WORKFLOW)
        self.assertIn("canonical_public_trust_included':False",WORKFLOW)
        self.assertNotIn("generate-key --private-key",WORKFLOW)

    def test_initializer_is_explicit_and_preflight_is_read_only(self):
        self.assertIn("[switch]$PreflightOnly",INIT)
        self.assertIn("[switch]$GenerateKey",INIT)
        self.assertIn("PRIVATE_KEY_TOUCHED=NO",INIT)
        self.assertIn("FILESYSTEM_MUTATION=NO",INIT)
        self.assertIn("Refusing key generation without explicit -GenerateKey",INIT)
        self.assertLess(INIT.index("if ($PreflightOnly)"),INIT.index("New-Item -ItemType Directory"))
        self.assertLess(INIT.index("if (-not $GenerateKey)"),INIT.index("& $Signer generate-key"))

    def test_initializer_proves_independent_derivation_and_signature(self):
        self.assertIn("& $Signer derive-trust",INIT)
        self.assertIn("& $Signer sign",INIT)
        self.assertIn("& $Signer verify",INIT)
        self.assertIn("INDEPENDENT_PUBLIC_DERIVATION_MATCH=YES",INIT)
        self.assertIn("READY_TO_PIN_PUBLIC_ANCHOR=NO",INIT)
        self.assertIn("requested_capabilities = @()",INIT)
        self.assertIn("runtime_network_allowed = $false",INIT)
        self.assertIn("mutable_host_access_allowed = $false",INIT)

    def test_recovery_requires_distinct_key_and_public_only_handoff(self):
        self.assertIn("Recovered private key must be a distinct restored file",FINAL)
        self.assertIn("& $Signer derive-trust",FINAL)
        self.assertIn("& $Signer sign",FINAL)
        self.assertIn("& $Signer verify",FINAL)
        self.assertIn("offline_encrypted_backup_recovery_verified=$true",FINAL)
        self.assertIn("private_key_in_public_evidence=$false",FINAL)
        self.assertIn("PUBLIC_HANDOFF_SECRET_MATERIAL=NO",FINAL)
        self.assertIn("READY_TO_PIN_PUBLIC_ANCHOR=YES",FINAL)
        self.assertIn("OrdaX-Profile-Content-Public-Trust-Handoff.zip",FINAL)

    def test_policy_remains_fail_closed(self):
        self.assertIn("profile_content_publish_allowed -ne $false",INIT)
        self.assertIn("profile_content_install_allowed -ne $false",INIT)
        self.assertIn("profile_content_activation_allowed -ne $false",INIT)
        self.assertIn("first-public-profile-proof",DOC)

if __name__=='__main__':
    unittest.main()
