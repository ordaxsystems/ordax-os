[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$RecoveredPrivateKeyPath,
    [string]$PrimaryPrivateKeyPath = "",
    [string]$ReviewDirectory = "",
    [string]$ToolkitProvenancePath = ""
)

$ErrorActionPreference = 'Stop'
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Signer = Join-Path $ScriptRoot 'ordax-runtime-component-channel.exe'
$FinalizerPath = $MyInvocation.MyCommand.Path
$PolicyPath = Join-Path $ScriptRoot 'component-trust-policy.json'
$CeremonyDocPath = Join-Path $ScriptRoot 'COMPONENT-TRUST-CEREMONY.md'
$KeyId = 'ordax-runtime-components-v1'

if ([string]::IsNullOrWhiteSpace($ToolkitProvenancePath)) {
    $ToolkitProvenancePath = Join-Path $ScriptRoot 'provenance.json'
}
if ([string]::IsNullOrWhiteSpace($PrimaryPrivateKeyPath)) {
    $PrimaryPrivateKeyPath = Join-Path $env:LOCALAPPDATA 'OrdaX\ComponentTrust\private\runtime-component-private.pem'
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
    $prefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if ($absolute.Equals($root, [StringComparison]::OrdinalIgnoreCase) -or
        $absolute.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label must stay outside the toolkit/repository directory."
    }
}

Assert-RegularFile $Signer 'component signer'
Assert-RegularFile $ToolkitProvenancePath 'toolkit provenance'
Assert-RegularFile $FinalizerPath 'component trust recovery finalizer'
Assert-RegularFile $PolicyPath 'component trust policy'
Assert-RegularFile $CeremonyDocPath 'component trust ceremony document'
Assert-RegularFile $PrimaryPrivateKeyPath 'primary component private key'
Assert-RegularFile $RecoveredPrivateKeyPath 'recovered component private key'
Assert-OutsideToolkit $PrimaryPrivateKeyPath 'Primary private key'
Assert-OutsideToolkit $RecoveredPrivateKeyPath 'Recovered private key'

$PrimaryAbsolute = [IO.Path]::GetFullPath($PrimaryPrivateKeyPath)
$RecoveredAbsolute = [IO.Path]::GetFullPath($RecoveredPrivateKeyPath)
if ($PrimaryAbsolute.Equals($RecoveredAbsolute, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Recovered private key must be a distinct restored file.'
}

$Provenance = Get-Content -LiteralPath $ToolkitProvenancePath -Raw | ConvertFrom-Json
if ($Provenance.'$schema' -ne 'prototype-ordax.component-trust-toolkit/1' -or
    $Provenance.status -ne 'candidate' -or
    $Provenance.source_repository -ne 'ordaxsystems/ordax-os' -or
    $Provenance.source_event -ne 'push' -or
    $Provenance.source_ref -ne 'refs/heads/main' -or
    $Provenance.canonical_component_trust_ceremony_eligible -ne $true) {
    throw 'Component trust recovery requires an eligible canonical-main toolkit.'
}
$SourceCommit = [string]$Provenance.source_commit
if ($SourceCommit -notmatch '^[0-9a-f]{40}$') {
    throw 'Toolkit source_commit is invalid.'
}
$ExpectedSignerSha = [string]$Provenance.components.component_signer.sha256
$ExpectedFinalizerSha = [string]$Provenance.components.trust_recovery_finalizer.sha256
$ExpectedPolicySha = [string]$Provenance.policy_sha256
$ExpectedCeremonyDocSha = [string]$Provenance.ceremony_doc_sha256
$ActualSignerSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $Signer).Hash.ToLowerInvariant()
$ActualFinalizerSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $FinalizerPath).Hash.ToLowerInvariant()
$ActualPolicySha = (Get-FileHash -Algorithm SHA256 -LiteralPath $PolicyPath).Hash.ToLowerInvariant()
$ActualCeremonyDocSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $CeremonyDocPath).Hash.ToLowerInvariant()
if ($ActualSignerSha -ne $ExpectedSignerSha -or
    $ActualFinalizerSha -ne $ExpectedFinalizerSha -or
    $ActualPolicySha -ne $ExpectedPolicySha -or
    $ActualCeremonyDocSha -ne $ExpectedCeremonyDocSha) {
    throw 'Component trust recovery toolkit/policy bytes do not match provenance.'
}

$Policy = Get-Content -LiteralPath $PolicyPath -Raw | ConvertFrom-Json
if ($Policy.'$schema' -ne 'prototype-ordax.runtime-component-trust-policy/1' -or
    $Policy.status -ne 'operator-ceremony-pending' -or
    $Policy.key_id -ne $KeyId -or
    $Policy.public_anchor.pinned -ne $false -or
    $Policy.separation.whole_os_release_key_reuse_allowed -ne $false -or
    $Policy.current_gates.component_publish_allowed -ne $false -or
    $Policy.current_gates.production_component_slot_activation_allowed -ne $false) {
    throw 'Component trust recovery policy is not the expected fail-closed pre-promotion policy.'
}

$ReviewDirectory = [IO.Path]::GetFullPath($ReviewDirectory)
$TrustPath = Join-Path $ReviewDirectory 'runtime-components-ed25519.json'
$PrimaryDerivedPath = Join-Path $ReviewDirectory 'runtime-components-ed25519-derived.json'
$ProofReleasePath = Join-Path $ReviewDirectory 'component-trust-proof-release.json'
$InitialEnvelopePath = Join-Path $ReviewDirectory 'component-trust-proof-envelope.json'
$InitialResultPath = Join-Path $ReviewDirectory 'ceremony-result.json'
$RecoveredDerivedPath = Join-Path $ReviewDirectory 'runtime-components-ed25519-recovered.json'
$RecoveryEnvelopePath = Join-Path $ReviewDirectory 'component-trust-proof-recovery-envelope.json'
$EvidencePath = Join-Path $ReviewDirectory 'ceremony-public-evidence.json'
$PromotionDirectory = Join-Path $ReviewDirectory 'public-promotion'
$PromotionTrustPath = Join-Path $PromotionDirectory 'runtime-components-ed25519.json'
$PromotionEvidencePath = Join-Path $PromotionDirectory 'ceremony-public-evidence.json'
$PromotionProofReleasePath = Join-Path $PromotionDirectory 'component-trust-proof-release.json'
$PromotionRecoveryEnvelopePath = Join-Path $PromotionDirectory 'component-trust-proof-recovery-envelope.json'
$HandoffZipPath = Join-Path $ReviewDirectory 'OrdaX-Component-Public-Trust-Handoff.zip'

foreach ($path in @($TrustPath, $PrimaryDerivedPath, $ProofReleasePath, $InitialEnvelopePath, $InitialResultPath)) {
    Assert-RegularFile $path 'required component trust ceremony file'
}
foreach ($path in @($RecoveredDerivedPath, $RecoveryEnvelopePath, $EvidencePath, $HandoffZipPath)) {
    if (Test-Path -LiteralPath $path) {
        throw "Refusing to replace existing recovery output: $path"
    }
}
if (Test-Path -LiteralPath $PromotionDirectory) {
    $existing = @(Get-ChildItem -LiteralPath $PromotionDirectory -Force)
    if ($existing.Count -ne 0) {
        throw "Public promotion directory must be empty: $PromotionDirectory"
    }
} else {
    New-Item -ItemType Directory -Path $PromotionDirectory | Out-Null
}

$InitialResult = Get-Content -LiteralPath $InitialResultPath -Raw | ConvertFrom-Json
if ($InitialResult.'$schema' -ne 'prototype-ordax.runtime-component-trust-ceremony-result/1' -or
    $InitialResult.status -ne 'local-key-generated-public-anchor-verified-proof-signed' -or
    $InitialResult.source_commit -ne $SourceCommit -or
    $InitialResult.key_id -ne $KeyId -or
    $InitialResult.offline_encrypted_backup_required -ne $true -or
    $InitialResult.offline_recovery_verified -ne $false -or
    $InitialResult.ready_to_pin_public_anchor -ne $false) {
    throw 'Initial component trust ceremony result is invalid or belongs to another source identity.'
}

$CurrentTrustHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $TrustPath).Hash.ToLowerInvariant()
$CurrentProofReleaseHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ProofReleasePath).Hash.ToLowerInvariant()
$CurrentInitialEnvelopeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $InitialEnvelopePath).Hash.ToLowerInvariant()
if ([string]$InitialResult.public_trust_sha256 -ne $CurrentTrustHash -or
    [string]$InitialResult.proof_release_sha256 -ne $CurrentProofReleaseHash -or
    [string]$InitialResult.proof_envelope_sha256 -ne $CurrentInitialEnvelopeHash) {
    throw 'Initial component trust ceremony files changed after the initialization proof.'
}

$ProofRelease = Get-Content -LiteralPath $ProofReleasePath -Raw | ConvertFrom-Json
if ($ProofRelease.'$schema' -ne 'prototype-ordax.runtime-component-release/1' -or
    $ProofRelease.source_repository -ne 'ordaxsystems/ordax-os' -or
    [string]$ProofRelease.source_commit -ne $SourceCommit -or
    $ProofRelease.created_from_ci_recipe -ne 'runtime-component/package/1' -or
    $ProofRelease.component.id -ne 'internet' -or
    $ProofRelease.component.release_mode -ne 'component-slot' -or
    $ProofRelease.activation.direct_activation_allowed -ne $false -or
    $ProofRelease.activation.pending_health_required -ne $true) {
    throw 'Component trust proof release no longer matches toolkit source identity and fail-closed policy.'
}

& $Signer verify-envelope --envelope $InitialEnvelopePath --trust $TrustPath
if ($LASTEXITCODE -ne 0) {
    throw 'Initial component trust envelope no longer verifies before recovery.'
}

Write-Host 'Deriving component trust from recovered private key...'
& $Signer derive-trust --private-key $RecoveredPrivateKeyPath --out $RecoveredDerivedPath --key-id $KeyId
if ($LASTEXITCODE -ne 0) { throw 'Recovered component trust derivation failed.' }

$CanonicalBytes = [IO.File]::ReadAllBytes($TrustPath)
$PrimaryBytes = [IO.File]::ReadAllBytes($PrimaryDerivedPath)
$RecoveredBytes = [IO.File]::ReadAllBytes($RecoveredDerivedPath)
if ($CanonicalBytes.Length -ne $PrimaryBytes.Length -or $CanonicalBytes.Length -ne $RecoveredBytes.Length) {
    throw 'Component trust derivation length mismatch.'
}
for ($i = 0; $i -lt $CanonicalBytes.Length; $i++) {
    if ($CanonicalBytes[$i] -ne $PrimaryBytes[$i] -or $CanonicalBytes[$i] -ne $RecoveredBytes[$i]) {
        throw "Recovered component trust does not match canonical public bytes at byte $i."
    }
}

Write-Host 'Signing component trust proof with recovered private key...'
& $Signer sign --release $ProofReleasePath --private-key $RecoveredPrivateKeyPath --trust $TrustPath --key-id $KeyId --out $RecoveryEnvelopePath
if ($LASTEXITCODE -ne 0) { throw 'Recovered component signing proof failed.' }

Write-Host 'Verifying recovered proof with public component trust...'
& $Signer verify-envelope --envelope $RecoveryEnvelopePath --trust $TrustPath
if ($LASTEXITCODE -ne 0) { throw 'Recovered component signing proof did not verify.' }

$Trust = Get-Content -LiteralPath $TrustPath -Raw | ConvertFrom-Json
if ($Trust.'$schema' -ne 'prototype-ordax.runtime-component-trust/1' -or $Trust.key_id -ne $KeyId) {
    throw 'Unexpected canonical component trust.'
}
$PublicBytes = [Convert]::FromBase64String([string]$Trust.public_key_base64)
if ($PublicBytes.Length -ne 32) {
    throw 'Component Ed25519 public key must contain exactly 32 raw bytes.'
}

$TrustHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $TrustPath).Hash.ToLowerInvariant()
$ProofReleaseHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ProofReleasePath).Hash.ToLowerInvariant()
$RecoveryEnvelopeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $RecoveryEnvelopePath).Hash.ToLowerInvariant()
$Evidence = [ordered]@{
    '$schema' = 'prototype-ordax.runtime-component-trust-ceremony-evidence/1'
    status = 'pass'
    source_commit = $SourceCommit
    key_id = $KeyId
    public_trust_sha256 = $TrustHash
    proof_release_sha256 = $ProofReleaseHash
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
    (($Evidence | ConvertTo-Json -Depth 6) + [Environment]::NewLine),
    $Utf8NoBom
)

Copy-Item -LiteralPath $TrustPath -Destination $PromotionTrustPath
Copy-Item -LiteralPath $EvidencePath -Destination $PromotionEvidencePath
Copy-Item -LiteralPath $ProofReleasePath -Destination $PromotionProofReleasePath
Copy-Item -LiteralPath $RecoveryEnvelopePath -Destination $PromotionRecoveryEnvelopePath

$ExpectedNames = @(
    'runtime-components-ed25519.json',
    'ceremony-public-evidence.json',
    'component-trust-proof-release.json',
    'component-trust-proof-recovery-envelope.json'
) | Sort-Object
$ActualNames = @(Get-ChildItem -LiteralPath $PromotionDirectory -Force | ForEach-Object { $_.Name } | Sort-Object)
if ($ActualNames.Count -ne $ExpectedNames.Count) {
    throw 'Public component trust promotion directory contains unexpected files.'
}
for ($i = 0; $i -lt $ExpectedNames.Count; $i++) {
    if ($ActualNames[$i] -ne $ExpectedNames[$i]) {
        throw 'Public component trust promotion directory contains unexpected entries.'
    }
}
$Forbidden = @(Get-ChildItem -LiteralPath $PromotionDirectory -Force -File | Where-Object {
    $_.Extension -match '^\.(pem|key|p12|pfx|dpapi)$' -or $_.Name -match '(?i)(private|secret|seed)'
})
if ($Forbidden.Count -ne 0) {
    throw 'Secret-looking material is present in public component trust handoff.'
}

Compress-Archive -LiteralPath @(
    $PromotionTrustPath,
    $PromotionEvidencePath,
    $PromotionProofReleasePath,
    $PromotionRecoveryEnvelopePath
) -DestinationPath $HandoffZipPath -CompressionLevel Optimal

Assert-RegularFile $HandoffZipPath 'component public trust handoff zip'
$HandoffHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $HandoffZipPath).Hash.ToLowerInvariant()

$VerifyDirectory = Join-Path $ReviewDirectory ('.handoff-verify-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $VerifyDirectory | Out-Null
try {
    Expand-Archive -LiteralPath $HandoffZipPath -DestinationPath $VerifyDirectory
    $ExpandedNames = @(Get-ChildItem -LiteralPath $VerifyDirectory -Force | ForEach-Object { $_.Name } | Sort-Object)
    if ($ExpandedNames.Count -ne $ExpectedNames.Count) {
        throw 'Public component trust handoff ZIP contains unexpected entries.'
    }
    for ($i = 0; $i -lt $ExpectedNames.Count; $i++) {
        if ($ExpandedNames[$i] -ne $ExpectedNames[$i]) {
            throw 'Public component trust handoff ZIP entry set is invalid.'
        }
        $source = Join-Path $PromotionDirectory $ExpectedNames[$i]
        $expanded = Join-Path $VerifyDirectory $ExpectedNames[$i]
        Assert-RegularFile $expanded 'expanded component trust handoff file'
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash.ToLowerInvariant() -ne
            (Get-FileHash -Algorithm SHA256 -LiteralPath $expanded).Hash.ToLowerInvariant()) {
            throw "Public component trust handoff ZIP changed bytes for $($ExpectedNames[$i])."
        }
    }
}
finally {
    Remove-Item -LiteralPath $VerifyDirectory -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'COMPONENT_TRUST_RECOVERY=PASS'
Write-Host "SOURCE_COMMIT=$SourceCommit"
Write-Host "KEY_ID=$KeyId"
Write-Host 'PRIMARY_PUBLIC_DERIVATION_MATCH=YES'
Write-Host 'RECOVERED_PUBLIC_DERIVATION_MATCH=YES'
Write-Host 'RECOVERED_PRIVATE_PATH_DISTINCT=YES'
Write-Host 'RECOVERED_SIGNING_PROOF=YES'
Write-Host 'PRIVATE_KEY_PRINTED=NO'
Write-Host 'PUBLIC_HANDOFF_SECRET_MATERIAL=NO'
Write-Host 'READY_TO_PIN_PUBLIC_ANCHOR=YES'
Write-Host "PUBLIC_COMPONENT_TRUST_HANDOFF_ZIP=$HandoffZipPath"
Write-Host "PUBLIC_COMPONENT_TRUST_HANDOFF_ZIP_SHA256=$HandoffHash"
