[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$CandidateRoot,

    [Parameter(Mandatory = $true)]
    [string]$ExpectedCurrentWriterCommit,

    [string]$PrivateKeyPath = '',
    [string]$OutputDirectory = '',
    [switch]$Publish,
    [string]$ConfirmRotation = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repository = 'ordaxsystems/ordax-os'
$ReleaseTag = 'creator-physical'
$RotationConfirmation = 'ROTATE_CREATOR_PHYSICAL_RELEASE'
$BundleName = 'ordax-creator-physical-windows-amd64.zip'
$ManifestName = 'creator-physical-manifest.json'
$EnvelopeName = 'creator-physical-envelope.json'
$Hex40 = '^[0-9a-f]{40}$'
$Hex64 = '^[0-9a-f]{64}$'

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
    return [int64](Get-Item -LiteralPath $Path -Force).Length
}

function Assert-LowerHex40([string]$Value, [string]$Label) {
    if ($Value -cne $Value.ToLowerInvariant() -or $Value -notmatch $Hex40) {
        throw "$Label must be exact lowercase 40-hex: $Value"
    }
}

function Assert-LowerHex64([string]$Value, [string]$Label) {
    if ($Value -cne $Value.ToLowerInvariant() -or $Value -notmatch $Hex64) {
        throw "$Label must be exact lowercase 64-hex: $Value"
    }
}

function Get-ReleaseState([string]$Tag) {
    $raw = & $script:Gh.Source api "repos/$Repository/releases/tags/$Tag"
    if ($LASTEXITCODE -ne 0) {
        throw "Cannot read GitHub release $Tag."
    }
    return ($raw | ConvertFrom-Json)
}

function Test-ReleaseExists([string]$Tag) {
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $diagnostic = & $script:Gh.Source api "repos/$Repository/releases/tags/$Tag" --silent 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }

    if ($exitCode -eq 0) {
        return $true
    }

    $diagnosticText = [string]($diagnostic | Out-String)
    if ($diagnosticText -match '(?i)HTTP\s+404') {
        $global:LASTEXITCODE = 0
        return $false
    }

    throw "Cannot determine whether GitHub release $Tag exists (gh exit $exitCode): $($diagnosticText.Trim())"
}

function Assert-ReleaseAssets(
    [object]$Release,
    [string]$Directory,
    [string]$Label
) {
    $expected = @($BundleName, $ManifestName, $EnvelopeName)
    if (@($Release.assets).Count -ne $expected.Count) {
        throw "$Label must contain exactly the three canonical publisher assets."
    }
    $seen = @{}
    foreach ($asset in @($Release.assets)) {
        $name = [string]$asset.name
        if ($expected -notcontains $name -or $seen.ContainsKey($name)) {
            throw "$Label contains an unexpected or duplicate asset: $name"
        }
        $seen[$name] = $true
        $local = Resolve-RealLeaf (Join-Path $Directory $name) "$Label asset $name"
        $localSha = Get-Sha256 $local
        $localSize = Get-FileSize $local
        if ([int64]$asset.size -ne $localSize) {
            throw "$Label size differs from GitHub metadata for $name"
        }
        $digest = [string]$asset.digest
        if ([string]::IsNullOrWhiteSpace($digest) -or -not $digest.StartsWith('sha256:', [StringComparison]::Ordinal)) {
            throw "$Label is missing a GitHub SHA-256 digest for $name"
        }
        $remoteSha = $digest.Substring(7).ToLowerInvariant()
        Assert-LowerHex64 $remoteSha "$Label GitHub digest for $name"
        if ($remoteSha -ne $localSha) {
            throw "$Label digest differs from downloaded bytes for $name"
        }
    }
}

function Assert-DirectoryEqual([string]$Left, [string]$Right, [string]$Label) {
    foreach ($name in @($BundleName, $ManifestName, $EnvelopeName)) {
        $a = Resolve-RealLeaf (Join-Path $Left $name) "$Label source $name"
        $b = Resolve-RealLeaf (Join-Path $Right $name) "$Label readback $name"
        if ((Get-FileSize $a) -ne (Get-FileSize $b) -or (Get-Sha256 $a) -ne (Get-Sha256 $b)) {
            throw "$Label readback mismatch for $name"
        }
    }
}

function Download-ReleaseAssets([string]$Tag, [string]$Directory) {
    if (Test-Path -LiteralPath $Directory) {
        throw "Download directory already exists: $Directory"
    }
    [IO.Directory]::CreateDirectory($Directory) | Out-Null
    & $script:Gh.Source release download $Tag `
        --repo $Repository `
        --dir $Directory `
        --pattern $BundleName `
        --pattern $ManifestName `
        --pattern $EnvelopeName
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to download canonical assets for $Tag."
    }
}

function Restore-PreviousRelease(
    [string]$PreviousDirectory,
    [string]$PreviousWriterCommit,
    [string]$TemporaryRoot
) {
    Write-Warning 'Rotation failed after the active alias changed; attempting byte-exact rollback.'
    if (Test-ReleaseExists $ReleaseTag) {
        & $script:Gh.Source release delete $ReleaseTag --repo $Repository --cleanup-tag --yes
        if ($LASTEXITCODE -ne 0) {
            throw 'Rollback could not remove the partial creator-physical release.'
        }
    }

    & $script:Gh.Source release create $ReleaseTag `
        (Join-Path $PreviousDirectory $BundleName) `
        (Join-Path $PreviousDirectory $ManifestName) `
        (Join-Path $PreviousDirectory $EnvelopeName) `
        --repo $Repository `
        --target $PreviousWriterCommit `
        --title 'OrdaX Creator Physical sequence 1 (restored)' `
        --notes 'Automatic rollback restored the previous byte-identical creator-physical publisher release after a failed controlled rotation.' `
        --prerelease
    if ($LASTEXITCODE -ne 0) {
        throw 'Rollback could not recreate the previous creator-physical release.'
    }

    $rollbackReadback = Join-Path $TemporaryRoot 'rollback-readback'
    Download-ReleaseAssets $ReleaseTag $rollbackReadback
    Assert-DirectoryEqual $PreviousDirectory $rollbackReadback 'Rollback'
    Write-Host 'CREATOR_PHYSICAL_ROTATION_ROLLBACK=PASS'
}

Assert-LowerHex40 $ExpectedCurrentWriterCommit 'Expected current writer commit'
$ScriptDirectory = [IO.Path]::GetFullPath($PSScriptRoot)
$RepoRoot = [IO.Path]::GetFullPath((Join-Path $ScriptDirectory '..\..\..'))
$CandidateRoot = Resolve-RealDirectory $CandidateRoot 'Candidate root'
$SigningRunbook = Resolve-RealLeaf (Join-Path $RepoRoot 'tools\release-signing\windows\8-Sign-Publish-CreatorPhysical.ps1') 'Creator physical signing runbook'
$CandidateProvenancePath = Resolve-RealLeaf (Join-Path $CandidateRoot 'physical-write-candidate\provenance.json') 'Candidate provenance'
$CandidateProvenance = Get-Content -LiteralPath $CandidateProvenancePath -Raw -Encoding UTF8 | ConvertFrom-Json
$NewWriterCommit = [string]$CandidateProvenance.writer_source_commit
Assert-LowerHex40 $NewWriterCommit 'New writer source commit'
if ($NewWriterCommit -eq $ExpectedCurrentWriterCommit) {
    throw 'Rotation requires a new writer commit distinct from the currently published writer.'
}
if ([string]$CandidateProvenance.status -ne 'authorized-candidate-not-published') {
    throw 'New candidate is not in authorized pre-publication state.'
}
if ($CandidateProvenance.physical_write_authorized_in_binary -ne $true -or $CandidateProvenance.private_key_in_candidate -ne $false) {
    throw 'New candidate authorization/private-key invariants are invalid.'
}
if ($CandidateProvenance.whole_disk_raw_image_required -ne $false -or [int]$CandidateProvenance.portable_artifact_count -ne 17 -or [int]$CandidateProvenance.portable_application_operation_count -ne 39) {
    throw 'New candidate Portable v2 invariants are invalid.'
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $CandidateRoot ("creator-physical-rotation-" + $NewWriterCommit.Substring(0, 12))
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $OutputDirectory) {
    throw "Rotation output already exists; overwrite is forbidden: $OutputDirectory"
}

$signArgs = @{
    CandidateRoot = $CandidateRoot
    OutputDirectory = $OutputDirectory
}
if (-not [string]::IsNullOrWhiteSpace($PrivateKeyPath)) {
    $signArgs['PrivateKeyPath'] = $PrivateKeyPath
}
& $SigningRunbook @signArgs
if ($LASTEXITCODE -ne 0) {
    throw 'Signing the replacement creator-physical candidate failed.'
}

$NewBundle = Resolve-RealLeaf (Join-Path $OutputDirectory $BundleName) 'Signed replacement bundle'
$NewManifestPath = Resolve-RealLeaf (Join-Path $OutputDirectory $ManifestName) 'Signed replacement manifest'
$NewEnvelope = Resolve-RealLeaf (Join-Path $OutputDirectory $EnvelopeName) 'Signed replacement envelope'
$NewManifest = Get-Content -LiteralPath $NewManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]$NewManifest.source_commit -ne $NewWriterCommit) {
    throw 'Signed replacement manifest is not bound to the new writer commit.'
}
if ([string]$NewManifest.bundle.sha256 -ne (Get-Sha256 $NewBundle) -or [int64]$NewManifest.bundle.size -ne (Get-FileSize $NewBundle)) {
    throw 'Signed replacement bundle does not match its manifest.'
}

$script:Gh = Get-Command gh -ErrorAction Stop
& $script:Gh.Source auth status
if ($LASTEXITCODE -ne 0) {
    throw 'GitHub CLI is not authenticated.'
}

$Temporary = Join-Path ([IO.Path]::GetTempPath()) ("ordax-creator-physical-rotation-" + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($Temporary) | Out-Null
try {
    $PreviousDirectory = Join-Path $Temporary 'previous-live'
    $PreviousRelease = Get-ReleaseState $ReleaseTag
    if ([string]$PreviousRelease.tag_name -ne $ReleaseTag -or $PreviousRelease.prerelease -ne $true) {
        throw 'Current creator-physical release identity is incompatible with controlled rotation.'
    }
    if ([string]$PreviousRelease.target_commitish -ne $ExpectedCurrentWriterCommit) {
        throw "Current creator-physical target differs from the explicitly expected writer commit: $($PreviousRelease.target_commitish)"
    }
    Download-ReleaseAssets $ReleaseTag $PreviousDirectory
    Assert-ReleaseAssets $PreviousRelease $PreviousDirectory 'Current creator-physical release'

    $PreviousManifestPath = Resolve-RealLeaf (Join-Path $PreviousDirectory $ManifestName) 'Previous manifest'
    $PreviousManifest = Get-Content -LiteralPath $PreviousManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]$PreviousManifest.source_commit -ne $ExpectedCurrentWriterCommit) {
        throw 'Previous signed manifest source commit differs from the explicitly expected current writer.'
    }
    $PreviousBundle = Resolve-RealLeaf (Join-Path $PreviousDirectory $BundleName) 'Previous bundle'
    if ([string]$PreviousManifest.bundle.sha256 -ne (Get-Sha256 $PreviousBundle) -or [int64]$PreviousManifest.bundle.size -ne (Get-FileSize $PreviousBundle)) {
        throw 'Previous creator-physical bundle does not match its signed manifest binding.'
    }

    $ArchiveTag = "creator-physical-archive-$ExpectedCurrentWriterCommit"
    if (Test-ReleaseExists $ArchiveTag) {
        throw "Archive release already exists; refusing ambiguous rotation: $ArchiveTag"
    }

    $Receipt = [ordered]@{
        '$schema' = 'prototype-ordax.creator-physical-rotation-receipt/1'
        status = if ($Publish) { 'rotation-requested' } else { 'rotation-ready-not-published' }
        source_repository = $Repository
        active_release_tag = $ReleaseTag
        archive_release_tag = $ArchiveTag
        previous_writer_source_commit = $ExpectedCurrentWriterCommit
        replacement_writer_source_commit = $NewWriterCommit
        previous_assets = @(
            [ordered]@{ name = $BundleName; sha256 = Get-Sha256 (Join-Path $PreviousDirectory $BundleName); size = Get-FileSize (Join-Path $PreviousDirectory $BundleName) },
            [ordered]@{ name = $ManifestName; sha256 = Get-Sha256 (Join-Path $PreviousDirectory $ManifestName); size = Get-FileSize (Join-Path $PreviousDirectory $ManifestName) },
            [ordered]@{ name = $EnvelopeName; sha256 = Get-Sha256 (Join-Path $PreviousDirectory $EnvelopeName); size = Get-FileSize (Join-Path $PreviousDirectory $EnvelopeName) }
        )
        replacement_assets = @(
            [ordered]@{ name = $BundleName; sha256 = Get-Sha256 $NewBundle; size = Get-FileSize $NewBundle },
            [ordered]@{ name = $ManifestName; sha256 = Get-Sha256 $NewManifestPath; size = Get-FileSize $NewManifestPath },
            [ordered]@{ name = $EnvelopeName; sha256 = Get-Sha256 $NewEnvelope; size = Get-FileSize $NewEnvelope }
        )
        previous_release_archived = $false
        replacement_release_readback_verified = $false
        rollback_performed = $false
        private_key_in_output = $false
        physical_target_selected = $false
        physical_write_performed = $false
        public_stable_promoted = $false
    }
    $ReceiptPath = Join-Path $OutputDirectory 'creator-physical-rotation-receipt.json'
    $Receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReceiptPath -Encoding UTF8

    if (-not $Publish) {
        Write-Host 'CREATOR_PHYSICAL_ROTATION_PUBLISHED=NO'
        Write-Host 'READY_FOR_CREATOR_PHYSICAL_ROTATION=YES'
        Write-Host "CURRENT_WRITER_SOURCE_COMMIT=$ExpectedCurrentWriterCommit"
        Write-Host "REPLACEMENT_WRITER_SOURCE_COMMIT=$NewWriterCommit"
        Write-Host "ARCHIVE_RELEASE_TAG=$ArchiveTag"
        Write-Host 'PHYSICAL_TARGET_SELECTED=NO'
        Write-Host 'PHYSICAL_WRITE_PERFORMED=NO'
        return
    }

    if ($ConfirmRotation -cne $RotationConfirmation) {
        throw "Rotation requires -ConfirmRotation $RotationConfirmation"
    }

    # Preserve the old signed bytes under an immutable archival tag before the active alias changes.
    & $script:Gh.Source release create $ArchiveTag `
        (Join-Path $PreviousDirectory $BundleName) `
        (Join-Path $PreviousDirectory $ManifestName) `
        (Join-Path $PreviousDirectory $EnvelopeName) `
        --repo $Repository `
        --target $ExpectedCurrentWriterCommit `
        --title "OrdaX Creator Physical archive $($ExpectedCurrentWriterCommit.Substring(0, 12))" `
        --notes 'Byte-exact archive of the previously active creator-physical publisher release, preserved before controlled rotation. This archive is evidence only and is not the active publisher channel.' `
        --prerelease
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not create the immutable archive release; active alias was not changed.'
    }

    $ArchiveReadback = Join-Path $Temporary 'archive-readback'
    Download-ReleaseAssets $ArchiveTag $ArchiveReadback
    Assert-DirectoryEqual $PreviousDirectory $ArchiveReadback 'Archive'
    $Receipt.previous_release_archived = $true
    $Receipt.status = 'archive-readback-verified'
    $Receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReceiptPath -Encoding UTF8

    # Re-check that the live alias did not change while the archive was being created.
    $CurrentAgain = Get-ReleaseState $ReleaseTag
    if ([int64]$CurrentAgain.id -ne [int64]$PreviousRelease.id -or [string]$CurrentAgain.target_commitish -ne $ExpectedCurrentWriterCommit) {
        throw 'Active creator-physical release changed during rotation preflight; alias was not modified.'
    }
    Assert-ReleaseAssets $CurrentAgain $PreviousDirectory 'Revalidated creator-physical release'

    $AliasChanged = $false
    try {
        & $script:Gh.Source release delete $ReleaseTag --repo $Repository --cleanup-tag --yes
        if ($LASTEXITCODE -ne 0) {
            throw 'Could not remove the superseded active creator-physical alias.'
        }
        $AliasChanged = $true

        & $script:Gh.Source release create $ReleaseTag `
            $NewBundle `
            $NewManifestPath `
            $NewEnvelope `
            --repo $Repository `
            --target $NewWriterCommit `
            --title "OrdaX Creator Physical sequence $($CandidateProvenance.release_sequence)" `
            --notes "Controlled rotation to authorized writer $NewWriterCommit. The previous signed bytes are preserved at $ArchiveTag. This publisher release does not select or write a USB target." `
            --prerelease
        if ($LASTEXITCODE -ne 0) {
            throw 'Could not create the replacement creator-physical release.'
        }

        $NewReadback = Join-Path $Temporary 'replacement-readback'
        Download-ReleaseAssets $ReleaseTag $NewReadback
        Assert-DirectoryEqual $OutputDirectory $NewReadback 'Replacement release'
        $NewRelease = Get-ReleaseState $ReleaseTag
        if ([string]$NewRelease.target_commitish -ne $NewWriterCommit) {
            throw 'Replacement creator-physical release target commit is incorrect.'
        }
        Assert-ReleaseAssets $NewRelease $NewReadback 'Replacement creator-physical release'

        $Receipt.replacement_release_readback_verified = $true
        $Receipt.status = 'rotation-published-readback-verified'
        $Receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReceiptPath -Encoding UTF8
        Write-Host 'CREATOR_PHYSICAL_ROTATION_PUBLISHED=YES'
        Write-Host 'CREATOR_PHYSICAL_ROTATION_READBACK=PASS'
        Write-Host "PREVIOUS_WRITER_ARCHIVE_TAG=$ArchiveTag"
        Write-Host "WRITER_SOURCE_COMMIT=$NewWriterCommit"
        Write-Host 'PHYSICAL_TARGET_SELECTED=NO'
        Write-Host 'PHYSICAL_WRITE_PERFORMED=NO'
        Write-Host 'PUBLIC_STABLE_PROMOTED=NO'
    } catch {
        if ($AliasChanged) {
            try {
                Restore-PreviousRelease $PreviousDirectory $ExpectedCurrentWriterCommit $Temporary
                $Receipt.rollback_performed = $true
                $Receipt.status = 'rotation-failed-previous-release-restored'
                $Receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReceiptPath -Encoding UTF8
            } catch {
                $Receipt.status = 'rotation-failed-rollback-unproven'
                $Receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReceiptPath -Encoding UTF8
                throw
            }
        }
        throw
    }
} finally {
    Remove-Item -LiteralPath $Temporary -Recurse -Force -ErrorAction SilentlyContinue
}
