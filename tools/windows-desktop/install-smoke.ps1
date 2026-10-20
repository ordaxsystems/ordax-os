param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [int]$TimeoutSeconds = 120
)
$ErrorActionPreference = "Stop"
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$base = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$dest = Join-Path $base ("ordax-desktop-install-smoke-" + [guid]::NewGuid().ToString("N"))
$proc = $null
try {
  if (Test-Path -LiteralPath $dest) { throw "Test destination already exists" }
  Write-Output "INSTALL_SMOKE_STARTED=$installerPath"
  $proc = Start-Process -FilePath $installerPath -ArgumentList ("/S /D=" + $dest) -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while (-not $proc.HasExited -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $proc.Refresh()
  }
  if (-not $proc.HasExited) {
    throw "Installer did not terminate within bounded installation gate"
  }
  if ($proc.ExitCode -ne 0) {
    throw ("NSIS installation failed with exit code " + $proc.ExitCode)
  }
  $installedExe = Join-Path $dest "OrdaX OS Desktop Dev.exe"
  $resources = Join-Path $dest "resources"
  $required = @(
    $installedExe,
    (Join-Path $resources "app.asar"),
    (Join-Path $resources "runtime-template\tools\windows-emulator\dev-supervisor.mjs"),
    (Join-Path $resources "runtime-template\tools\windows-emulator\desktop-host-contract.json"),
    (Join-Path $resources "runtime-template\system\composition\native\index.html"),
    (Join-Path $resources "runtime-template\node_modules\vite\bin\vite.js")
  )
  foreach ($entry in $required) {
    if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) {
      throw ("Packaged Native dependency missing: " + $entry)
    }
  }
  Write-Output "INSTALL_SMOKE=PASS"
  Write-Output ("INSTALLED_DESKTOP_EXE=" + $installedExe)
}
finally {
  if ($proc -and -not $proc.HasExited) {
    & taskkill.exe /PID $proc.Id /T /F 2>$null | Out-Null
  }
  if (Test-Path -LiteralPath $dest) {
    Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue
  }
}
