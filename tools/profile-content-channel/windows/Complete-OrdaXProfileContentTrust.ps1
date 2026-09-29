[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$RecoveredPrivateKeyPath,
    [string]$PrimaryPrivateKeyPath = "",
    [string]$ReviewDirectory = "",
    [string]$ToolkitProvenancePath = ""
)

$ErrorActionPreference = 'Stop'
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Signer = Join-Path $ScriptRoot 'ordax-profile-content-channel.exe'
$FinalizerPath = $MyInvocation.MyCommand.Path
$PolicyPath = Join-Path $ScriptRoot 'profile-content-trust-policy.json'
$CeremonyDocPath = Join-Path $ScriptRoot 'PROFILE-CONTENT-TRUST-CEREMONY.md'
$KeyId = 'ordax-profile-content-v1'

if ([string]::IsNullOrWhiteSpace($ToolkitProvenancePath)) {
    $ToolkitProvenancePath = Join-Path $ScriptRoot 'provenance.json'
}
if ([string]::IsNullOrWhiteSpace($PrimaryPrivateKeyPath)) {
    $PrimaryPrivateKeyPath = Join-Path $env:LOCALAPPDATA 'OrdaX\ProfileContentTrust\private\profile-content-private.pem'
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
Assert-RegularFile $FinalizerPath 'Profile content trust recovery finalizer'
Assert-RegularFile $PolicyPath 'Profile content trust policy'
Assert-RegularFile $CeremonyDocPath 'Profile content trust ceremony document'
Assert-RegularFile $PrimaryPrivateKeyPath 'primary Profile content private key'
Assert-RegularFile $RecoveredPrivateKeyPath 'recovered Profile content private key'
Assert-OutsideToolkit $PrimaryPrivateKeyPath 'Primary private key'
Assert-OutsideToolkit $RecoveredPrivateKeyPath 'Recovered private key'

$PrimaryAbsolute = [IO.Path]::GetFullPath($PrimaryPrivateKeyPath)
$RecoveredAbsolute = [IO.Path]::GetFullPath($RecoveredPrivateKeyPath)
if ($PrimaryAbsolute.Equals($RecoveredAbsolute, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Recovered private key must be a distinct restored file.'
}

$Provenance = Get-Content -LiteralPath $ToolkitProvenancePath -Raw | ConvertFrom-Json
if (
    $Provenance.'$schema' -ne 'prototype-ordax.profile-content-trust-toolkit/1' -or
    $Provenance.status -ne 'candidate' -or
    $Provenance.source_repository -ne 'washingtonmsdj/prototipo-ordax-os' -or
    $Provenance.source_event -ne 'push' -or
    $Provenance.source_ref -ne 'refs/heads/main' -or
    $Provenance.canonical_profile_content_trust_ceremony_eligible -ne $true
) {
    throw 'Profile content trust recovery requires an eligible canonical-main toolkit.'
}
$SourceCommit = [string]$Provenance.source_commit
if ($SourceCommit -notmatch '^[0-9a-f]{40}$') {
    throw 'Toolkit source_commit is invalid.'
}

$ExpectedSignerSha = [string]$Provenance.components.profile_content_signer.sha256
$ExpectedFinalizerSha = [string]$Provenance.components.trust_recovery_finalizer.sha256
$ExpectedPolicySha = [string]$Provenance.policy_sha256
$ExpectedCeremonyDocSha = [string]$Provenance.ceremony_doc_sha256
$ActualSignerSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $Signer).Hash.ToLowerInvariant()
$ActualFinalizerSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $FinalizerPath).Hash.ToLowerInvariant()
$ActualPolicySha = (Get-FileHash -Algorithm SHA256 -LiteralPath $PolicyPath).Hash.ToLowerInvariant()
$ActualCeremonyDocSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $CeremonyDocPath).Hash.ToLowerInvariant()
if (
    $ActualSignerSha -ne $ExpectedSignerSha -or
    $ActualFinalizerSha -ne $ExpectedFinalizerSha -or
    $ActualPolicySha -ne $ExpectedPolicySha -or
    $ActualCeremonyDocSha -ne $ExpectedCeremonyDocSha
) {
    throw 'Profile content trust recovery toolkit bytes do not match provenance.'
}

$Policy = Get-Content -LiteralPath $PolicyPath -Raw | ConvertFrom-Json
if (
    $Policy.'$schema' -ne 'prototype-ordax.profile-content-trust-policy/1' -or
    $Policy.key_id -ne $KeyId -or
    $Policy.public_anchor.pinned -ne $false -or
    $Policy.current_gates.canonical_profile_content_trust_anchor_pinned -ne $false -or
    $Policy.current_gates.profile_content_publish_allowed -ne $false -or
    $Policy.current_gates.profile_content_install_allowed -ne $false -or
    $Policy.current_gates.profile_content_activation_allowed -ne $false
) {
    throw 'Profile content trust recovery policy is not fail-closed.'
}

$ReviewDirectory = [IO.Path]::GetFullPath($ReviewDirectory)
$TrustPath = Join-Path $ReviewDirectory 'profile-content-ed25519.json'
$PrimaryDerivedPath = Join-Path $ReviewDirectory 'profile-content-ed25519-derived.json'
$ContentPath = Join-Path $ReviewDirectory 'profile-content-trust-proof.pack'
$ManifestPath = Join-Path $ReviewDirectory 'profile-content-trust-proof-manifest.json'
$InitialEnvelopePath = Join-Path $ReviewDirectory 'profile-content-trust-proof-envelope.json'
$InitialResultPath = Join-Path $ReviewDirectory 'ceremony-result.json'
$RecoveredDerivedPath = Join-Path $ReviewDirectory 'profile-content-ed25519-recovered.json'
$RecoveryEnvelopePath = Join-Path $ReviewDirectory 'profile-content-trust-proof-recovery-envelope.json'
$EvidencePath = Join-Path $ReviewDirectory 'ceremony-public-evidence.json'
$PromotionDirectory = Join-Path $ReviewDirectory 'public-promotion'
$HandoffZipPath = Join-Path $ReviewDirectory 'OrdaX-Profile-Content-Public-Trust-Handoff.zip'

foreach ($path in @(
    $TrustPath,
    $PrimaryDerivedPath,
    $ContentPath,
    $ManifestPath,
    $InitialEnvelopePath,
    $InitialResultPath
)) {
    Assert-RegularFile $path 'required Profile content trust ceremony file'
}
foreach ($path in @($RecoveredDerivedPath, $RecoveryEnvelopePath, $EvidencePath, $HandoffZipPath)) {
    if (Test-Path -LiteralPath $path) {
        throw "Refusing to replace existing recovery output: $path"
    }
}

if (Test-Path -LiteralPath $PromotionDirectory) {
    if (@(Get-ChildItem -LiteralPath $PromotionDirectory -Force).Count -ne 0) {
        throw "Public promotion directory must be empty: $PromotionDirectory"
    }
} else {
    New-Item -ItemType Directory -Path $PromotionDirectory | Out-Null
}

$InitialResult = Get-Content -LiteralPath $InitialResultPath -Raw | ConvertFrom-Json
if (
    $InitialResult.'$schema' -ne 'prototype-ordax.profile-content-trust-ceremony-result/1' -or
    $InitialResult.status -ne 'local-key-generated-public-anchor-verified-proof-signed' -or
    $InitialResult.source_commit -ne $SourceCommit -or
    $InitialResult.key_id -ne $KeyId -or
    $InitialResult.offline_encrypted_backup_required -ne $true -or
    $InitialResult.offline_recovery_verified -ne $false -or
    $InitialResult.ready_to_pin_public_anchor -ne $false
) {
    throw 'Initial Profile content trust ceremony result is invalid.'
}

$CurrentTrustHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $TrustPath).Hash.ToLowerInvariant()
$CurrentManifestHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ManifestPath).Hash.ToLowerInvariant()
$CurrentContentHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ContentPath).Hash.ToLowerInvariant()
$CurrentEnvelopeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $InitialEnvelopePath).Hash.ToLowerInvariant()
if (
    [string]$InitialResult.public_trust_sha256 -ne $CurrentTrustHash -or
    [string]$InitialResult.proof_manifest_sha256 -ne $CurrentManifestHash -or
    [string]$InitialResult.proof_content_sha256 -ne $CurrentContentHash -or
    [string]$InitialResult.proof_envelope_sha256 -ne $CurrentEnvelopeHash
) {
    throw 'Initial Profile content trust ceremony files changed after initialization.'
}

& $Signer verify --manifest $ManifestPath --envelope $InitialEnvelopePath --trust $TrustPath --content $ContentPath
if ($LASTEXITCODE -ne 0) {
    throw 'Initial Profile content trust proof no longer verifies.'
}

& $Signer derive-trust --private-key $RecoveredPrivateKeyPath --out $RecoveredDerivedPath --key-id $KeyId
if ($LASTEXITCODE -ne 0) {
    throw 'Recovered Profile content trust derivation failed.'
}

$CanonicalBytes = [IO.File]::ReadAllBytes($TrustPath)
$PrimaryBytes = [IO.File]::ReadAllBytes($PrimaryDerivedPath)
$RecoveredBytes = [IO.File]::ReadAllBytes($RecoveredDerivedPath)
if ($CanonicalBytes.Length -ne $PrimaryBytes.Length -or $CanonicalBytes.Length -ne $RecoveredBytes.Length) {
    throw 'Profile content trust derivation length mismatch.'
}
for ($i = 0; $i -lt $CanonicalBytes.Length; $i++) {
    if ($CanonicalBytes[$i] -ne $PrimaryBytes[$i] -or $CanonicalBytes[$i] -ne $RecoveredBytes[$i]) {
        throw "Recovered Profile content trust differs at byte $i."
    }
}

& $Signer sign --manifest $ManifestPath --private-key $RecoveredPrivateKeyPath --trust $TrustPath --key-id $KeyId --out $RecoveryEnvelopePath
if ($LASTEXITCODE -ne 0) {
    throw 'Recovered Profile content signing proof failed.'
}
& $Signer verify --manifest $ManifestPath --envelope $RecoveryEnvelopePath --trust $TrustPath --content $ContentPath
if ($LASTEXITCODE -ne 0) {
    throw 'Recovered Profile content signing proof did not verify.'
}
& $Signer verify-envelope --manifest $ManifestPath --envelope $RecoveryEnvelopePath --trust $TrustPath
if ($LASTEXITCODE -ne 0) {
    throw 'Recovered Profile content envelope-only proof did not verify.'
}

$RecoveryEnvelopeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $RecoveryEnvelopePath).Hash.ToLowerInvariant()
$Evidence = [ordered]@{
    '$schema' = 'prototype-ordax.profile-content-trust-ceremony-evidence/1'
    status = 'pass'
    source_commit = $SourceCommit
    key_id = $KeyId
    public_trust_sha256 = $CurrentTrustHash
    proof_manifest_sha256 = $CurrentManifestHash
    recovery_envelope_sha256 = $RecoveryEnvelopeHash
    primary_public_derivation_match = $true
    recovered_public_derivation_match = $true
    recovered_private_path_distinct = $true
    recovered_signing_proof = $true
    offline_encrypted_backup_recovery_verified = $true
    private_key_in_public_evidence = $false
    ready_to_pin_public_anchor = $true
}
$Utf8NoBom = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText(
    $EvidencePath,
    (($Evidence | ConvertTo-Json -Depth 8) + [Environment]::NewLine),
    $Utf8NoBom
)

$PromotionTrustPath = Join-Path $PromotionDirectory 'profile-content-ed25519.json'
$PromotionEvidencePath = Join-Path $PromotionDirectory 'ceremony-public-evidence.json'
$PromotionManifestPath = Join-Path $PromotionDirectory 'profile-content-trust-proof-manifest.json'
$PromotionEnvelopePath = Join-Path $PromotionDirectory 'profile-content-trust-proof-recovery-envelope.json'
Copy-Item -LiteralPath $TrustPath -Destination $PromotionTrustPath
Copy-Item -LiteralPath $EvidencePath -Destination $PromotionEvidencePath
Copy-Item -LiteralPath $ManifestPath -Destination $PromotionManifestPath
Copy-Item -LiteralPath $RecoveryEnvelopePath -Destination $PromotionEnvelopePath

$ExpectedNames = @(
    'profile-content-ed25519.json',
    'ceremony-public-evidence.json',
    'profile-content-trust-proof-manifest.json',
    'profile-content-trust-proof-recovery-envelope.json'
) | Sort-Object
$ActualNames = @(Get-ChildItem -LiteralPath $PromotionDirectory -Force | ForEach-Object { $_.Name } | Sort-Object)
if ($ActualNames.Count -ne $ExpectedNames.Count) {
    throw 'Public Profile content trust promotion directory contains unexpected files.'
}
for ($i = 0; $i -lt $ExpectedNames.Count; $i++) {
    if ($ActualNames[$i] -ne $ExpectedNames[$i]) {
        throw 'Public Profile content trust promotion directory contains unexpected entries.'
    }
}
$Forbidden = @(Get-ChildItem -LiteralPath $PromotionDirectory -Force -File | Where-Object {
    $_.Extension -match '^\.(pem|key|p12|pfx|dpapi)$' -or $_.Name -match '(?i)(private|secret|seed)'
})
if ($Forbidden.Count -ne 0) {
    throw 'Secret-looking material is present in public Profile content trust handoff.'
}

Compress-Archive -LiteralPath @(
    $PromotionTrustPath,
    $PromotionEvidencePath,
    $PromotionManifestPath,
    $PromotionEnvelopePath
) -DestinationPath $HandoffZipPath -CompressionLevel Optimal

Assert-RegularFile $HandoffZipPath 'Profile content public trust handoff zip'
$HandoffHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $HandoffZipPath).Hash.ToLowerInvariant()

Write-Host ''
Write-Host 'PROFILE_CONTENT_TRUST_RECOVERY=PASS'
Write-Host "SOURCE_COMMIT=$SourceCommit"
Write-Host "KEY_ID=$KeyId"
Write-Host 'PRIMARY_PUBLIC_DERIVATION_MATCH=YES'
Write-Host 'RECOVERED_PUBLIC_DERIVATION_MATCH=YES'
Write-Host 'RECOVERED_PRIVATE_PATH_DISTINCT=YES'
Write-Host 'RECOVERED_SIGNING_PROOF=YES'
Write-Host 'PRIVATE_KEY_PRINTED=NO'
Write-Host 'PUBLIC_HANDOFF_SECRET_MATERIAL=NO'
Write-Host 'READY_TO_PIN_PUBLIC_ANCHOR=YES'
Write-Host "PUBLIC_PROFILE_CONTENT_TRUST_HANDOFF_ZIP=$HandoffZipPath"
Write-Host "PUBLIC_PROFILE_CONTENT_TRUST_HANDOFF_ZIP_SHA256=$HandoffHash"
