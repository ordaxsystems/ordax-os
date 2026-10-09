[CmdletBinding()]
param(
    [string]$PrivateKeyPath,
    [string]$ReviewDirectory,
    [switch]$PreflightOnly,
    [switch]$GenerateKey
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($PreflightOnly -and $GenerateKey) {
    throw 'PreflightOnly and GenerateKey are mutually exclusive.'
}

$ScriptPath = $PSCommandPath
if ([string]::IsNullOrWhiteSpace($ScriptPath)) {
    $ScriptPath = $MyInvocation.MyCommand.Path
}
if ([string]::IsNullOrWhiteSpace($ScriptPath)) {
    throw 'Unable to resolve the trust ceremony script path.'
}
$ScriptPath = [IO.Path]::GetFullPath($ScriptPath)
$ScriptRoot = Split-Path -Parent $ScriptPath
if ([string]::IsNullOrWhiteSpace($ScriptRoot)) {
    throw 'Unable to resolve the trust ceremony script directory.'
}

$KeyId = 'ordax-prototype-release-v1'
$Signer = Join-Path $ScriptRoot 'ordax-release-signing.exe'
$ToolkitProvenancePath = Join-Path $ScriptRoot 'provenance.json'
if (-not (Test-Path -LiteralPath $Signer -PathType Leaf)) {
    throw "ordax-release-signing.exe was not found next to this script: $Signer"
}
if (-not (Test-Path -LiteralPath $ToolkitProvenancePath -PathType Leaf)) {
    throw "Toolkit provenance was not found next to this script: $ToolkitProvenancePath"
}
$ToolkitProvenanceItem = Get-Item -LiteralPath $ToolkitProvenancePath -Force
if (($ToolkitProvenanceItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Toolkit provenance may not be a reparse point or symlink.'
}
$ToolkitProvenance = Get-Content -LiteralPath $ToolkitProvenancePath -Raw | ConvertFrom-Json
if ($ToolkitProvenance.'$schema' -ne 'prototype-ordax.windows-prototype-toolkit/2' -or
    $ToolkitProvenance.status -ne 'candidate') {
    throw 'Toolkit provenance schema or status is invalid.'
}
if ($ToolkitProvenance.source_repository -ne 'ordaxsystems/ordax-os' -or
    $ToolkitProvenance.source_event -ne 'push' -or
    $ToolkitProvenance.source_ref -ne 'refs/heads/main' -or
    $ToolkitProvenance.canonical_trust_ceremony_eligible -ne $true) {
    throw 'Canonical trust ceremony requires a toolkit produced by an eligible push of the canonical main branch.'
}
$TrustPrerequisites = $ToolkitProvenance.canonical_trust_prerequisites
if ($null -eq $TrustPrerequisites -or
    $TrustPrerequisites.portable_runtime_v3_direct_kernel_proven -ne $true -or
    $TrustPrerequisites.portable_runtime_v3_uefi_ovmf_proven -ne $true -or
    $TrustPrerequisites.portable_v3_one_shot_failure_fallback_proven -ne $true -or
    $TrustPrerequisites.portable_writer_v2_implemented_fail_closed -ne $true -or
    $TrustPrerequisites.physical_authorization_still_fail_closed -ne $true) {
    throw 'Canonical trust ceremony toolkit does not contain the required Portable runtime-v3, one-shot fallback and fail-closed writer prerequisites.'
}
$ToolkitSourceCommit = [string]$ToolkitProvenance.source_commit
if ($ToolkitSourceCommit -notmatch '^[0-9a-f]{40}$') {
    throw 'Toolkit provenance source_commit must be exactly 40 lowercase hexadecimal characters.'
}
$ExpectedSignerSha256 = [string]$ToolkitProvenance.components.release_signer.sha256
$ExpectedInitializerSha256 = [string]$ToolkitProvenance.components.trust_initializer.sha256
if ($ExpectedSignerSha256 -notmatch '^[0-9a-f]{64}$' -or
    $ExpectedInitializerSha256 -notmatch '^[0-9a-f]{64}$') {
    throw 'Toolkit provenance component hashes are invalid.'
}
$ActualSignerSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $Signer).Hash.ToLowerInvariant()
$ActualInitializerSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $ScriptPath).Hash.ToLowerInvariant()
if ($ActualSignerSha256 -ne $ExpectedSignerSha256) {
    throw 'Release signer bytes do not match toolkit provenance.'
}
if ($ActualInitializerSha256 -ne $ExpectedInitializerSha256) {
    throw 'Trust initializer bytes do not match toolkit provenance.'
}

if ($PreflightOnly) {
    Write-Host ''
    Write-Host 'TOOLKIT_TRUST_PREFLIGHT=PASS'
    Write-Host "SOURCE_COMMIT=$ToolkitSourceCommit"
    Write-Host 'CANONICAL_TRUST_CEREMONY_ELIGIBLE=YES'
    Write-Host 'TOOLKIT_COMPONENT_HASHES_VERIFIED=YES'
    Write-Host 'PRIVATE_KEY_TOUCHED=NO'
    Write-Host 'FILESYSTEM_MUTATION=NO'
    Write-Host ''
    return
}

if (-not $GenerateKey) {
    throw 'Canonical key generation requires the explicit -GenerateKey switch. Run 1-Verify-OrdaXTrustToolkit.cmd first, then 2-Initialize-OrdaXTrust.cmd.'
}

if ([string]::IsNullOrWhiteSpace($PrivateKeyPath)) {
    if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
        throw 'USERPROFILE is unavailable; specify -PrivateKeyPath explicitly.'
    }
    # Keep canonical private material in a direct child of the user profile.
    # LOCALAPPDATA can be backed by Windows reparse/junction paths on some hosts,
    # which the signing tool intentionally rejects for private-key custody.
    $PrivateKeyPath = Join-Path $env:USERPROFILE 'OrdaX-Private\release-signing\ordax-release-private.pem'
}
if ([string]::IsNullOrWhiteSpace($ReviewDirectory)) {
    $ReviewDirectory = Join-Path $ScriptRoot 'trust-review'
}

$PrivateKeyPath = [IO.Path]::GetFullPath($PrivateKeyPath)
$ReviewDirectory = [IO.Path]::GetFullPath($ReviewDirectory)
$PrivateDirectory = Split-Path -Parent $PrivateKeyPath
if ([string]::IsNullOrWhiteSpace($PrivateDirectory)) {
    throw 'PrivateKeyPath must include a parent directory.'
}
$ToolkitRoot = $ScriptRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if ($PrivateKeyPath.StartsWith($ToolkitRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The private key must be outside the downloaded toolkit/repository directory.'
}
if (Test-Path -LiteralPath $PrivateKeyPath) {
    throw "Refusing to replace an existing private key: $PrivateKeyPath"
}

New-Item -ItemType Directory -Force -Path $PrivateDirectory | Out-Null
if (Test-Path -LiteralPath $ReviewDirectory) {
    $existing = @(Get-ChildItem -LiteralPath $ReviewDirectory -Force)
    if ($existing.Count -ne 0) {
        throw "ReviewDirectory must be empty: $ReviewDirectory"
    }
} else {
    New-Item -ItemType Directory -Path $ReviewDirectory | Out-Null
}

$TrustPath = Join-Path $ReviewDirectory 'release-ed25519.json'
$DerivedTrustPath = Join-Path $ReviewDirectory 'release-ed25519-derived.json'
$ManifestPath = Join-Path $ReviewDirectory 'trust-proof-manifest.json'
$EnvelopePath = Join-Path $ReviewDirectory 'trust-proof-envelope.json'
$ResultPath = Join-Path $ReviewDirectory 'ceremony-result.json'

Write-Host 'Generating canonical Ed25519 key material locally...'
& $Signer generate-key `
    --private-key $PrivateKeyPath `
    --trust $TrustPath `
    --key-id $KeyId
if ($LASTEXITCODE -ne 0) { throw 'generate-key failed.' }

Write-Host 'Deriving the public anchor independently from the private key...'
& $Signer derive-trust `
    --private-key $PrivateKeyPath `
    --out $DerivedTrustPath `
    --key-id $KeyId
if ($LASTEXITCODE -ne 0) { throw 'derive-trust failed.' }

$TrustBytes = [IO.File]::ReadAllBytes($TrustPath)
$DerivedBytes = [IO.File]::ReadAllBytes($DerivedTrustPath)
if ($TrustBytes.Length -ne $DerivedBytes.Length) {
    throw 'Independent public trust derivation length mismatch.'
}
for ($i = 0; $i -lt $TrustBytes.Length; $i++) {
    if ($TrustBytes[$i] -ne $DerivedBytes[$i]) {
        throw "Independent public trust derivation differs at byte $i."
    }
}

$Trust = Get-Content -LiteralPath $TrustPath -Raw | ConvertFrom-Json
if ($Trust.'$schema' -ne 'prototype-ordax.release-trust/1') {
    throw 'Unexpected trust schema.'
}
if ($Trust.key_id -ne $KeyId) {
    throw 'Unexpected trust key_id.'
}
$PublicBytes = [Convert]::FromBase64String([string]$Trust.public_key_base64)
if ($PublicBytes.Length -ne 32) {
    throw 'Ed25519 public key must contain exactly 32 raw bytes.'
}

$ProofCommit = $ToolkitSourceCommit
$Manifest = [ordered]@{
    '$schema' = 'prototype-ordax.release-manifest/1'
    source_repository = 'ordaxsystems/ordax-os'
    source_commit = $ProofCommit
    release_id = $ProofCommit
    created_from_ci_recipe = 'release/native/1'
    artifacts = @(
        [ordered]@{
            name = 'system.tar'
            role = 'system'
            url = 'https://example.invalid/releases/system.tar'
            sha256 = ('a' * 64)
            size = 123
        }
    )
}
$Utf8NoBom = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($ManifestPath, (($Manifest | ConvertTo-Json -Depth 6) + "`n"), $Utf8NoBom)

Write-Host 'Signing a protocol-shaped proof manifest...'
& $Signer sign `
    --manifest $ManifestPath `
    --private-key $PrivateKeyPath `
    --trust $TrustPath `
    --key-id $KeyId `
    --out $EnvelopePath
if ($LASTEXITCODE -ne 0) { throw 'proof signing failed.' }

$TrustHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $TrustPath).Hash.ToLowerInvariant()
$Result = [ordered]@{
    '$schema' = 'prototype-ordax.release-trust-ceremony-result/1'
    status = 'local-key-generated-public-anchor-verified-proof-signed'
    source_commit = $ToolkitSourceCommit
    key_id = $KeyId
    public_trust_path = $TrustPath
    public_trust_sha256 = $TrustHash
    independent_derivation_byte_equal = $true
    proof_signature_created = $true
    private_key_location = $PrivateKeyPath
    private_key_in_repository = $false
    offline_encrypted_backup_required = $true
    ready_to_pin_public_anchor = $false
    remaining_gate = 'create and verify at least one encrypted offline recovery copy before pinning public anchor'
}
[IO.File]::WriteAllText($ResultPath, (($Result | ConvertTo-Json -Depth 5) + "`n"), $Utf8NoBom)

Write-Host ''
Write-Host 'CANONICAL_KEY_MATERIAL_GENERATED=YES'
Write-Host "SOURCE_COMMIT=$ToolkitSourceCommit"
Write-Host 'TOOLKIT_COMPONENT_HASHES_VERIFIED=YES'
Write-Host 'PUBLIC_TRUST_DERIVATION_MATCH=PASS'
Write-Host 'PROOF_SIGNATURE_CREATED=YES'
Write-Host "PUBLIC_TRUST_SHA256=$TrustHash"
Write-Host "PUBLIC_TRUST_PATH=$TrustPath"
Write-Host "PRIVATE_KEY_PATH=$PrivateKeyPath"
Write-Host 'OFFLINE_ENCRYPTED_BACKUP_REQUIRED=YES'
Write-Host 'READY_TO_PIN_PUBLIC_ANCHOR=NO'
Write-Host ''
Write-Host 'Next: create and verify an encrypted offline backup of the private PEM.'
Write-Host 'Do NOT paste, upload, commit, or place the private PEM on the OrdaX USB.'
