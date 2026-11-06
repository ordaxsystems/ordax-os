# CI-only offline proof, with a disposable identity and simulated provenance.
# This fixture never becomes an official operator-eligible handoff.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sandbox = Join-Path $env:RUNNER_TEMP ("ordax-ci-disposable-trust-" + [Guid]::NewGuid().ToString('N'))
$toolkit = Join-Path $sandbox 'toolkit'
$identity = Join-Path $sandbox 'identity'
$review = Join-Path $sandbox 'review'
$verifier = Join-Path $toolkit 'ordax-runtime-component-channel.exe'
$init = Join-Path $toolkit 'Initialize-OrdaXComponentTrust.ps1'
$finalize = Join-Path $toolkit 'Complete-OrdaXComponentTrust.ps1'
$original = Join-Path $identity 'disposable-private.pem'
$recovered = Join-Path $identity 'recovered-disposable-private.pem'
$encrypted = Join-Path $identity 'encrypted-disposable-private.bin'
$provenancePath = Join-Path $toolkit 'provenance.json'

try {
    New-Item -ItemType Directory -Path $toolkit, $identity -Force | Out-Null
    foreach ($name in @('Initialize-OrdaXComponentTrust.ps1', 'Complete-OrdaXComponentTrust.ps1')) {
        Copy-Item -LiteralPath (Join-Path $repoRoot "tools/runtime-component-channel/windows/$name") -Destination (Join-Path $toolkit $name)
    }
    Copy-Item -LiteralPath (Join-Path $repoRoot 'docs/COMPONENT-TRUST-CEREMONY.md') -Destination (Join-Path $toolkit 'COMPONENT-TRUST-CEREMONY.md')
    Copy-Item -LiteralPath (Join-Path $repoRoot 'docs/contracts/runtime-component-trust-policy.json') -Destination (Join-Path $toolkit 'component-trust-policy.json')
    Push-Location (Join-Path $repoRoot 'tools/runtime-component-channel')
    try {
        & go build -trimpath -buildvcs=false -o $verifier .
        if ($LASTEXITCODE -ne 0) { throw 'Canonical Go component verifier build failed' }
    } finally { Pop-Location }

    function SHA([string]$file) {
        return (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant()
    }
    # Simulated main/push receipt ONLY for an ephemeral PR regression;
    # official toolkit provenance is generated separately by real main push.
    $fixture = [ordered]@{
        '$schema' = 'prototype-ordax.component-trust-toolkit/1'
        status = 'candidate'
        source_commit = $env:GITHUB_SHA
        source_repository = 'ordaxsystems/ordax-os'
        source_ref = 'refs/heads/main'
        source_event = 'push'
        canonical_component_trust_ceremony_eligible = $true
        policy_sha256 = SHA (Join-Path $toolkit 'component-trust-policy.json')
        ceremony_doc_sha256 = SHA (Join-Path $toolkit 'COMPONENT-TRUST-CEREMONY.md')
        components = @{
            component_signer = @{ sha256 = SHA $verifier }
            trust_initializer = @{ sha256 = SHA $init }
            trust_recovery_finalizer = @{ sha256 = SHA $finalize }
        }
    }
    [IO.File]::WriteAllText($provenancePath, ($fixture | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
    & pwsh -NoProfile -File $init -PreflightOnly -PrivateKeyPath $original -ReviewDirectory $review -ToolkitProvenancePath $provenancePath | Out-Host
    if ($LASTEXITCODE -ne 0 -or (Test-Path $original) -or (Test-Path $review)) { throw 'Read-only preflight failed' }

    & pwsh -NoProfile -File $init -GenerateKey -PrivateKeyPath $original -ReviewDirectory $review -ToolkitProvenancePath $provenancePath | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Disposable canonical trust initialization failed' }
    $initial = Get-Content (Join-Path $review 'ceremony-result.json') -Raw | ConvertFrom-Json
    if ($initial.proof_signature_verified -ne $true -or $initial.ready_to_pin_public_anchor -ne $false) { throw 'Initialization proof missing or incorrectly authorized' }
    $proof = Get-Content (Join-Path $review 'component-trust-proof-release.json') -Raw | ConvertFrom-Json
    if ($proof.component.id -cne 'local-ai-service' -or $proof.component.release_mode -cne 'bundled' -or $proof.source_repository -cne 'ordaxsystems/ordax-os' -or $proof.source_commit -cne $env:GITHUB_SHA) {
        throw 'Proof is not the exact canonical OS-owned descriptor'
    }

    # Legacy OS/internet descriptor must fail with the original root cause.
    $obsolete = Join-Path $sandbox 'obsolete-internet-release.json'
    $obsoleteOut = Join-Path $sandbox 'obsolete-internet-envelope.json'
    $obsoleteErr = Join-Path $sandbox 'obsolete-internet-stderr.txt'
    $proof.component.id = 'internet'
    $proof.component.release_mode = 'component-slot'
    $proof.package.name = 'internet.zip'
    [IO.File]::WriteAllText($obsolete, ($proof | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    $arguments = @('sign','--release',$obsolete,'--private-key',$original,'--trust',(Join-Path $review 'runtime-components-ed25519.json'),'--key-id','ordax-runtime-components-v1','--out',$obsoleteOut)
    $negative = Start-Process -FilePath $verifier -Wait -PassThru -NoNewWindow -RedirectStandardError $obsoleteErr -ArgumentList $arguments
    if ($negative.ExitCode -eq 0 -or (Test-Path $obsoleteOut) -or (Get-Content $obsoleteErr -Raw) -notmatch 'source repository is not canonical') {
        throw 'Obsolete internet/OS proof was not rejected'
    }

    # Encrypted DPAPI backup and restore on this single ephemeral runner.
    # Operators must separately prove an independent offline recovery.
    $plain = [IO.File]::ReadAllBytes($original)
    try {
        $cipher = [Security.Cryptography.ProtectedData]::Protect($plain, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        [IO.File]::WriteAllBytes($encrypted, $cipher)
        $restored = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($encrypted), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        try { [IO.File]::WriteAllBytes($recovered, $restored) }
        finally { [Array]::Clear($restored, 0, $restored.Length) }
    } finally { [Array]::Clear($plain, 0, $plain.Length) }
    if ((SHA $original) -cne (SHA $recovered) -or (SHA $original) -ceq (SHA $encrypted)) { throw 'Encrypted recovery of disposable key failed' }

    & pwsh -NoProfile -File $finalize -RecoveredPrivateKeyPath $recovered -PrimaryPrivateKeyPath $original -ReviewDirectory $review -ToolkitProvenancePath $provenancePath | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Disposable recovered signing proof failed' }
    $handoff = Join-Path $review 'OrdaX-Component-Public-Trust-Handoff.zip'
    if (-not (Test-Path $handoff)) { throw 'Public-only handoff missing' }
    & python (Join-Path $repoRoot 'tools/runtime-component-channel/promote_public_trust.py') check --repo-root $repoRoot --promotion-zip $handoff --verifier $verifier | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Canonical public handoff promotion check failed' }
    Write-Host 'CI_DISPOSABLE_TRUST_INITIALIZATION=PASS'
    Write-Host 'CI_DISPOSABLE_ENCRYPTED_RECOVERY=PASS'
    Write-Host 'CI_PUBLIC_HANDOFF_PROMOTION_CHECK=PASS'
    Write-Host 'PRODUCTION_IDENTITY_CREATED=NO'
    Write-Host 'OFFICIAL_TOOLKIT_PROVENANCE_USED=NO'
    Write-Host 'TRUST_ANCHOR_PINNED=NO'
    Write-Host 'PRIVATE_KEY_EXPORTED=NO'
} finally {
    Remove-Item -LiteralPath $sandbox -Recurse -Force -ErrorAction SilentlyContinue
}
