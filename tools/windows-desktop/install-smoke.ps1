param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [int]$TimeoutSeconds = 120
)
$ErrorActionPreference = "Stop"
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$base = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$dest = Join-Path $base ("ordax-desktop-install-smoke-" + [guid]::NewGuid().ToString("N"))
$proc = $null
$readonlyAclApplied = $false
$readonlyDirectory = $null
$readonlyIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
try {
  if (Test-Path -LiteralPath $dest) { throw "Test destination already exists" }
  $installationStarted = [DateTime]::UtcNow
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
  Write-Output ("INSTALL_DURATION_SECONDS=" + [Math]::Round(([DateTime]::UtcNow - $installationStarted).TotalSeconds, 1))
  Write-Output "INSTALL_SMOKE=PASS"
  Write-Output ("INSTALLED_DESKTOP_EXE=" + $installedExe)
  # In CI the installation destination is writable TEMP, unlike Program Files.
  # Deny writes to the packaged dependency directory so the exact historical
  # Vite .vite-temp EPERM bug is reproduced by this installed-app gate.
  $readonlyDirectory = Join-Path $resources "runtime-template\node_modules"
  & icacls.exe $readonlyDirectory /deny "${readonlyIdentity}:(W)" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Cannot enforce the installed runtime read-only test" }
  $readonlyAclApplied = $true
  $probe = Join-Path $readonlyDirectory (".ordax-probe-" + [guid]::NewGuid().ToString("N"))
  $writeWasBlocked = $false
  try {
    [IO.Directory]::CreateDirectory($probe) | Out-Null
    [IO.Directory]::Delete($probe)
  }
  catch [System.UnauthorizedAccessException] { $writeWasBlocked = $true }
  if (-not $writeWasBlocked) { throw "Installed runtime test lacks write protection" }
  Write-Output "READONLY_RUNTIME_SMOKE=PASS"


  # The installer is not homologated until its actual packaged Electron host
  # boots the canonical Native Surface from the installed, read-only runtime.
  # A source-tree Vite test cannot catch attempts to write inside Program Files.
  $logFile = Join-Path $env:APPDATA "OrdaX OS Desktop Dev\desktop.log"
  $priorLog = if (Test-Path -LiteralPath $logFile) {
    Get-Content -LiteralPath $logFile -Raw -ErrorAction SilentlyContinue
  } else { "" }
  if ($null -eq $priorLog) { $priorLog = "" }
  $startupStarted = [DateTime]::UtcNow
  Write-Output "STARTUP_SMOKE_STARTED"
  $appProc = Start-Process -FilePath $installedExe -WorkingDirectory $dest -PassThru
  try {
    $startupDeadline = [DateTime]::UtcNow.AddSeconds(180)
    $ready = $false
    while ([DateTime]::UtcNow -lt $startupDeadline) {
      $appProc.Refresh()
      if (Test-Path -LiteralPath $logFile) {
        $allLog = Get-Content -LiteralPath $logFile -Raw -ErrorAction SilentlyContinue
        if ($allLog -and $allLog.Length -ge $priorLog.Length) {
          $newLog = $allLog.Substring($priorLog.Length)
          if ($newLog -match "Native shell mounted and ready: http://127\.0\.0\.1:\d+" -and
              $newLog -match "Native Surface ready: http://127\.0\.0\.1:\d+") {
            $ready = $true
            break
          }
          if ($newLog -match "Startup failed:") {
            throw ("Installed Native host failed: " + (($newLog -split "`n") | Select-Object -Last 8 | Out-String))
          }
        }
      }
      if ($appProc.HasExited) {
        throw ("Installed Electron host exited before Native startup (code " + $appProc.ExitCode + ")")
      }
      Start-Sleep -Seconds 1
    }
    if (-not $ready) {
      throw ("Installed Native Surface did not become ready within 180 seconds. Log: " +
        (Get-Content -LiteralPath $logFile -Tail 25 -ErrorAction SilentlyContinue | Out-String))
    }
    # The installed app must serve the actual Desktop capability contract.
    $localUrls = [regex]::Matches($newLog, 'Native Surface ready: (http://127\.0\.0\.1:\d+)')
    if ($localUrls.Count -lt 1) { throw "Native readiness URL missing from log" }
    $baseUrl = $localUrls[$localUrls.Count - 1].Groups[1].Value
    $networkSnapshot = Invoke-RestMethod -Uri ($baseUrl + "/__ordax/native/network-status") -Method GET -TimeoutSec 15
    if ($null -eq $networkSnapshot -or $null -eq $networkSnapshot.interfaces) {
      throw "Installed desktop host does not supply canonical network-status snapshot"
    }
    Write-Output "DESKTOP_NETWORK_STATUS_SMOKE=PASS"
    Write-Output ("STARTUP_DURATION_SECONDS=" + [Math]::Round(([DateTime]::UtcNow - $startupStarted).TotalSeconds, 1))
    Write-Output "STARTUP_SMOKE=PASS"
  }
  finally {
    $appProc.Refresh()
    if (-not $appProc.HasExited) {
      & taskkill.exe /PID $appProc.Id /T /F 2>$null | Out-Null
    }
  }
}
finally {
  if ($readonlyAclApplied -and (Test-Path -LiteralPath $readonlyDirectory)) {
    & icacls.exe $readonlyDirectory /remove:d $readonlyIdentity | Out-Null
  }
  if ($proc -and -not $proc.HasExited) {
    & taskkill.exe /PID $proc.Id /T /F 2>$null | Out-Null
  }
  if (Test-Path -LiteralPath $dest) {
    Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue
  }
}
