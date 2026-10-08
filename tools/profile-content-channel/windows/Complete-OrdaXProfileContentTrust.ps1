[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$RecoveredPrivateKeyPath,
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
if ([string]::IsNullOrWhiteSpace($ToolkitProvenancePath)) { $ToolkitProvenancePath = Join-Path $ScriptRoot 'provenance.json' }
if ([string]::IsNullOrWhiteSpace($ReviewDirectory)) { $ReviewDirectory = Join-Path $env:LOCALAPPDATA 'OrdaX\ProfileContentTrust\review' }

function Assert-RegularFile([string]$Path,[string]$Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Label is missing: $Path" }
    $item=Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "$Label may not be a reparse point." }
}
Assert-RegularFile $Signer 'Profile content signer'
Assert-RegularFile $FinalizerPath 'trust finalizer'
Assert-RegularFile $PolicyPath 'trust policy'
Assert-RegularFile $CeremonyDocPath 'ceremony document'
Assert-RegularFile $ToolkitProvenancePath 'toolkit provenance'
Assert-RegularFile $RecoveredPrivateKeyPath 'recovered private key'

$Provenance=Get-Content -LiteralPath $ToolkitProvenancePath -Raw | ConvertFrom-Json
if ($Provenance.'$schema' -ne 'prototype-ordax.profile-content-trust-toolkit/1' -or
    $Provenance.source_repository -ne 'ordaxsystems/ordax-os' -or
    $Provenance.source_event -ne 'push' -or
    $Provenance.source_ref -ne 'refs/heads/main' -or
    $Provenance.canonical_profile_content_trust_ceremony_eligible -ne $true) {
    throw 'Recovery requires an eligible canonical main-push toolkit.'
}
$SourceCommit=[string]$Provenance.source_commit
if ($SourceCommit -notmatch '^[0-9a-f]{40}$') { throw 'source_commit is invalid.' }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $Signer).Hash.ToLowerInvariant() -ne [string]$Provenance.components.profile_content_signer.sha256 -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath $FinalizerPath).Hash.ToLowerInvariant() -ne [string]$Provenance.components.trust_recovery_finalizer.sha256 -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath $PolicyPath).Hash.ToLowerInvariant() -ne [string]$Provenance.policy_sha256 -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath $CeremonyDocPath).Hash.ToLowerInvariant() -ne [string]$Provenance.ceremony_doc_sha256) {
    throw 'Profile content trust recovery toolkit/policy bytes do not match provenance.'
}

$Policy=Get-Content -LiteralPath $PolicyPath -Raw | ConvertFrom-Json
if ($Policy.public_anchor.pinned -ne $false -or
    $Policy.current_gates.profile_content_publish_allowed -ne $false -or
    $Policy.current_gates.profile_content_install_allowed -ne $false -or
    $Policy.current_gates.profile_content_activation_allowed -ne $false) {
    throw 'Profile content trust policy is not fail-closed pre-promotion state.'
}

$ReviewDirectory=[IO.Path]::GetFullPath($ReviewDirectory)
$RecoveredPrivateKeyPath=[IO.Path]::GetFullPath($RecoveredPrivateKeyPath)
$DefaultPrivate=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'OrdaX\ProfileContentTrust\private\profile-content-private.pem'))
if ($RecoveredPrivateKeyPath.Equals($DefaultPrivate,[StringComparison]::OrdinalIgnoreCase)) {
    throw 'Recovered private key must be a distinct restored file.'
}

$TrustPath=Join-Path $ReviewDirectory 'profile-content-ed25519.json'
$PrimaryDerivedPath=Join-Path $ReviewDirectory 'profile-content-ed25519-derived.json'
$ContentPath=Join-Path $ReviewDirectory 'content.pack'
$ManifestPath=Join-Path $ReviewDirectory 'profile-content-trust-proof-manifest.json'
$InitialEnvelopePath=Join-Path $ReviewDirectory 'profile-content-trust-proof-envelope.json'
$InitialResultPath=Join-Path $ReviewDirectory 'ceremony-result.json'
$RecoveredDerivedPath=Join-Path $ReviewDirectory 'profile-content-ed25519-recovered.json'
$RecoveryEnvelopePath=Join-Path $ReviewDirectory 'profile-content-trust-proof-recovery-envelope.json'
$EvidencePath=Join-Path $ReviewDirectory 'ceremony-public-evidence.json'
$PromotionDirectory=Join-Path $ReviewDirectory 'public-promotion'
$HandoffZipPath=Join-Path $ReviewDirectory 'OrdaX-Profile-Content-Public-Trust-Handoff.zip'
foreach ($filePath in @($TrustPath,$PrimaryDerivedPath,$ContentPath,$ManifestPath,$InitialEnvelopePath,$InitialResultPath)) {
    Assert-RegularFile $filePath 'required ceremony file'
}
foreach ($filePath in @($RecoveredDerivedPath,$RecoveryEnvelopePath,$EvidencePath,$HandoffZipPath)) {
    if (Test-Path -LiteralPath $filePath) { throw "Refusing to replace recovery output: $filePath" }
}

$Initial=Get-Content -LiteralPath $InitialResultPath -Raw | ConvertFrom-Json
if ($Initial.'$schema' -ne 'prototype-ordax.profile-content-trust-ceremony-result/1' -or
    $Initial.status -ne 'local-key-generated-public-anchor-verified-proof-signed' -or
    $Initial.source_commit -ne $SourceCommit -or
    $Initial.key_id -ne $KeyId -or
    $Initial.offline_recovery_verified -ne $false -or
    $Initial.ready_to_pin_public_anchor -ne $false) {
    throw 'Initial ceremony result is invalid.'
}
if ([string]$Initial.public_trust_sha256 -ne (Get-FileHash -Algorithm SHA256 -LiteralPath $TrustPath).Hash.ToLowerInvariant() -or
    [string]$Initial.proof_manifest_sha256 -ne (Get-FileHash -Algorithm SHA256 -LiteralPath $ManifestPath).Hash.ToLowerInvariant() -or
    [string]$Initial.proof_content_sha256 -ne (Get-FileHash -Algorithm SHA256 -LiteralPath $ContentPath).Hash.ToLowerInvariant() -or
    [string]$Initial.proof_envelope_sha256 -ne (Get-FileHash -Algorithm SHA256 -LiteralPath $InitialEnvelopePath).Hash.ToLowerInvariant()) {
    throw 'Initial ceremony files changed after initialization proof.'
}

& $Signer verify --manifest $ManifestPath --envelope $InitialEnvelopePath --trust $TrustPath --content $ContentPath
if ($LASTEXITCODE -ne 0) { throw 'Initial ceremony envelope no longer verifies.' }
& $Signer derive-trust --private-key $RecoveredPrivateKeyPath --out $RecoveredDerivedPath --key-id $KeyId
if ($LASTEXITCODE -ne 0) { throw 'Recovered public derivation failed.' }

$Canonical=[IO.File]::ReadAllBytes($TrustPath)
$Primary=[IO.File]::ReadAllBytes($PrimaryDerivedPath)
$Recovered=[IO.File]::ReadAllBytes($RecoveredDerivedPath)
if ($Canonical.Length -ne $Primary.Length -or $Canonical.Length -ne $Recovered.Length) { throw 'Recovered trust length mismatch.' }
for ($i=0;$i -lt $Canonical.Length;$i++) {
    if ($Canonical[$i] -ne $Primary[$i] -or $Canonical[$i] -ne $Recovered[$i]) {
        throw "Recovered public trust differs at byte $i."
    }
}

& $Signer sign --manifest $ManifestPath --private-key $RecoveredPrivateKeyPath --trust $TrustPath --key-id $KeyId --out $RecoveryEnvelopePath
if ($LASTEXITCODE -ne 0) { throw 'Recovered signing proof failed.' }
& $Signer verify --manifest $ManifestPath --envelope $RecoveryEnvelopePath --trust $TrustPath --content $ContentPath
if ($LASTEXITCODE -ne 0) { throw 'Recovered signing proof did not verify.' }

$Evidence=[ordered]@{
    '$schema'='prototype-ordax.profile-content-trust-ceremony-evidence/1'
    status='pass'
    source_commit=$SourceCommit
    key_id=$KeyId
    public_trust_sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $TrustPath).Hash.ToLowerInvariant()
    proof_manifest_sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $ManifestPath).Hash.ToLowerInvariant()
    proof_content_sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $ContentPath).Hash.ToLowerInvariant()
    recovery_envelope_sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $RecoveryEnvelopePath).Hash.ToLowerInvariant()
    primary_public_derivation_match=$true
    recovered_public_derivation_match=$true
    recovered_private_path_distinct=$true
    recovered_signing_proof=$true
    offline_encrypted_backup_recovery_verified=$true
    private_key_in_public_evidence=$false
    ready_to_pin_public_anchor=$true
}
$Utf8NoBom=[Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($EvidencePath,(($Evidence|ConvertTo-Json -Depth 6)+[Environment]::NewLine),$Utf8NoBom)

if (Test-Path -LiteralPath $PromotionDirectory) {
    if (@(Get-ChildItem -LiteralPath $PromotionDirectory -Force).Count -ne 0) { throw 'Public promotion directory must be empty.' }
} else { New-Item -ItemType Directory -Path $PromotionDirectory | Out-Null }
$PublicFiles=@(
    @{src=$TrustPath; name='profile-content-ed25519.json'},
    @{src=$EvidencePath; name='ceremony-public-evidence.json'},
    @{src=$ManifestPath; name='profile-content-trust-proof-manifest.json'},
    @{src=$RecoveryEnvelopePath; name='profile-content-trust-proof-recovery-envelope.json'},
    @{src=$ContentPath; name='content.pack'}
)
foreach($publicFile in $PublicFiles){ Copy-Item -LiteralPath $publicFile.src -Destination (Join-Path $PromotionDirectory $publicFile.name) }
$Forbidden=@(Get-ChildItem -LiteralPath $PromotionDirectory -Force -File | Where-Object {
    $_.Extension -match '^\.(pem|key|p12|pfx|dpapi)$' -or $_.Name -match '(?i)(private|secret|seed)'
})
if ($Forbidden.Count -ne 0) { throw 'Secret-looking material is present in public handoff.' }
Compress-Archive -Path (Join-Path $PromotionDirectory '*') -DestinationPath $HandoffZipPath -CompressionLevel Optimal
Assert-RegularFile $HandoffZipPath 'public trust handoff'

Write-Host 'PROFILE_CONTENT_TRUST_RECOVERY=PASS'
Write-Host 'PRIMARY_PUBLIC_DERIVATION_MATCH=YES'
Write-Host 'RECOVERED_PUBLIC_DERIVATION_MATCH=YES'
Write-Host 'RECOVERED_PRIVATE_PATH_DISTINCT=YES'
Write-Host 'RECOVERED_SIGNING_PROOF=YES'
Write-Host 'PUBLIC_HANDOFF_SECRET_MATERIAL=NO'
Write-Host 'READY_TO_PIN_PUBLIC_ANCHOR=YES'
Write-Host "PUBLIC_PROFILE_CONTENT_TRUST_HANDOFF_ZIP=$HandoffZipPath"
