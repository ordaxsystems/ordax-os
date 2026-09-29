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
$Signer = Join-Path $ScriptRoot 'ordax-profile-content-channel.exe'
$InitializerPath = $MyInvocation.MyCommand.Path
$PolicyPath = Join-Path $ScriptRoot 'profile-content-trust-policy.json'
$CeremonyDocPath = Join-Path $ScriptRoot 'PROFILE-CONTENT-TRUST-CEREMONY.md'
$KeyId = 'ordax-profile-content-v1'

if ([string]::IsNullOrWhiteSpace($ToolkitProvenancePath)) {
    $ToolkitProvenancePath = Join-Path $ScriptRoot 'provenance.json'
}
if ([string]::IsNullOrWhiteSpace($PrivateKeyPath)) {
    $PrivateKeyPath = Join-Path $env:LOCALAPPDATA 'OrdaX\ProfileContentTrust\private\profile-content-private.pem'
}
if ([string]::IsNullOrWhiteSpace($ReviewDirectory)) {
    $ReviewDirectory = Join-Path $env:LOCALAPPDATA 'OrdaX\ProfileContentTrust\review'
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

Assert-RegularFile $Signer 'Profile content signer'
Assert-RegularFile $ToolkitProvenancePath 'toolkit provenance'
Assert-RegularFile $InitializerPath 'Profile content trust initializer'
Assert-RegularFile $PolicyPath 'Profile content trust policy'
Assert-RegularFile $CeremonyDocPath 'Profile content trust ceremony document'

$Provenance = Get-Content -LiteralPath $ToolkitProvenancePath -Raw | ConvertFrom-Json
if (
    $Provenance.'$schema' -ne 'prototype-ordax.profile-content-trust-toolkit/1' -or
    $Provenance.status -ne 'candidate' -or
    $Provenance.source_repository -ne 'washingtonmsdj/prototipo-ordax-os' -or
    $Provenance.source_event -ne 'push' -or
    $Provenance.source_ref -ne 'refs/heads/main' -or
    $Provenance.canonical_profile_content_trust_ceremony_eligible -ne $true
) {
    throw 'Canonical Profile content trust requires an eligible toolkit produced by a push of main.'
}

$SourceCommit = [string]$Provenance.source_commit
if ($SourceCommit -notmatch '^[0-9a-f]{40}$') {
    throw 'Toolkit source_commit must be exactly 40 lowercase hexadecimal characters.'
}

$ExpectedSignerSha = [string]$Provenance.components.profile_content_signer.sha256
$ExpectedInitializerSha = [string]$Provenance.components.trust_initializer.sha256
$ExpectedPolicySha = [string]$Provenance.policy_sha256
$ExpectedCeremonyDocSha = [string]$Provenance.ceremony_doc_sha256
foreach ($value in @($ExpectedSignerSha, $ExpectedInitializerSha, $ExpectedPolicySha, $ExpectedCeremonyDocSha)) {
    if ($value -notmatch '^[0-9a-f]{64}$') {
        throw 'Toolkit component/policy hashes are invalid.'
    }
}

$ActualSignerSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $Signer).Hash.ToLowerInvariant()
$ActualInitializerSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $InitializerPath).Hash.ToLowerInvariant()
$ActualPolicySha = (Get-FileHash -Algorithm SHA256 -LiteralPath $PolicyPath).Hash.ToLowerInvariant()
$ActualCeremonyDocSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $CeremonyDocPath).Hash.ToLowerInvariant()
if (
    $ActualSignerSha -ne $ExpectedSignerSha -or
    $ActualInitializerSha -ne $ExpectedInitializerSha -or
    $ActualPolicySha -ne $ExpectedPolicySha -or
    $ActualCeremonyDocSha -ne $ExpectedCeremonyDocSha
) {
    throw 'Profile content trust toolkit bytes do not match provenance.'
}

$Policy = Get-Content -LiteralPath $PolicyPath -Raw | ConvertFrom-Json
if (
    $Policy.'$schema' -ne 'prototype-ordax.profile-content-trust-policy/1' -or
    $Policy.key_id -ne $KeyId -or
    $Policy.public_anchor.pinned -ne $false -or
    $Policy.separation.whole_os_release_key_reuse_allowed -ne $false -or
    $Policy.separation.runtime_component_key_reuse_allowed -ne $false -or
    $Policy.current_gates.canonical_profile_content_trust_anchor_pinned -ne $false -or
    $Policy.current_gates.profile_content_publish_allowed -ne $false -or
    $Policy.current_gates.profile_content_install_allowed -ne $false -or
    $Policy.current_gates.profile_content_activation_allowed -ne $false
) {
    throw 'Profile content trust policy is not fail-closed.'
}

Write-Host 'PROFILE_CONTENT_TRUST_TOOLKIT_PREFLIGHT=PASS'
Write-Host "SOURCE_COMMIT=$SourceCommit"
Write-Host 'CANONICAL_PROFILE_CONTENT_TRUST_CEREMONY_ELIGIBLE=YES'
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
    if (@(Get-ChildItem -LiteralPath $ReviewDirectory -Force).Count -ne 0) {
        throw "Review directory must be empty: $ReviewDirectory"
    }
} else {
    New-Item -ItemType Directory -Path $ReviewDirectory -Force | Out-Null
}
New-Item -ItemType Directory -Path $PrivateDirectory -Force | Out-Null

$TrustPath = Join-Path $ReviewDirectory 'profile-content-ed25519.json'
$DerivedPath = Join-Path $ReviewDirectory 'profile-content-ed25519-derived.json'
$ContentPath = Join-Path $ReviewDirectory 'profile-content-trust-proof.pack'
$ManifestPath = Join-Path $ReviewDirectory 'profile-content-trust-proof-manifest.json'
$EnvelopePath = Join-Path $ReviewDirectory 'profile-content-trust-proof-envelope.json'
$ResultPath = Join-Path $ReviewDirectory 'ceremony-result.json'
foreach ($path in @($TrustPath, $DerivedPath, $ContentPath, $ManifestPath, $EnvelopePath, $ResultPath)) {
    if (Test-Path -LiteralPath $path) {
        throw "Refusing to replace existing ceremony output: $path"
    }
}

& $Signer generate-key --private-key $PrivateKeyPath --trust $TrustPath --key-id $KeyId
if ($LASTEXITCODE -ne 0) { throw 'Profile content key generation failed.' }

& $Signer derive-trust --private-key $PrivateKeyPath --out $DerivedPath --key-id $KeyId
if ($LASTEXITCODE -ne 0) { throw 'Independent Profile content trust derivation failed.' }

$TrustBytes = [IO.File]::ReadAllBytes($TrustPath)
$DerivedBytes = [IO.File]::ReadAllBytes($DerivedPath)
if ($TrustBytes.Length -ne $DerivedBytes.Length) {
    throw 'Independent public trust derivation length mismatch.'
}
for ($i = 0; $i -lt $TrustBytes.Length; $i++) {
    if ($TrustBytes[$i] -ne $DerivedBytes[$i]) {
        throw "Independent public trust derivation differs at byte $i."
    }
}

$Trust = Get-Content -LiteralPath $TrustPath -Raw | ConvertFrom-Json
if (
    $Trust.'$schema' -ne 'prototype-ordax.profile-content-trust/1' -or
    $Trust.key_id -ne $KeyId
) {
    throw 'Generated Profile content trust is invalid.'
}
$PublicBytes = [Convert]::FromBase64String([string]$Trust.public_key_base64)
if ($PublicBytes.Length -ne 32) {
    throw 'Profile content Ed25519 public key must contain exactly 32 raw bytes.'
}

$Utf8NoBom = [Text.UTF8Encoding]::new($false)
$EntryText = 'OrdaX Profile content canonical trust proof. Non-regulated ceremony fixture only.'
$EntryBytes = $Utf8NoBom.GetBytes($EntryText)
$Sha256 = [Security.Cryptography.SHA256]::Create()
try {
    $EntryHash = ([BitConverter]::ToString($Sha256.ComputeHash($EntryBytes))).Replace('-', '').ToLowerInvariant()
} finally {
    $Sha256.Dispose()
}

$Pack = [ordered]@{
    schema = 'ordax.profile-content-pack/1'
    kind = 'knowledge-pack'
    entries = @(
        [ordered]@{
            id = 'knowledge.developer-trust-proof'
            mediaType = 'text/plain'
            content = $EntryText
            contentSha256 = $EntryHash
            source = [ordered]@{
                uri = 'https://example.invalid/ordax/profile-content-trust'
                revision = $SourceCommit
                license = 'ceremony-proof-only'
                jurisdiction = $null
                title = 'Profile content trust proof'
            }
        }
    )
}
$PackText = ($Pack | ConvertTo-Json -Depth 10 -Compress)
[IO.File]::WriteAllText($ContentPath, $PackText, $Utf8NoBom)
$ContentBytes = [IO.File]::ReadAllBytes($ContentPath)
$Sha256 = [Security.Cryptography.SHA256]::Create()
try {
    $ContentHash = ([BitConverter]::ToString($Sha256.ComputeHash($ContentBytes))).Replace('-', '').ToLowerInvariant()
} finally {
    $Sha256.Dispose()
}

$Manifest = [ordered]@{
    '$schema' = 'prototype-ordax.profile-content-manifest/1'
    id = 'knowledge.developer-trust-proof'
    kind = 'knowledge-pack'
    version = '0.0.0-trust-proof'
    publisher = 'ordax'
    content_hash = $ContentHash
    content_size = $ContentBytes.Length
    content_format = 'ordax.profile-content-pack/1'
    source = [ordered]@{
        uri = 'https://example.invalid/ordax/profile-content-trust'
        revision = $SourceCommit
        license = 'ceremony-proof-only'
        jurisdiction = $null
    }
    requested_capabilities = @()
    runtime_network_allowed = $false
    mutable_host_access_allowed = $false
}
[IO.File]::WriteAllText(
    $ManifestPath,
    (($Manifest | ConvertTo-Json -Depth 10) + [Environment]::NewLine),
    $Utf8NoBom
)

& $Signer sign --manifest $ManifestPath --private-key $PrivateKeyPath --trust $TrustPath --key-id $KeyId --out $EnvelopePath
if ($LASTEXITCODE -ne 0) { throw 'Profile content signing proof failed.' }

& $Signer verify --manifest $ManifestPath --envelope $EnvelopePath --trust $TrustPath --content $ContentPath
if ($LASTEXITCODE -ne 0) { throw 'Profile content signing proof did not verify.' }

$TrustHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $TrustPath).Hash.ToLowerInvariant()
$ManifestHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ManifestPath).Hash.ToLowerInvariant()
$ContentFileHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ContentPath).Hash.ToLowerInvariant()
$EnvelopeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $EnvelopePath).Hash.ToLowerInvariant()

$Result = [ordered]@{
    '$schema' = 'prototype-ordax.profile-content-trust-ceremony-result/1'
    status = 'local-key-generated-public-anchor-verified-proof-signed'
    source_commit = $SourceCommit
    key_id = $KeyId
    public_trust_sha256 = $TrustHash
    proof_manifest_sha256 = $ManifestHash
    proof_content_sha256 = $ContentFileHash
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
    (($Result | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
    $Utf8NoBom
)

Write-Host ''
Write-Host 'PROFILE_CONTENT_TRUST_INITIALIZATION=PASS'
Write-Host "SOURCE_COMMIT=$SourceCommit"
Write-Host "KEY_ID=$KeyId"
Write-Host 'INDEPENDENT_PUBLIC_DERIVATION_MATCH=YES'
Write-Host 'PROOF_SIGNATURE_VERIFIED=YES'
Write-Host 'PRIVATE_KEY_PRINTED=NO'
Write-Host 'OFFLINE_RECOVERY_VERIFIED=NO'
Write-Host 'READY_TO_PIN_PUBLIC_ANCHOR=NO'
Write-Host "PRIVATE_KEY_PATH=$PrivateKeyPath"
Write-Host "REVIEW_DIRECTORY=$ReviewDirectory"
