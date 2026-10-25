param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [int]$TimeoutSeconds = 120
)
$ErrorActionPreference = "Stop"
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$base = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$dest = Join-Path $base ("ordax desktop upgrade smoke-" + [guid]::NewGuid().ToString("N"))
$proc = $null
$readonlyAclApplied = $false
$readonlyDirectory = $null
$readonlyIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
try {
  if (Test-Path -LiteralPath $dest) { throw "Test destination already exists" }
  $nsisStageLog = Join-Path $env:TEMP "ordax-desktop-dev-installer-stage.log"
  $stageBefore = if (Test-Path -LiteralPath $nsisStageLog) {
    [IO.File]::ReadAllText($nsisStageLog)
  } else { "" }
  $installationStarted = [DateTime]::UtcNow
  Write-Output "INSTALL_SMOKE_STARTED=$installerPath"
  $proc = Start-Process -FilePath $installerPath -ArgumentList ("/S /D=" + $dest) -PassThru
  # NSIS extracts thousands of Native runtime files. A fixed wall-clock bound
  # cannot distinguish a slow but active installation from a stalled one.
  # Keep a finite hard bound, require observable work, and record diagnostics.
  $installMaxSeconds = [Math]::Min(300, [Math]::Max(180, $TimeoutSeconds * 2))
  $deadline = [DateTime]::UtcNow.AddSeconds($installMaxSeconds)
  $lastActivity = [DateTime]::UtcNow
  $lastBytes = -1L
  $lastCpu = -1.0
  $lastStageLength = $stageBefore.Length
  while (-not $proc.HasExited -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Seconds 5
    $proc.Refresh()
    if ($proc.HasExited) { break }
    $workers = @()
    $current = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $proc.Id) -ErrorAction SilentlyContinue
    if ($current) { $workers += $current }
    $workers += @(Get-CimInstance Win32_Process -Filter ("ParentProcessId = " + $proc.Id) -ErrorAction SilentlyContinue)
    $bytes = [long]0
    foreach ($worker in $workers) {
      $bytes += [long]$worker.ReadTransferCount + [long]$worker.WriteTransferCount
    }
    $cpu = [double]$proc.CPU
    $stageLength = $lastStageLength
    try {
      if (Test-Path -LiteralPath $nsisStageLog) {
        $stageLength = [IO.File]::ReadAllText($nsisStageLog).Length
      }
    } catch [System.IO.IOException] {
      # NSIS may own the journal briefly while appending one stage marker.
    }
    if ($bytes -gt $lastBytes -or $cpu -gt $lastCpu -or $stageLength -gt $lastStageLength) {
      $lastActivity = [DateTime]::UtcNow
    }
    $lastBytes = $bytes
    $lastCpu = $cpu
    $lastStageLength = $stageLength
    Write-Output ("INSTALL_PROGRESS_IO_BYTES=" + $bytes + " STAGE_CHARS=" + $stageLength)
    if (([DateTime]::UtcNow - $lastActivity).TotalSeconds -gt 75) {
      throw ("NSIS installation stalled: no CPU, I/O or stage progress for 75 seconds; PID " + $proc.Id)
    }
  }
  if (-not $proc.HasExited) {
    Write-Output ("INSTALL_TIMEOUT_LAST_IO_BYTES=" + $lastBytes + " STAGE_CHARS=" + $lastStageLength)
    throw ("NSIS installation exceeded activity-aware hard limit of " + $installMaxSeconds + " seconds")
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
    (Join-Path $resources "runtime-template\desktop-assets\system\composition\native\index.html"),
    (Join-Path $resources "runtime-template\node_modules\vite\bin\vite.js")
  )
  $required += @(
    (Join-Path $resources "runtime-template\\docs\\contracts\\surface-source.json"),
    (Join-Path $resources "runtime-template\\desktop-assets\\source-provenance.json")
  )
  foreach ($entry in $required) {
    if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) {
      throw ("Packaged Native dependency missing: " + $entry)
    }
  }
  $compiledRoot = Join-Path $resources "runtime-template\\desktop-assets"
  $compiledHtml = Get-Content (Join-Path $compiledRoot "system\\composition\\native\\index.html") -Raw
  if ($compiledHtml -notmatch "/__ordax/desktop-assets/assets/") {
    throw "Installed Desktop did not bundle compiled Native entry"
  }
  $compiledScripts = @(Get-ChildItem (Join-Path $compiledRoot "assets") -Filter "*.js" -File -ErrorAction Stop)
  if ($compiledScripts.Count -lt 1) { throw "Installed Native bundle has no compiled JS" }
  Write-Output "COMPILED_SURFACE_INSTALL_SMOKE=PASS"
  Write-Output ("INSTALL_DURATION_SECONDS=" + [Math]::Round(([DateTime]::UtcNow - $installationStarted).TotalSeconds, 1))
  $stageAfterInstall = if (Test-Path -LiteralPath $nsisStageLog) {
    [IO.File]::ReadAllText($nsisStageLog)
  } else { "" }
  if ($stageAfterInstall.Length -le $stageBefore.Length) {
    throw "NSIS stage journal missing after first install"
  }
  $installStage = $stageAfterInstall.Substring($stageBefore.Length)
  if ($installStage -notmatch "install-files-complete") {
    throw ("NSIS installation stage markers incomplete: " + $installStage)
  }
  Write-Output ("INSTALLER_STAGES=" + ($installStage.Trim() -replace "`r?`n", ","))
  Write-Output "INSTALLER_STAGES_SMOKE=PASS"
  Write-Output "INSTALL_SMOKE=PASS"
  Write-Output ("INSTALLED_DESKTOP_EXE=" + $installedExe)
  # Installer upgrades must be tested, not just first-time installs. A user
  # encountered a six-minute NSIS stall while upgrading alpha.2 in Program Files;
  # this catches repeat-install, target-path-with-spaces, extraction and repair
  # regressions using the package produced by this exact CI run. A prior-version
  # cross-release upgrade still requires its own release fixture and gate.
  $upgradeProc = $null
  try {
    $upgradeStart = [DateTime]::UtcNow
    Write-Output "UPGRADE_SMOKE_STARTED=$dest"
    $upgradeProc = Start-Process -FilePath $installerPath -ArgumentList ("/S /D=" + $dest) -PassThru
    # Upgrades may process an existing 15k-file payload twice. The absolute
    # bound is still finite, but an idle installer fails early. Observe actual
    # I/O and CPU instead of assuming every upgrade takes <= a fresh install.
    $upgradeMaxSeconds = [Math]::Min(300, [Math]::Max(180, $TimeoutSeconds * 2))
    $upgradeDeadline = [DateTime]::UtcNow.AddSeconds($upgradeMaxSeconds)
    $lastActivity = [DateTime]::UtcNow
    $lastBytes = -1L
    $lastCpu = -1.0
    while (-not $upgradeProc.HasExited -and [DateTime]::UtcNow -lt $upgradeDeadline) {
      Start-Sleep -Seconds 5
      $upgradeProc.Refresh()
      if ($upgradeProc.HasExited) { break }
      $all = @()
      $current = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $upgradeProc.Id) -ErrorAction SilentlyContinue
      if ($current) { $all += $current }
      $children = @(Get-CimInstance Win32_Process -Filter ("ParentProcessId = " + $upgradeProc.Id) -ErrorAction SilentlyContinue)
      $all += $children
      $bytes = [long]0
      foreach ($entry in $all) {
        $bytes += [long]$entry.ReadTransferCount + [long]$entry.WriteTransferCount
      }
      $cpu = [double]$upgradeProc.CPU
      if ($bytes -gt $lastBytes -or $cpu -gt $lastCpu) {
        $lastActivity = [DateTime]::UtcNow
      }
      $lastBytes = $bytes
      $lastCpu = $cpu
      Write-Output ("UPGRADE_PROGRESS_IO_BYTES=" + $bytes)
      if (([DateTime]::UtcNow - $lastActivity).TotalSeconds -gt 75) {
        throw ("NSIS upgrade stalled: no CPU or I/O progress for 75 seconds, PID " + $upgradeProc.Id)
      }
    }
    if (-not $upgradeProc.HasExited) {
      throw ("NSIS upgrade exceeded hard limit of " + $upgradeMaxSeconds + " seconds")
    }
    if ($upgradeProc.ExitCode -ne 0) { throw ("NSIS upgrade failed: " + $upgradeProc.ExitCode) }
    foreach ($entry in $required) {
      if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) {
        throw ("Upgrade removed Native runtime file: " + $entry)
      }
    }
    Write-Output ("UPGRADE_DURATION_SECONDS=" + [Math]::Round(([DateTime]::UtcNow - $upgradeStart).TotalSeconds, 1))
    $stageAfterUpgrade = if (Test-Path -LiteralPath $nsisStageLog) {
      [IO.File]::ReadAllText($nsisStageLog)
    } else { "" }
    $upgradeStage = if ($stageAfterUpgrade.Length -ge $stageAfterInstall.Length) {
      $stageAfterUpgrade.Substring($stageAfterInstall.Length)
    } else { "" }
    # The previous version's NSIS uninstaller and the new installer may
    # both write their lifecycle entries into the same diagnostic file.
    # A length-based suffix is not a transactional audit log across them.
    # Do not turn a valid zero-exit-code + verified-files upgrade into a
    # false failure merely because the diagnostic log was truncated/rotated.
    Write-Output ("UPGRADE_STAGES_DIAGNOSTIC=" + ($upgradeStage.Trim() -replace "`r?`n", ","))
    if ($stageAfterUpgrade -match "install-files-complete") {
      Write-Output "UPGRADE_STAGES_OBSERVED=YES"
    } else {
      Write-Output "UPGRADE_STAGES_OBSERVED=NO"
    }
    Write-Output "UPGRADE_SMOKE=PASS"
  } finally {
    if ($upgradeProc -and -not $upgradeProc.HasExited) {
      & taskkill.exe /PID $upgradeProc.Id /T /F 2>$null | Out-Null
    }
  }
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
  # The exact installed toolchain must compile a second OS/Surface SHA without
  # mutating its protected node_modules (historical .vite-temp EPERM defect).
  $priorTemplate = $env:ORDAX_DESKTOP_TEST_PACKAGED_TEMPLATE
  try {
    $env:ORDAX_DESKTOP_TEST_PACKAGED_TEMPLATE = Join-Path $resources "runtime-template"
    & node --test "tools/windows-desktop/dev-update-real-build.test.cjs"
    if ($LASTEXITCODE -ne 0) {
      throw "Installed, read-only Windows Dev update Vite toolchain failed"
    }
    Write-Output "INSTALLED_READONLY_DEV_UPDATE_SMOKE=PASS"
  } finally {
    $env:ORDAX_DESKTOP_TEST_PACKAGED_TEMPLATE = $priorTemplate
  }

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
  $previousBrowserSmoke = $env:ORDAX_DESKTOP_BROWSER_SMOKE
  $previousFileSmoke = $env:ORDAX_DESKTOP_FILE_SMOKE
  try {
    $env:ORDAX_DESKTOP_BROWSER_SMOKE = "1"
    $env:ORDAX_DESKTOP_FILE_SMOKE = "1"
    $appProc = Start-Process -FilePath $installedExe -WorkingDirectory $dest -PassThru
  } finally {
    $env:ORDAX_DESKTOP_BROWSER_SMOKE = $previousBrowserSmoke
    $env:ORDAX_DESKTOP_FILE_SMOKE = $previousFileSmoke
  }
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
              $newLog -match "Native Surface ready: http://127\.0\.0\.1:\d+" -and
              $newLog -match "DESKTOP_INTERNET_SMOKE=PASS" -and
              $newLog -match "DESKTOP_FILE_SPACE_SMOKE=PASS") {
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
      # A missing log is itself a boot-contract failure. Fail early rather than
      # waiting three minutes for a readiness marker written somewhere else.
      if ([DateTime]::UtcNow -gt $startupStarted.AddSeconds(45)) {
        $freshLog = if (Test-Path -LiteralPath $logFile) {
          Get-Content -LiteralPath $logFile -Raw -ErrorAction SilentlyContinue
        } else { "" }
        if (-not $freshLog -or $freshLog.Length -le $priorLog.Length) {
          throw ("Installed Electron did not open the canonical Desktop log within 45s: " + $logFile)
        }
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
    $updateSnapshot = Invoke-RestMethod -Uri ($baseUrl + "/__ordax/native/update") -Method GET -TimeoutSec 15
    if (-not $updateSnapshot.sourceSha -or -not $updateSnapshot.status -or
        -not $updateSnapshot.phase -or $null -eq $updateSnapshot.deliveryNumber) {
      throw "Installed Desktop did not publish the canonical update-status contract"
    }
    if ($updateSnapshot.sourceSha -eq "bundled-desktop" -and $updateSnapshot.status -eq "applied") {
      throw "Bundled Desktop was incorrectly marked as an applied main update"
    }
    $updateHistory = Invoke-RestMethod -Uri ($baseUrl + "/__ordax/native/update-history") -Method GET -TimeoutSec 15
    if ($null -eq $updateHistory.releases -or $null -eq $updateHistory.applications) {
      throw "Installed Desktop did not publish canonical update history"
    }
    Write-Output "DESKTOP_UPDATE_STATUS_SMOKE=PASS"
    $metricsSnapshot = Invoke-RestMethod -Uri ($baseUrl + "/__ordax/native/metrics") -Method GET -TimeoutSec 15
    if ($metricsSnapshot.memoryTotalBytes -le 0 -or
        $metricsSnapshot.memoryAvailableBytes -gt $metricsSnapshot.memoryTotalBytes -or
        $metricsSnapshot.userStorageTotalBytes -le 0 -or
        $metricsSnapshot.userStorageFreeBytes -gt $metricsSnapshot.userStorageTotalBytes) {
      throw "Desktop Native host does not report actual canonical system metrics"
    }
    Write-Output "DESKTOP_SYSTEM_METRICS_SMOKE=PASS"
    $powerSnapshot = Invoke-RestMethod -Uri ($baseUrl + "/__ordax/native/power-status") -Method GET -TimeoutSec 15
    if ($null -eq $powerSnapshot -or
        "battery" -notin $powerSnapshot.PSObject.Properties.Name -or
        "externalPower" -notin $powerSnapshot.PSObject.Properties.Name) {
      throw "Installed Desktop does not publish actual Windows power status"
    }
    Write-Output "DESKTOP_POWER_STATUS_SMOKE=PASS"
    # Localhost callers without the Electron-granted 256-bit capability must
    # never read profile files, even if they know the ephemeral TCP port.
    $withoutHostGrant = Invoke-WebRequest -Uri ($baseUrl + "/__ordax/native/files?path=%2F") -Method GET -TimeoutSec 15 -SkipHttpErrorCheck
    if ($withoutHostGrant.StatusCode -ne 401) {
      throw "Unauthenticated local process could read private OrdaX files"
    }
    Write-Output "DESKTOP_FILE_AUTHORIZATION_SMOKE=PASS"
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
