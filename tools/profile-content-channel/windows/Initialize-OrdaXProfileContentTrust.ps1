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
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Label is missing: $Path" }
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "$Label may not be a reparse point or symlink."
    }
}
function Assert-OutsideToolkit([string]$Path, [string]$Label) {
    $absolute = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetFullPath($ScriptRoot)
    $prefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if ($absolute.Equals($root,[StringComparison]::OrdinalIgnoreCase) -or
        $absolute.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label must stay outside the toolkit/repository directory."
    }
}

Assert-RegularFile $Signer 'Profile content signer'
Assert-RegularFile $ToolkitProvenancePath 'toolkit provenance'
Assert-RegularFile $InitializerPath 'trust initializer'
Assert-RegularFile $PolicyPath 'trust policy'
Assert-RegularFile $CeremonyDocPath 'ceremony document'

$Provenance = Get-Content -LiteralPath $ToolkitProvenancePath -Raw | ConvertFrom-Json
if ($Provenance.'$schema' -ne 'prototype-ordax.profile-content-trust-toolkit/1' -or
    $Provenance.status -ne 'candidate') {
    throw 'Profile content trust toolkit provenance is invalid.'
}
if ($Provenance.source_repository -ne 'ordaxsystems/ordax-os' -or
    $Provenance.source_event -ne 'push' -or
    $Provenance.source_ref -ne 'refs/heads/main' -or
    $Provenance.canonical_profile_content_trust_ceremony_eligible -ne $true) {
    throw 'Canonical Profile content trust requires an eligible main-push toolkit.'
}
$SourceCommit = [string]$Provenance.source_commit
if ($SourceCommit -notmatch '^[0-9a-f]{40}$') { throw 'source_commit must be 40 lowercase hex.' }

$ExpectedSignerSha = [string]$Provenance.components.profile_content_signer.sha256
$ExpectedInitializerSha = [string]$Provenance.components.trust_initializer.sha256
$ExpectedPolicySha = [string]$Provenance.policy_sha256
$ExpectedCeremonySha = [string]$Provenance.ceremony_doc_sha256
foreach ($hash in @($ExpectedSignerSha,$ExpectedInitializerSha,$ExpectedPolicySha,$ExpectedCeremonySha)) {
    if ($hash -notmatch '^[0-9a-f]{64}$') { throw 'Toolkit hash is invalid.' }
}
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $Signer).Hash.ToLowerInvariant() -ne $ExpectedSignerSha -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath $InitializerPath).Hash.ToLowerInvariant() -ne $ExpectedInitializerSha -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath $PolicyPath).Hash.ToLowerInvariant() -ne $ExpectedPolicySha -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath $CeremonyDocPath).Hash.ToLowerInvariant() -ne $ExpectedCeremonySha) {
    throw 'Profile content trust toolkit/policy bytes do not match provenance.'
}

$Policy = Get-Content -LiteralPath $PolicyPath -Raw | ConvertFrom-Json
if ($Policy.'$schema' -ne 'prototype-ordax.profile-content-trust-policy/1' -or
    $Policy.status -ne 'operator-ceremony-not-started' -or
    $Policy.key_id -ne $KeyId -or
    $Policy.public_anchor.pinned -ne $false -or
    $Policy.current_gates.profile_content_publish_allowed -ne $false -or
    $Policy.current_gates.profile_content_install_allowed -ne $false -or
    $Policy.current_gates.profile_content_activation_allowed -ne $false) {
    throw 'Profile content trust policy is not fail-closed pre-ceremony state.'
}

Write-Host 'PROFILE_CONTENT_TRUST_TOOLKIT_PREFLIGHT=PASS'
Write-Host "SOURCE_COMMIT=$SourceCommit"
Write-Host 'CANONICAL_PROFILE_CONTENT_TRUST_CEREMONY_ELIGIBLE=YES'
Write-Host 'PRIVATE_KEY_TOUCHED=NO'
if ($PreflightOnly) {
    Write-Host 'FILESYSTEM_MUTATION=NO'
    exit 0
}
if (-not $GenerateKey) { throw 'Refusing key generation without explicit -GenerateKey.' }

Assert-OutsideToolkit $PrivateKeyPath 'Private key'
Assert-OutsideToolkit $ReviewDirectory 'Review directory'
$PrivateKeyPath = [IO.Path]::GetFullPath($PrivateKeyPath)
$ReviewDirectory = [IO.Path]::GetFullPath($ReviewDirectory)
if (Test-Path -LiteralPath $PrivateKeyPath) { throw "Refusing to replace existing private key: $PrivateKeyPath" }
if (Test-Path -LiteralPath $ReviewDirectory) {
    if (@(Get-ChildItem -LiteralPath $ReviewDirectory -Force).Count -ne 0) { throw 'Review directory must be empty.' }
} else {
    New-Item -ItemType Directory -Path $ReviewDirectory -Force | Out-Null
}
New-Item -ItemType Directory -Path (Split-Path -Parent $PrivateKeyPath) -Force | Out-Null

$TrustPath = Join-Path $ReviewDirectory 'profile-content-ed25519.json'
$DerivedPath = Join-Path $ReviewDirectory 'profile-content-ed25519-derived.json'
$ContentPath = Join-Path $ReviewDirectory 'content.pack'
$ManifestPath = Join-Path $ReviewDirectory 'profile-content-trust-proof-manifest.json'
$EnvelopePath = Join-Path $ReviewDirectory 'profile-content-trust-proof-envelope.json'
$ResultPath = Join-Path $ReviewDirectory 'ceremony-result.json'

& $Signer generate-key --private-key $PrivateKeyPath --trust $TrustPath --key-id $KeyId
if ($LASTEXITCODE -ne 0) { throw 'Profile content key generation failed.' }
& $Signer derive-trust --private-key $PrivateKeyPath --out $DerivedPath --key-id $KeyId
if ($LASTEXITCODE -ne 0) { throw 'Independent Profile content trust derivation failed.' }

$TrustBytes = [IO.File]::ReadAllBytes($TrustPath)
$DerivedBytes = [IO.File]::ReadAllBytes($DerivedPath)
if ($TrustBytes.Length -ne $DerivedBytes.Length) { throw 'Independent trust derivation length mismatch.' }
for ($i=0; $i -lt $TrustBytes.Length; $i++) {
    if ($TrustBytes[$i] -ne $DerivedBytes[$i]) { throw "Independent trust derivation differs at byte $i." }
}

$Text = 'OrdaX Profile content trust ceremony non-production proof.'
$TextBytes = [Text.Encoding]::UTF8.GetBytes($Text)
$TextSha = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($TextBytes)).ToLowerInvariant()
$Pack = [ordered]@{
    schema = 'ordax.profile-content-pack/1'
    kind = 'knowledge-pack'
    entries = @([ordered]@{
        id = 'trust.ceremony-proof'
        mediaType = 'text/plain'
        content = $Text
        contentSha256 = $TextSha
        source = [ordered]@{
            uri = 'urn:ordax:profile-content:trust-ceremony-proof'
            revision = $SourceCommit
            license = 'internal-proof-only'
            jurisdiction = $null
            title = 'Profile content trust ceremony proof'
        }
    })
}
$Utf8NoBom = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($ContentPath,(($Pack | ConvertTo-Json -Depth 8 -Compress)+[Environment]::NewLine),$Utf8NoBom)
$ContentBytes = [IO.File]::ReadAllBytes($ContentPath)
$ContentSha = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($ContentBytes)).ToLowerInvariant()

$Manifest = [ordered]@{
    '$schema' = 'prototype-ordax.profile-content-manifest/1'
    id = 'knowledge.trust-ceremony-proof'
    kind = 'knowledge-pack'
    version = '0.0.0-trust-proof'
    publisher = 'ordax'
    content_hash = $ContentSha
    content_size = $ContentBytes.Length
    content_format = 'ordax.profile-content-pack/1'
    source = [ordered]@{
        uri = 'urn:ordax:profile-content:trust-ceremony-proof'
        revision = $SourceCommit
        license = 'internal-proof-only'
        jurisdiction = $null
    }
    requested_capabilities = @()
    runtime_network_allowed = $false
    mutable_host_access_allowed = $false
}
[IO.File]::WriteAllText($ManifestPath,(($Manifest | ConvertTo-Json -Depth 8)+[Environment]::NewLine),$Utf8NoBom)

& $Signer sign --manifest $ManifestPath --private-key $PrivateKeyPath --trust $TrustPath --key-id $KeyId --out $EnvelopePath
if ($LASTEXITCODE -ne 0) { throw 'Profile content trust signing proof failed.' }
& $Signer verify --manifest $ManifestPath --envelope $EnvelopePath --trust $TrustPath --content $ContentPath
if ($LASTEXITCODE -ne 0) { throw 'Profile content trust proof did not verify.' }

$Result = [ordered]@{
    '$schema' = 'prototype-ordax.profile-content-trust-ceremony-result/1'
    status = 'local-key-generated-public-anchor-verified-proof-signed'
    source_commit = $SourceCommit
    key_id = $KeyId
    public_trust_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $TrustPath).Hash.ToLowerInvariant()
    proof_manifest_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $ManifestPath).Hash.ToLowerInvariant()
    proof_content_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $ContentPath).Hash.ToLowerInvariant()
    proof_envelope_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $EnvelopePath).Hash.ToLowerInvariant()
    independent_public_derivation_match = $true
    proof_signature_verified = $true
    offline_encrypted_backup_required = $true
    offline_recovery_verified = $false
    ready_to_pin_public_anchor = $false
    private_key_in_public_result = $false
}
[IO.File]::WriteAllText($ResultPath,(($Result | ConvertTo-Json -Depth 6)+[Environment]::NewLine),$Utf8NoBom)

Write-Host 'PROFILE_CONTENT_TRUST_INITIALIZATION=PASS'
Write-Host 'INDEPENDENT_PUBLIC_DERIVATION_MATCH=YES'
Write-Host 'PROOF_SIGNATURE_VERIFIED=YES'
Write-Host 'OFFLINE_RECOVERY_VERIFIED=NO'
Write-Host 'READY_TO_PIN_PUBLIC_ANCHOR=NO'
