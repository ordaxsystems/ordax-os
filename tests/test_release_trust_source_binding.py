from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INITIALIZER = (
    ROOT / "tools/release-signing/windows/Initialize-OrdaXReleaseTrust.ps1"
).read_text(encoding="utf-8")
FINALIZER = (
    ROOT / "tools/release-signing/windows/Complete-OrdaXReleaseTrust.ps1"
).read_text(encoding="utf-8")
TOOLKIT = (
    ROOT / ".github/workflows/windows-prototype-toolkit.yml"
).read_text(encoding="utf-8")
PREFLIGHT_WRAPPER = (
    ROOT / "tools/release-signing/windows/1-Verify-OrdaXTrustToolkit.cmd"
).read_text(encoding="utf-8")
INITIALIZER_WRAPPER = (
    ROOT / "tools/release-signing/windows/2-Initialize-OrdaXTrust.cmd"
).read_text(encoding="utf-8")


def test_read_only_preflight_reuses_initializer_checks_before_key_generation():
    assert "[switch]$PreflightOnly" in INITIALIZER
    assert "if ($PreflightOnly)" in INITIALIZER
    assert "TOOLKIT_TRUST_PREFLIGHT=PASS" in INITIALIZER
    assert "CANONICAL_TRUST_CEREMONY_ELIGIBLE=YES" in INITIALIZER
    assert "PRIVATE_KEY_TOUCHED=NO" in INITIALIZER
    assert "FILESYSTEM_MUTATION=NO" in INITIALIZER
    assert INITIALIZER.index("if ($PreflightOnly)") < INITIALIZER.index("New-Item -ItemType Directory")
    assert INITIALIZER.index("if ($PreflightOnly)") < INITIALIZER.index("USERPROFILE is unavailable")
    assert INITIALIZER.index("if ($PreflightOnly)") < INITIALIZER.index("$PrivateKeyPath = [IO.Path]::GetFullPath")
    assert '-PreflightOnly' in PREFLIGHT_WRAPPER
    assert '1-Verify-OrdaXTrustToolkit.cmd' in TOOLKIT
    assert '1-Verify-OrdaXTrustToolkit.cmd \\' in TOOLKIT


def test_key_generation_requires_explicit_switch_after_preflight():
    assert "[switch]$GenerateKey" in INITIALIZER
    assert "if ($PreflightOnly -and $GenerateKey)" in INITIALIZER
    assert "if (-not $GenerateKey)" in INITIALIZER
    assert "Canonical key generation requires the explicit -GenerateKey switch." in INITIALIZER
    assert INITIALIZER.index("if (-not $GenerateKey)") < INITIALIZER.index("New-Item -ItemType Directory")
    assert "-GenerateKey" in INITIALIZER_WRAPPER
    assert "-PreflightOnly" not in INITIALIZER_WRAPPER
    assert "-GenerateKey" not in PREFLIGHT_WRAPPER


def test_toolkit_uses_full_history_for_one_shot_evidence_ancestry():
    toolkit_job = TOOLKIT.split("jobs:", 1)[1].split("windows-native-tests:", 1)[0]
    assert "fetch-depth: 0" in toolkit_job
    assert "git', 'merge-base', '--is-ancestor'" in TOOLKIT
    assert "one_shot.get('source_commit')" in TOOLKIT
    assert "'portable_v3_one_shot_failure_fallback_proven'" in TOOLKIT


def test_toolkit_workflow_tracks_every_canonical_eligibility_input():
    for path in (
        "docs/contracts/portable-v2-qemu-boot-proof.json",
        "docs/contracts/portable-v2-uefi-boot-proof.json",
        "docs/evidence/portable-v3-one-shot-qemu-proof.json",
        "docs/contracts/creator-portable-media-plan.json",
        "docs/contracts/physical-write-authorization.json",
    ):
        assert TOOLKIT.count(f"- '{path}'") == 2


def test_canonical_toolkit_eligibility_requires_portable_runtime_v3_prerequisites():
    for marker in (
        "'portable_runtime_v3_direct_kernel_proven'",
        "'portable_runtime_v3_uefi_ovmf_proven'",
        "'portable_v3_one_shot_failure_fallback_proven'",
        "'portable_writer_v2_implemented_fail_closed'",
        "'physical_authorization_still_fail_closed'",
        "physical_auth.get('authorization_context_sha256') in (None, '')",
        "'canonical_trust_prerequisites': trust_prerequisites",
        "canonical_main_push and all(trust_prerequisites.values())",
    ):
        assert marker in TOOLKIT

    for source in (INITIALIZER, FINALIZER):
        assert "$ToolkitProvenance.canonical_trust_prerequisites" in source
        assert "$TrustPrerequisites.portable_runtime_v3_direct_kernel_proven -ne $true" in source
        assert "$TrustPrerequisites.portable_runtime_v3_uefi_ovmf_proven -ne $true" in source
        assert "$TrustPrerequisites.portable_v3_one_shot_failure_fallback_proven -ne $true" in source
        assert "$TrustPrerequisites.portable_writer_v2_implemented_fail_closed -ne $true" in source
        assert "$TrustPrerequisites.physical_authorization_still_fail_closed -ne $true" in source
        assert "required Portable runtime-v3, one-shot fallback and fail-closed writer prerequisites" in source


def test_trust_ceremony_binds_proof_to_toolkit_source_commit():
    assert "$ToolkitProvenancePath = Join-Path $ScriptRoot 'provenance.json'" in INITIALIZER
    assert "prototype-ordax.windows-prototype-toolkit/2" in INITIALIZER
    assert "$ToolkitSourceCommit -notmatch '^[0-9a-f]{40}$'" in INITIALIZER
    assert "$ProofCommit = $ToolkitSourceCommit" in INITIALIZER
    assert "source_commit = $ToolkitSourceCommit" in INITIALIZER
    assert 'Write-Host "SOURCE_COMMIT=$ToolkitSourceCommit"' in INITIALIZER
    assert "'source_commit': os.environ['GITHUB_SHA']" in TOOLKIT
    assert "(root / 'provenance.json').write_text" in TOOLKIT


def test_trust_ceremony_verifies_toolkit_components_before_key_generation():
    assert "$ToolkitProvenance.components.release_signer.sha256" in INITIALIZER
    assert "$ToolkitProvenance.components.trust_initializer.sha256" in INITIALIZER
    assert "Get-FileHash -Algorithm SHA256 -LiteralPath $Signer" in INITIALIZER
    assert "Get-FileHash -Algorithm SHA256 -LiteralPath $ScriptPath" in INITIALIZER
    assert "Release signer bytes do not match toolkit provenance." in INITIALIZER
    assert "Trust initializer bytes do not match toolkit provenance." in INITIALIZER
    assert "TOOLKIT_COMPONENT_HASHES_VERIFIED=YES" in INITIALIZER
    assert "'release_signer': {'name': 'ordax-release-signing.exe', 'sha256': digest('ordax-release-signing.exe')}" in TOOLKIT
    assert "'trust_initializer': {'name': 'Initialize-OrdaXReleaseTrust.ps1', 'sha256': digest('Initialize-OrdaXReleaseTrust.ps1')}" in TOOLKIT


def test_recovery_refuses_source_identity_drift():
    assert "$ToolkitProvenancePath = Join-Path $ScriptRoot 'provenance.json'" in FINALIZER
    assert "$ToolkitProvenance.components.trust_recovery_finalizer.sha256" in FINALIZER
    assert "Trust recovery finalizer bytes do not match toolkit provenance." in FINALIZER
    assert "$InitialSourceCommit -ne $ToolkitSourceCommit" in FINALIZER
    assert "Initial trust ceremony source_commit does not match toolkit provenance." in FINALIZER
    assert "[string]$ProofManifest.source_commit -ne $ToolkitSourceCommit" in FINALIZER
    assert "[string]$ProofManifest.release_id -ne $ToolkitSourceCommit" in FINALIZER
    assert "Trust proof manifest source identity does not match toolkit provenance." in FINALIZER
    assert "TRUST_PROOF_SOURCE_IDENTITY_MATCH=YES" in FINALIZER
    assert "'trust_recovery_finalizer': {'name': 'Complete-OrdaXReleaseTrust.ps1', 'sha256': digest('Complete-OrdaXReleaseTrust.ps1')}" in TOOLKIT


def test_trust_ceremony_still_requires_local_private_custody():
    assert "The private key must be outside the downloaded toolkit/repository directory." in INITIALIZER
    assert "ready_to_pin_public_anchor = $false" in INITIALIZER
    assert "READY_TO_PIN_PUBLIC_ANCHOR=NO" in INITIALIZER
    assert "Assert-PrivateOutsideToolkit $PrimaryPrivateKeyPath" in FINALIZER
    assert "Assert-PrivateOutsideToolkit $RecoveredPrivateKeyPath" in FINALIZER


def test_canonical_trust_rejects_pr_and_manual_toolkits():
    assert "'source_repository': os.environ['GITHUB_REPOSITORY']" in TOOLKIT
    assert "'source_ref': os.environ['GITHUB_REF']" in TOOLKIT
    assert "'source_event': os.environ['GITHUB_EVENT_NAME']" in TOOLKIT
    assert "'canonical_trust_ceremony_eligible': (" in TOOLKIT
    assert "os.environ['GITHUB_EVENT_NAME'] == 'push'" in TOOLKIT
    assert "os.environ['GITHUB_REF'] == 'refs/heads/main'" in TOOLKIT
    for source in (INITIALIZER, FINALIZER):
        assert "$ToolkitProvenance.source_repository -ne 'ordaxsystems/ordax-os'" in source
        assert "$ToolkitProvenance.source_event -ne 'push'" in source
        assert "$ToolkitProvenance.source_ref -ne 'refs/heads/main'" in source
        assert "$ToolkitProvenance.canonical_trust_ceremony_eligible -ne $true" in source
        assert "Canonical trust ceremony requires a toolkit produced by an eligible push of the canonical main branch." in source
