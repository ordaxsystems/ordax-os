[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$CandidateRoot,

    [string]$PrivateKeyPath = '',
    [string]$OutputDirectory = '',
    [switch]$Publish,
    [string]$ConfirmPublication = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repository = 'ordaxsystems/ordax-os'
$ReleaseTag = 'creator-physical'
$KeyId = 'ordax-prototype-release-v1'
$ExpectedManifestSchema = 'prototype-ordax.creator-physical-manifest/2'
$ExpectedPortableManifestSchema = 'prototype-ordax.creator-physical-manifest/3'
$ExpectedPortablePayloadSchema = 'prototype-ordax.creator-portable-payload/1'
$ExpectedEnvelopeSchema = 'prototype-ordax.creator-physical-envelope/1'
$ExpectedProvenanceSchema = 'prototype-ordax.physical-write-candidate/2'
$ExpectedPurpose = 'creator-portable-physical-windows-amd64'
$ExpectedRecipe = 'creator/physical/portable-windows/2'
$ExpectedBundleName = 'ordax-creator-physical-windows-amd64.zip'
$ExpectedEnvelopeName = 'creator-physical-envelope.json'
$ExpectedManifestName = 'creator-physical-manifest.json'
$PublishConfirmation = 'PUBLISH_CREATOR_PHYSICAL_RELEASE'

function Resolve-RealLeaf([string]$Path, [string]$Label) {
    $full = [IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        throw "$Label is missing: $full"
    }
    $item = Get-Item -LiteralPath $full -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "$Label may not be a reparse point or symlink: $full"
    }
    return $full
}

function Resolve-RealDirectory([string]$Path, [string]$Label) {
    $full = [IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $full -PathType Container)) {
        throw "$Label directory is missing: $full"
    }
    $item = Get-Item -LiteralPath $full -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "$Label directory may not be a reparse point or symlink: $full"
    }
    return $full
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Get-FileSize([string]$Path) {
    return (Get-Item -LiteralPath $Path -Force).Length
}

function Assert-LowerHex([string]$Value, [int]$Length, [string]$Label) {
    if ($Value.Length -ne $Length -or $Value -cne $Value.ToLowerInvariant() -or $Value -notmatch ('^[0-9a-f]{' + $Length + '}$')) {
        throw "$Label is not canonical lowercase hex: $Value"
    }
}

$ScriptDirectory = [IO.Path]::GetFullPath($PSScriptRoot)
$RepoRoot = [IO.Path]::GetFullPath((Join-Path $ScriptDirectory '..\..\..'))
$CandidateRoot = Resolve-RealDirectory $CandidateRoot 'Candidate root'

$CandidateDirectory = Join-Path $CandidateRoot 'physical-write-candidate'
$ReleaseDirectory = Join-Path $CandidateRoot 'physical-write-release'
if (-not (Test-Path -LiteralPath $CandidateDirectory -PathType Container)) {
    if (Test-Path -LiteralPath (Join-Path $CandidateRoot 'provenance.json') -PathType Leaf) {
        $CandidateDirectory = $CandidateRoot
        $ReleaseDirectory = Resolve-RealDirectory (Join-Path $CandidateRoot '..\physical-write-release') 'Physical release'
    } else {
        throw 'Candidate root must contain physical-write-candidate and physical-write-release.'
    }
}
$CandidateDirectory = Resolve-RealDirectory $CandidateDirectory 'Physical candidate'
$ReleaseDirectory = Resolve-RealDirectory $ReleaseDirectory 'Physical release'

$ProvenancePath = Resolve-RealLeaf (Join-Path $CandidateDirectory 'provenance.json') 'Candidate provenance'
$AuthorizationPath = Resolve-RealLeaf (Join-Path $CandidateDirectory 'physical-write-authorization.json') 'Physical authorization'
$TrustPath = Resolve-RealLeaf (Join-Path $CandidateDirectory 'release-ed25519.json') 'Canonical public trust'
$BundlePath = Resolve-RealLeaf (Join-Path $ReleaseDirectory $ExpectedBundleName) 'Creator physical bundle'
$ManifestPath = Resolve-RealLeaf (Join-Path $ReleaseDirectory $ExpectedManifestName) 'Creator physical manifest'

$ExpectedFiles = @(
    'ordax-creator-physical-test.exe',
    'release-ed25519.json',
    'minimal-bootstrap.json',
    'portable-usb-v2.json',
    'creator-portable-media-plan.json',
    'physical-write-authorization.json',
    'provenance.json',
    'SHA256SUMS'
)
foreach ($name in $ExpectedFiles) {
    $null = Resolve-RealLeaf (Join-Path $CandidateDirectory $name) "Candidate file $name"
}

$ExpectedPortableArtifactIds = @(
    'systemd-boot',
    'loader-config',
    'loader-normal',
    'loader-recovery',
    'kernel',
    'initramfs',
    'bootstrap-capsule',
    'release-trust',
    'stable-base',
    'persistent-state',
    'system-image',
    'surface-runtime-image',
    'surface-runtime-ref',
    'local-ai-runtime-image',
    'local-ai-runtime-ref',
    'release-manifest',
    'release-envelope'
)

$Provenance = Get-Content -LiteralPath $ProvenancePath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]$Provenance.'$schema' -ne $ExpectedProvenanceSchema) { throw 'Unexpected physical candidate provenance schema.' }
if ([string]$Provenance.status -ne 'authorized-candidate-not-published') { throw 'Physical candidate is not in authorized pre-publication state.' }
if ($Provenance.physical_write_authorized_in_binary -ne $true) { throw 'Physical writer binary is not authorization-bound.' }
if ($Provenance.release_published -ne $false) { throw 'Candidate provenance unexpectedly claims publication.' }
if ($Provenance.private_key_in_candidate -ne $false) { throw 'Candidate provenance indicates private signing material.' }
if ($Provenance.whole_disk_raw_image_required -ne $false) { throw 'Portable candidate regressed to whole-disk RAW.' }
if ([int]$Provenance.portable_artifact_count -ne 17) { throw 'Portable candidate must bind exactly 17 artifacts.' }
if ([int]$Provenance.portable_application_operation_count -ne 39) { throw 'Portable candidate must bind the 39-operation application plan.' }
if ([int64]$Provenance.release_sequence -le 0) { throw 'Physical release sequence is invalid.' }
$WriterSourceCommit = [string]$Provenance.source_commit
$ReleaseSourceCommit = [string]$Provenance.canonical_v4_release_source_commit
Assert-LowerHex $WriterSourceCommit 40 'Writer source commit'
Assert-LowerHex $ReleaseSourceCommit 40 'Canonical v4 release source commit'

$Authorization = Get-Content -LiteralPath $AuthorizationPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]$Authorization.'$schema' -ne 'prototype-ordax.physical-write-authorization/3') { throw 'Unexpected physical authorization schema.' }
if ([string]$Authorization.status -ne 'authorized' -or $Authorization.physical_write_allowed -ne $true -or $Authorization.explicit_owner_authorization -ne $true) {
    throw 'Physical authorization is not the explicit authorized state.'
}
if ([string]$Authorization.scope -ne 'first-real-stable-mvp-usb-proof') { throw 'Physical authorization scope is not the first Stable/MVP USB proof.' }
if ([int64]$Authorization.release_sequence -ne [int64]$Provenance.release_sequence) { throw 'Authorization and candidate release sequences disagree.' }
if ([string]$Authorization.release_binding.source_commit -ne $ReleaseSourceCommit) { throw 'Authorization and candidate canonical release commits disagree.' }
$AuthorizationContextSHA = [string]$Authorization.authorization_context_sha256
Assert-LowerHex $AuthorizationContextSHA 64 'Candidate authorization context SHA-256'
$CandidateAuthorizationSHA = Get-Sha256 $AuthorizationPath
$ProvenanceAuthorizationSHA = [string]$Provenance.physical_write_authorization_sha256
Assert-LowerHex $ProvenanceAuthorizationSHA 64 'Candidate provenance physical authorization SHA-256'
if ($ProvenanceAuthorizationSHA -ne $CandidateAuthorizationSHA) {
    throw 'Candidate physical authorization SHA-256 differs from provenance.'
}

$ManifestBytes = [IO.File]::ReadAllBytes($ManifestPath)
$Manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$ManifestSchema = [string]$Manifest.'$schema'
if ($ManifestSchema -ne $ExpectedManifestSchema -and $ManifestSchema -ne $ExpectedPortableManifestSchema) {
    throw 'Unexpected Creator physical manifest schema.'
}
if ([string]$Manifest.purpose -ne $ExpectedPurpose) { throw 'Unexpected Creator physical manifest purpose.' }
if ([string]$Manifest.source_repository -ne $Repository) { throw 'Creator physical manifest repository mismatch.' }
if ([string]$Manifest.created_from_recipe -ne $ExpectedRecipe) { throw 'Unexpected Creator physical manifest recipe.' }
if ([string]$Manifest.source_commit -ne $WriterSourceCommit) { throw 'Creator physical manifest is not bound to the candidate writer commit.' }
if ([string]$Manifest.bundle.url -ne "https://github.com/$Repository/releases/download/$ReleaseTag/$ExpectedBundleName") {
    throw 'Creator physical manifest bundle URL is not the canonical creator-physical release URL.'
}
$BundleSHA = Get-Sha256 $BundlePath
$BundleSize = Get-FileSize $BundlePath
if ([string]$Manifest.bundle.sha256 -ne $BundleSHA -or [int64]$Manifest.bundle.size -ne $BundleSize) {
    throw 'Creator physical bundle does not match manifest SHA-256/size.'
}

$Bindings = @{}
foreach ($binding in @($Manifest.files)) {
    $Bindings[[string]$binding.name] = $binding
}
if ($Bindings.Count -ne $ExpectedFiles.Count) { throw 'Creator physical manifest must bind exactly the expected 8 files.' }
foreach ($name in $ExpectedFiles) {
    if (-not $Bindings.ContainsKey($name)) { throw "Creator physical manifest is missing binding for $name" }
    $path = Join-Path $CandidateDirectory $name
    if ([string]$Bindings[$name].sha256 -ne (Get-Sha256 $path) -or [int64]$Bindings[$name].size -ne (Get-FileSize $path)) {
        throw "Creator physical candidate binding mismatch for $name"
    }
}

if ($ManifestSchema -eq $ExpectedManifestSchema) {
    if ($null -ne $Manifest.portable_payload) {
        throw 'Creator physical manifest v2 may not carry a Portable payload.'
    }
} else {
    if ($null -eq $Manifest.portable_payload) {
        throw 'Creator physical manifest v3 requires the signed Portable payload.'
    }
    $PortablePayload = $Manifest.portable_payload
    if ([string]$PortablePayload.'$schema' -ne $ExpectedPortablePayloadSchema) {
        throw 'Unexpected Creator Portable payload schema.'
    }
    if ([string]$PortablePayload.release_source_commit -ne $ReleaseSourceCommit) {
        throw 'Creator Portable payload is not bound to the canonical v4 release source commit.'
    }
    $PortableBindings = @{}
    [int64]$PortableTotalBytes = 0
    foreach ($binding in @($PortablePayload.artifacts)) {
        $id = [string]$binding.id
        if ($PortableBindings.ContainsKey($id)) {
            throw "Duplicate Creator Portable payload binding: $id"
        }
        $PortableBindings[$id] = $binding
        $sha = [string]$binding.sha256
        Assert-LowerHex $sha 64 "Portable payload SHA-256 for $id"
        [int64]$size = $binding.size_bytes
        if ($size -le 0 -or $size -gt 17179869184) {
            throw "Portable payload size is outside allowed range for $id"
        }
        if ($PortableTotalBytes -gt 34359738368 - $size) {
            throw 'Creator Portable payload total size exceeds allowed range.'
        }
        $PortableTotalBytes += $size
        $url = [Uri]([string]$binding.url)
        if ($url.Scheme -cne 'https' -or
            $url.Host -cne 'github.com' -or
            -not $url.AbsolutePath.StartsWith("/$Repository/releases/download/", [StringComparison]::Ordinal)) {
            throw "Portable payload URL is outside the canonical release namespace for $id"
        }
        if (-not [string]::IsNullOrEmpty($url.Query) -or -not [string]::IsNullOrEmpty($url.Fragment) -or -not [string]::IsNullOrEmpty($url.UserInfo)) {
            throw "Portable payload URL contains forbidden query/fragment/userinfo for $id"
        }
    }
    if ($PortableBindings.Count -ne $ExpectedPortableArtifactIds.Count) {
        throw 'Creator physical manifest v3 must bind exactly 17 Portable artifacts.'
    }
    foreach ($id in $ExpectedPortableArtifactIds) {
        if (-not $PortableBindings.ContainsKey($id)) {
            throw "Creator physical manifest v3 is missing Portable artifact $id"
        }
    }
}

# Bind the signing checkout to the exact candidate source before the private key is resolved.
$Git = Get-Command git -ErrorAction Stop
$HeadOutput = @(& $Git.Source -C $RepoRoot rev-parse HEAD)
if ($LASTEXITCODE -ne 0 -or $HeadOutput.Count -ne 1) {
    throw 'Cannot resolve the signing checkout HEAD.'
}
$SigningHead = ([string]$HeadOutput[0]).Trim()
Assert-LowerHex $SigningHead 40 'Signing checkout HEAD'
if ($SigningHead -ne $WriterSourceCommit) {
    throw "Signing checkout HEAD differs from candidate writer source commit: head=$SigningHead candidate=$WriterSourceCommit"
}
$TrackedStatus = @(& $Git.Source -C $RepoRoot status --porcelain=v1 --untracked-files=no)
if ($LASTEXITCODE -ne 0) {
    throw 'Cannot inspect the signing checkout for tracked changes.'
}
if ($TrackedStatus.Count -ne 0) {
    throw 'Signing checkout contains tracked changes; refusing to touch the private key.'
}

# Re-evaluate the exact source-controlled authorization context immediately before the private key is touched.
$Python = Get-Command python -ErrorAction Stop
$PromotionLines = @(& $Python.Source (Join-Path $RepoRoot 'tools\creator\physical_promotion.py') --require-ready)
$PromotionExitCode = $LASTEXITCODE
if ($PromotionExitCode -ne 0) { throw 'Current source tree is no longer eligible for authorized physical candidate publication.' }
try {
    $PromotionStatus = (($PromotionLines -join "`n") | ConvertFrom-Json)
} catch {
    throw 'Current physical promotion status could not be decoded as JSON.'
}
if ([string]$PromotionStatus.computed_authorization_context_sha256 -ne $AuthorizationContextSHA) {
    throw 'Current authorization context differs from the candidate-authorized context.'
}
if ([string]$PromotionStatus.canonical_v4_release_source_commit -ne $ReleaseSourceCommit) {
    throw 'Current canonical release binding differs from the candidate provenance.'
}

if ([string]::IsNullOrWhiteSpace($PrivateKeyPath)) {
    if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
        throw 'USERPROFILE is unavailable; provide -PrivateKeyPath explicitly.'
    }
    $PrivateKeyPath = Join-Path $env:USERPROFILE 'OrdaX-Private\release-signing\ordax-release-private.pem'
}
$PrivateKeyPath = Resolve-RealLeaf $PrivateKeyPath 'Canonical private key'
if ($PrivateKeyPath.StartsWith($RepoRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    $PrivateKeyPath.Equals($RepoRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $PrivateKeyPath.StartsWith($CandidateRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    $PrivateKeyPath.Equals($CandidateRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Canonical private key must remain outside both the repository and physical candidate directories.'
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $CandidateRoot 'creator-physical-publication'
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $OutputDirectory) {
    throw "Publication output already exists; overwrite is forbidden: $OutputDirectory"
}
[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null

$Go = Get-Command go -ErrorAction Stop
$Temporary = Join-Path ([IO.Path]::GetTempPath()) ("ordax-physical-signer-" + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($Temporary) | Out-Null
try {
    $Signer = Join-Path $Temporary 'ordax-physical-release-signing.exe'
    Push-Location (Join-Path $RepoRoot 'tools\release-signing')
    try {
        & $Go.Source build -trimpath -buildvcs=false -o $Signer .\cmd\ordax-physical-release-signing
        if ($LASTEXITCODE -ne 0) { throw 'Building the purpose-bound physical release signer failed.' }
        & $Go.Source test -count=1 .\cmd\ordax-physical-release-signing
        if ($LASTEXITCODE -ne 0) { throw 'Purpose-bound physical release signer tests failed.' }
    } finally {
        Pop-Location
    }

    $EnvelopePath = Join-Path $OutputDirectory $ExpectedEnvelopeName
    & $Signer `
        --manifest $ManifestPath `
        --private-key $PrivateKeyPath `
        --trust $TrustPath `
        --key-id $KeyId `
        --out $EnvelopePath
    if ($LASTEXITCODE -ne 0) { throw 'Creator physical manifest signing failed.' }

    $Envelope = Get-Content -LiteralPath $EnvelopePath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]$Envelope.'$schema' -ne $ExpectedEnvelopeSchema) { throw 'Signed Creator physical envelope schema is invalid.' }
    if ([string]$Envelope.key_id -ne $KeyId) { throw 'Signed Creator physical envelope key id is invalid.' }
    $PayloadBytes = [Convert]::FromBase64String([string]$Envelope.payload)
    if ($PayloadBytes.Length -ne $ManifestBytes.Length) { throw 'Signed envelope payload length differs from manifest bytes.' }
    for ($i = 0; $i -lt $ManifestBytes.Length; $i++) {
        if ($PayloadBytes[$i] -ne $ManifestBytes[$i]) { throw 'Signed envelope payload is not byte-identical to the manifest.' }
    }
    $SignatureBytes = [Convert]::FromBase64String([string]$Envelope.signature)
    if ($SignatureBytes.Length -ne 64) { throw 'Signed Creator physical envelope does not contain an Ed25519-sized signature.' }

    Copy-Item -LiteralPath $BundlePath -Destination (Join-Path $OutputDirectory $ExpectedBundleName)
    Copy-Item -LiteralPath $ManifestPath -Destination (Join-Path $OutputDirectory $ExpectedManifestName)

    $EnvelopeSHA = Get-Sha256 $EnvelopePath
    $ManifestSHA = Get-Sha256 (Join-Path $OutputDirectory $ExpectedManifestName)
    $PublishedBundlePath = Join-Path $OutputDirectory $ExpectedBundleName
    if ((Get-Sha256 $PublishedBundlePath) -ne $BundleSHA -or (Get-FileSize $PublishedBundlePath) -ne $BundleSize) {
        throw 'Copied publication bundle changed after review.'
    }

    $Receipt = [ordered]@{
        '$schema' = 'prototype-ordax.creator-physical-publication-receipt/1'
        status = if ($Publish) { 'publication-requested' } else { 'signed-ready-for-publication' }
        source_repository = $Repository
        release_tag = $ReleaseTag
        writer_source_commit = $WriterSourceCommit
        canonical_v4_release_source_commit = $ReleaseSourceCommit
        release_sequence = [int64]$Provenance.release_sequence
        bundle = [ordered]@{ name = $ExpectedBundleName; sha256 = $BundleSHA; size = $BundleSize }
        manifest = [ordered]@{ name = $ExpectedManifestName; sha256 = $ManifestSHA; size = (Get-FileSize (Join-Path $OutputDirectory $ExpectedManifestName)) }
        envelope = [ordered]@{ name = $ExpectedEnvelopeName; sha256 = $EnvelopeSHA; size = (Get-FileSize $EnvelopePath) }
        private_key_in_output = $false
        physical_target_selected = $false
        physical_write_performed = $false
        public_stable_promoted = $false
    }
    $ReceiptPath = Join-Path $OutputDirectory 'creator-physical-publication-receipt.json'
    $Receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReceiptPath -Encoding UTF8

    if ($Publish) {
        if ($ConfirmPublication -cne $PublishConfirmation) {
            throw "Publication requires -ConfirmPublication $PublishConfirmation"
        }
        $Gh = Get-Command gh -ErrorAction Stop
        & $Gh.Source auth status
        if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI is not authenticated.' }

        & $Gh.Source release view $ReleaseTag --repo $Repository *> $null
        if ($LASTEXITCODE -eq 0) {
            throw "Release tag $ReleaseTag already exists; automatic replacement is forbidden by this first-publication runbook."
        }
        $global:LASTEXITCODE = 0

        & $Gh.Source release create $ReleaseTag `
            (Join-Path $OutputDirectory $ExpectedBundleName) `
            (Join-Path $OutputDirectory $ExpectedManifestName) `
            (Join-Path $OutputDirectory $ExpectedEnvelopeName) `
            --repo $Repository `
            --target $WriterSourceCommit `
            --title "OrdaX Creator Physical sequence $($Provenance.release_sequence)" `
            --notes "Purpose-bound Portable physical writer for the first real Stable/MVP USB proof. Manifest v3 additionally binds the exact signed 17-artifact payload. This publisher release is not Stable/latest and does not itself select or write a USB target." `
            --prerelease
        if ($LASTEXITCODE -ne 0) { throw 'Publishing creator-physical release failed.' }

        $DownloadDirectory = Join-Path $Temporary 'published-readback'
        [IO.Directory]::CreateDirectory($DownloadDirectory) | Out-Null
        & $Gh.Source release download $ReleaseTag --repo $Repository --dir $DownloadDirectory --pattern $ExpectedBundleName --pattern $ExpectedManifestName --pattern $ExpectedEnvelopeName
        if ($LASTEXITCODE -ne 0) { throw 'Published Creator physical assets could not be downloaded for readback.' }
        foreach ($name in @($ExpectedBundleName, $ExpectedManifestName, $ExpectedEnvelopeName)) {
            $local = Join-Path $OutputDirectory $name
            $remote = Resolve-RealLeaf (Join-Path $DownloadDirectory $name) "Published asset $name"
            if ((Get-Sha256 $local) -ne (Get-Sha256 $remote) -or (Get-FileSize $local) -ne (Get-FileSize $remote)) {
                throw "Published asset readback mismatch: $name"
            }
        }

        $Receipt.status = 'published-readback-verified'
        $Receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReceiptPath -Encoding UTF8
        Write-Host 'CREATOR_PHYSICAL_RELEASE_PUBLISHED=YES'
        Write-Host 'CREATOR_PHYSICAL_RELEASE_READBACK=PASS'
    } else {
        Write-Host 'CREATOR_PHYSICAL_RELEASE_PUBLISHED=NO'
        Write-Host 'READY_FOR_CREATOR_PHYSICAL_PUBLICATION=YES'
    }

    Write-Host "CREATOR_PHYSICAL_RELEASE_TAG=$ReleaseTag"
    Write-Host "WRITER_SOURCE_COMMIT=$WriterSourceCommit"
    Write-Host "CANONICAL_V4_RELEASE_SOURCE_COMMIT=$ReleaseSourceCommit"
    Write-Host "RELEASE_SEQUENCE=$($Provenance.release_sequence)"
    Write-Host "BUNDLE_SHA256=$BundleSHA"
    Write-Host "MANIFEST_SHA256=$ManifestSHA"
    Write-Host "ENVELOPE_SHA256=$EnvelopeSHA"
    Write-Host "PUBLICATION_OUTPUT=$OutputDirectory"
    Write-Host 'PRIVATE_KEY_COPIED_TO_OUTPUT=NO'
    Write-Host 'PHYSICAL_TARGET_SELECTED=NO'
    Write-Host 'PHYSICAL_WRITE_PERFORMED=NO'
    Write-Host 'PUBLIC_STABLE_PROMOTED=NO'
} finally {
    Remove-Item -LiteralPath $Temporary -Recurse -Force -ErrorAction SilentlyContinue
}
