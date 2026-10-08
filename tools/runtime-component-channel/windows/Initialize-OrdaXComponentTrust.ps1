[CmdletBinding()]
param(
    [switch]$PreflightOnly,
    [switch]$GenerateKey,
    [string]$PrivateKeyPath = "",
    [string]$ReviewDirectory = "",
    [string]$ToolkitProvenancePath = ""
)

$ErrorActionPreference = 'Stop'
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Signer = Join-Path $ScriptRoot 'ordax-runtime-component-channel.exe'
$InitializerPath = $MyInvocation.MyCommand.Path
$PolicyPath = Join-Path $ScriptRoot 'component-trust-policy.json'
$CeremonyDocPath = Join-Path $ScriptRoot 'COMPONENT-TRUST-CEREMONY.md'
$KeyId = 'ordax-runtime-components-v1'

if ([string]::IsNullOrWhiteSpace($ToolkitProvenancePath)) {
    $ToolkitProvenancePath = Join-Path $ScriptRoot 'provenance.json'
}
if ([string]::IsNullOrWhiteSpace($PrivateKeyPath)) {
    $PrivateKeyPath = Join-Path $env:LOCALAPPDATA 'OrdaX\ComponentTrust\private\runtime-component-private.pem'
}
if ([string]::IsNullOrWhiteSpace($ReviewDirectory)) {
    $ReviewDirectory = Join-Path $env:LOCALAPPDATA 'OrdaX\ComponentTrust\review'
}

function Assert-RegularFile([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label is missing: $Path"
    }
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "$Label may not be a reparse point or symlink."
    }
}

function Assert-OutsideToolkit([string]$Path, [string]$Label) {
    $absolute = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetFullPath($ScriptRoot)
    $prefix = $root.TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    ) + [IO.Path]::DirectorySeparatorChar
    if (
        $absolute.Equals($root, [StringComparison]::OrdinalIgnoreCase) -or
        $absolute.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
    ) {
        throw "$Label must stay outside the toolkit/repository directory."
    }
}

Assert-RegularFile $Signer 'component signer'
Assert-RegularFile $ToolkitProvenancePath 'toolkit provenance'
Assert-RegularFile $InitializerPath 'component trust initializer'
Assert-RegularFile $PolicyPath 'component trust policy'
Assert-RegularFile $CeremonyDocPath 'component trust ceremony document'

$Provenance = Get-Content -LiteralPath $ToolkitProvenancePath -Raw | ConvertFrom-Json
if (
    $Provenance.'$schema' -ne 'prototype-ordax.component-trust-toolkit/1' -or
    $Provenance.status -ne 'candidate'
) {
    throw 'Component trust toolkit provenance schema or status is invalid.'
}
if (
    $Provenance.source_repository -ne 'ordaxsystems/ordax-os' -or
    $Provenance.source_event -ne 'push' -or
    $Provenance.source_ref -ne 'refs/heads/main' -or
    $Provenance.canonical_component_trust_ceremony_eligible -ne $true
) {
    throw 'Canonical component trust requires a toolkit produced by an eligible push of main.'
}

$SourceCommit = [string]$Provenance.source_commit
if ($SourceCommit -notmatch '^[0-9a-f]{40}$') {
    throw 'Toolkit source_commit must be exactly 40 lowercase hexadecimal characters.'
}

$ExpectedSignerSha = [string]$Provenance.components.component_signer.sha256
$ExpectedInitializerSha = [string]$Provenance.components.trust_initializer.sha256
$ExpectedPolicySha = [string]$Provenance.policy_sha256
$ExpectedCeremonyDocSha = [string]$Provenance.ceremony_doc_sha256

if (
    $ExpectedSignerSha -notmatch '^[0-9a-f]{64}$' -or
    $ExpectedInitializerSha -notmatch '^[0-9a-f]{64}$' -or
    $ExpectedPolicySha -notmatch '^[0-9a-f]{64}$' -or
    $ExpectedCeremonyDocSha -notmatch '^[0-9a-f]{64}$'
) {
    throw 'Toolkit component/policy hashes are invalid.'
}

$ActualSignerSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $Signer).Hash.ToLowerInvariant()
$ActualInitializerSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $InitializerPath).Hash.ToLowerInvariant()
$ActualPolicySha = (Get-FileHash -Algorithm SHA256 -LiteralPath $PolicyPath).Hash.ToLowerInvariant()
$ActualCeremonyDocSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $CeremonyDocPath).Hash.ToLowerInvariant()

if ($ActualSignerSha -ne $ExpectedSignerSha) {
    throw 'Component signer bytes do not match toolkit provenance.'
}
if ($ActualInitializerSha -ne $ExpectedInitializerSha) {
    throw 'Component trust initializer bytes do not match toolkit provenance.'
}
if (
    $ActualPolicySha -ne $ExpectedPolicySha -or
    $ActualCeremonyDocSha -ne $ExpectedCeremonyDocSha
) {
    throw 'Component trust policy/document bytes do not match toolkit provenance.'
}

$Policy = Get-Content -LiteralPath $PolicyPath -Raw | ConvertFrom-Json
if (
    $Policy.'$schema' -ne 'prototype-ordax.runtime-component-trust-policy/1' -or
    $Policy.status -ne 'operator-ceremony-pending' -or
    $Policy.key_id -ne $KeyId -or
    $Policy.public_anchor.pinned -ne $false -or
    $Policy.public_anchor.repository_path -ne 'system/trust/runtime-components-ed25519.json' -or
    $Policy.separation.whole_os_release_key_reuse_allowed -ne $false -or
    $Policy.current_gates.component_publish_allowed -ne $false -or
    $Policy.current_gates.production_component_slot_activation_allowed -ne $false
) {
    throw 'Component trust policy is not the expected fail-closed pre-ceremony policy.'
}

Write-Host 'COMPONENT_TRUST_TOOLKIT_PREFLIGHT=PASS'
Write-Host "SOURCE_COMMIT=$SourceCommit"
Write-Host 'CANONICAL_COMPONENT_TRUST_CEREMONY_ELIGIBLE=YES'
Write-Host 'TOOLKIT_COMPONENT_HASHES_VERIFIED=YES'
Write-Host 'PRIVATE_KEY_TOUCHED=NO'

if ($PreflightOnly) {
    Write-Host 'FILESYSTEM_MUTATION=NO'
    exit 0
}
if (-not $GenerateKey) {
    throw 'Refusing key generation without explicit -GenerateKey.'
}

Assert-OutsideToolkit $PrivateKeyPath 'Private key'
Assert-OutsideToolkit $ReviewDirectory 'Review directory'

$PrivateKeyPath = [IO.Path]::GetFullPath($PrivateKeyPath)
$PrivateDirectory = Split-Path -Parent $PrivateKeyPath
$ReviewDirectory = [IO.Path]::GetFullPath($ReviewDirectory)

if (Test-Path -LiteralPath $PrivateKeyPath) {
    throw "Refusing to replace existing private key: $PrivateKeyPath"
}
if (Test-Path -LiteralPath $ReviewDirectory) {
    $existing = @(Get-ChildItem -LiteralPath $ReviewDirectory -Force)
    if ($existing.Count -ne 0) {
        throw "Review directory must be empty: $ReviewDirectory"
    }
} else {
    New-Item -ItemType Directory -Path $ReviewDirectory -Force | Out-Null
}
New-Item -ItemType Directory -Path $PrivateDirectory -Force | Out-Null

$TrustPath = Join-Path $ReviewDirectory 'runtime-components-ed25519.json'
$DerivedPath = Join-Path $ReviewDirectory 'runtime-components-ed25519-derived.json'
$ProofReleasePath = Join-Path $ReviewDirectory 'component-trust-proof-release.json'
$ProofEnvelopePath = Join-Path $ReviewDirectory 'component-trust-proof-envelope.json'
$ResultPath = Join-Path $ReviewDirectory 'ceremony-result.json'

foreach ($path in @(
    $TrustPath,
    $DerivedPath,
    $ProofReleasePath,
    $ProofEnvelopePath,
    $ResultPath
)) {
    if (Test-Path -LiteralPath $path) {
        throw "Refusing to replace existing ceremony output: $path"
    }
}

Write-Host 'Generating external component signing key and public trust...'
& $Signer generate-key --private-key $PrivateKeyPath --trust $TrustPath --key-id $KeyId
if ($LASTEXITCODE -ne 0) {
    throw 'Component key generation failed.'
}

Write-Host 'Deriving public trust independently...'
& $Signer derive-trust --private-key $PrivateKeyPath --out $DerivedPath --key-id $KeyId
if ($LASTEXITCODE -ne 0) {
    throw 'Independent component trust derivation failed.'
}

$TrustBytes = [IO.File]::ReadAllBytes($TrustPath)
$DerivedBytes = [IO.File]::ReadAllBytes($DerivedPath)
if ($TrustBytes.Length -ne $DerivedBytes.Length) {
    throw 'Independent public trust derivation length mismatch.'
}
for ($index = 0; $index -lt $TrustBytes.Length; $index++) {
    if ($TrustBytes[$index] -ne $DerivedBytes[$index]) {
        throw "Independent public trust derivation differs at byte $index."
    }
}

$Trust = Get-Content -LiteralPath $TrustPath -Raw | ConvertFrom-Json
if (
    $Trust.'$schema' -ne 'prototype-ordax.runtime-component-trust/1' -or
    $Trust.key_id -ne $KeyId
) {
    throw 'Generated component trust schema or key id is invalid.'
}

$PublicBytes = [Convert]::FromBase64String([string]$Trust.public_key_base64)
if ($PublicBytes.Length -ne 32) {
    throw 'Component Ed25519 public key must contain exactly 32 raw bytes.'
}

$Sha256 = [Security.Cryptography.SHA256]::Create()
try {
    $PublicFingerprint = (
        [BitConverter]::ToString($Sha256.ComputeHash($PublicBytes))
    ).Replace('-', '').ToLowerInvariant()
}
finally {
    $Sha256.Dispose()
}

$Proof = [ordered]@{
    '$schema' = 'prototype-ordax.runtime-component-release/1'
    source_repository = 'ordaxsystems/ordax-os'
    source_commit = $SourceCommit
    created_from_ci_recipe = 'runtime-component/package/1'
    component = [ordered]@{
        id = 'internet'
        version = '0.0.0-trust-proof'
        release_mode = 'component-slot'
        package_schema = 'prototype-ordax.runtime-component-package/1'
    }
    package = [ordered]@{
        name = 'internet.zip'
        sha256 = ('0' * 64)
        size = 1
        manifest_sha256 = ('1' * 64)
    }
    activation = [ordered]@{
        direct_activation_allowed = $false
        pending_health_required = $true
    }
}

$Utf8NoBom = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText(
    $ProofReleasePath,
    (($Proof | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
    $Utf8NoBom
)

Write-Host 'Signing protocol-shaped component trust proof...'
& $Signer sign --release $ProofReleasePath --private-key $PrivateKeyPath --trust $TrustPath --key-id $KeyId --out $ProofEnvelopePath
if ($LASTEXITCODE -ne 0) {
    throw 'Component trust signing proof failed.'
}

Write-Host 'Verifying component trust proof with public trust only...'
& $Signer verify-envelope --envelope $ProofEnvelopePath --trust $TrustPath
if ($LASTEXITCODE -ne 0) {
    throw 'Component trust signing proof did not verify.'
}

$TrustHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $TrustPath).Hash.ToLowerInvariant()
$ProofHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ProofReleasePath).Hash.ToLowerInvariant()
$EnvelopeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ProofEnvelopePath).Hash.ToLowerInvariant()

$Result = [ordered]@{
    '$schema' = 'prototype-ordax.runtime-component-trust-ceremony-result/1'
    status = 'local-key-generated-public-anchor-verified-proof-signed'
    source_commit = $SourceCommit
    key_id = $KeyId
    public_key_sha256 = $PublicFingerprint
    public_trust_sha256 = $TrustHash
    proof_release_sha256 = $ProofHash
    proof_envelope_sha256 = $EnvelopeHash
    independent_public_derivation_match = $true
    proof_signature_verified = $true
    offline_encrypted_backup_required = $true
    offline_recovery_verified = $false
    ready_to_pin_public_anchor = $false
    private_key_in_public_result = $false
}

[IO.File]::WriteAllText(
    $ResultPath,
    (($Result | ConvertTo-Json -Depth 6) + [Environment]::NewLine),
    $Utf8NoBom
)

Write-Host ''
Write-Host 'COMPONENT_TRUST_INITIALIZATION=PASS'
Write-Host "SOURCE_COMMIT=$SourceCommit"
Write-Host "KEY_ID=$KeyId"
Write-Host "PUBLIC_KEY_SHA256=$PublicFingerprint"
Write-Host "PUBLIC_TRUST_SHA256=$TrustHash"
Write-Host 'INDEPENDENT_PUBLIC_DERIVATION_MATCH=YES'
Write-Host 'PROOF_SIGNATURE_VERIFIED=YES'
Write-Host 'PRIVATE_KEY_PRINTED=NO'
Write-Host 'OFFLINE_RECOVERY_VERIFIED=NO'
Write-Host 'READY_TO_PIN_PUBLIC_ANCHOR=NO'
Write-Host "PRIVATE_KEY_PATH=$PrivateKeyPath"
Write-Host "REVIEW_DIRECTORY=$ReviewDirectory"
