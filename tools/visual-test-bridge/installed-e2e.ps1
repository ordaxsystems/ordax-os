param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$ExpectedSourceSha
)
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows') {
  throw 'Installed Electron E2E must run on an isolated GitHub-hosted Windows runner'
}
if($ExpectedSourceSha -cnotmatch '^[0-9a-f]{40}$') {throw 'Invalid source commitment'}
$installerPath=(Resolve-Path -LiteralPath $Installer).Path
$root=Join-Path $env:RUNNER_TEMP ('ordax-visual-installed-'+[guid]::NewGuid().ToString('N'))
$install=Join-Path $root 'installation'
$artifacts=Join-Path $env:GITHUB_WORKSPACE 'out/visual-test-bridge/installed'
New-Item -ItemType Directory -Force -Path $root,$artifacts | Out-Null
$exe=Join-Path $install 'OrdaX OS Desktop Dev.exe'
$proc=$null
try {
  $proc=Start-Process -FilePath $installerPath -ArgumentList ("/S /D="+$install) -PassThru
  if(-not $proc.WaitForExit(300000)) {
    throw 'Installed Electron smoke installer exceeded 300-second bound'
  }
  if($proc.ExitCode -ne 0) {throw "NSIS test installation failed with code $($proc.ExitCode)"}
  if(-not (Test-Path -LiteralPath $exe -PathType Leaf)) {throw 'Installed Electron exe is missing'}
  $native=Join-Path $install 'resources/runtime-template/desktop-assets/source-provenance.json'
  if(-not (Test-Path -LiteralPath $native)) {throw 'Missing installed source-provenance receipt'}
  $receipt=Get-Content -LiteralPath $native -Raw | ConvertFrom-Json
  if($receipt.os_sha -cne $ExpectedSourceSha) {throw "Downloaded installed bundle source mismatch"}
  $hash=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
  $evidence=[ordered]@{schema='ordax.visual-installed-input/1';source_sha=$ExpectedSourceSha;
    installer_name=[IO.Path]::GetFileName($installerPath);
    installed_exe_sha256=$hash;run_id=$env:ORDAX_VISUAL_SOURCE_RUN_ID}
  $evidence | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $artifacts 'installed-provenance.json')
  $env:ORDAX_VISUAL_ISOLATED_SESSION='1'
  $env:ORDAX_VISUAL_INSTALLED_EXE=$exe
  $env:ORDAX_VISUAL_ARTIFACTS=$artifacts
  node tools/visual-test-bridge/installed-e2e.cjs
  if($LASTEXITCODE -ne 0) {throw "Installed visual bridge E2E failed: $LASTEXITCODE"}
} finally {
  if($proc -and -not $proc.HasExited) { $proc.Kill();$proc.WaitForExit() }
  # Installed app child must be stopped by Playwright before directory cleanup.
  if(Test-Path -LiteralPath $root) {
    for($attempt=0;$attempt -lt 12;$attempt++){
      try{Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction Stop;break}
      catch{if($attempt -eq 11){Write-Warning "Bounded installer cleanup failed: $($_.Exception.Message)"}else{Start-Sleep -Seconds 1}}
    }
  }
}
