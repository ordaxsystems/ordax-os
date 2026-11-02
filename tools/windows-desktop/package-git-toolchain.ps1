param([string]$Archive = "")
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$lock = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'git-toolchain-lock.json') -Raw | ConvertFrom-Json
if ($lock.schema -ne 'ordax.windows-min-git-lock/1' -or
    $lock.version -notmatch '^\d+\.\d+\.\d+\.\d+$' -or
    $lock.sha256 -notmatch '^[0-9a-f]{64}$' -or
    $lock.archive -notmatch '^MinGit-[0-9.]+-64-bit\.zip$') {
  throw 'Invalid canonical MinGit source lock'
}
$pieces = $lock.version.Split('.')
$expectedArchive = "MinGit-$($lock.version)-64-bit.zip"
$expectedUrl = "https://github.com/git-for-windows/git/releases/download/v$($pieces[0]).$($pieces[1]).$($pieces[2]).windows.$($pieces[3])/$expectedArchive"
if ($lock.archive -cne $expectedArchive -or $lock.url -cne $expectedUrl) {
  throw 'Untrusted Git-for-Windows URL or archive'
}
$out = Join-Path $root 'out/windows-desktop-toolchain'
$dest = Join-Path $out 'git'
$receiptFile = Join-Path $out 'git-receipt.json'
if ((Test-Path -LiteralPath $dest) -or (Test-Path -LiteralPath $receiptFile)) {
  throw 'Bundled Git output already exists; refuse overwrite'
}
New-Item -ItemType Directory -Path $out -Force | Out-Null
$downloaded = $false
$archiveFile = $Archive
if (-not $archiveFile) {
  $archiveFile = Join-Path $out $lock.archive
  if (Test-Path -LiteralPath $archiveFile) {throw 'Untrusted existing Git archive'}
  & curl.exe --fail --location --silent --show-error --connect-timeout 12 --max-time 180 --output $archiveFile $lock.url
  if ($LASTEXITCODE -ne 0) {throw 'Canonical MinGit download failed'}
  $downloaded = $true
}
try {
  $actualHash = (Get-FileHash -LiteralPath $archiveFile -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -cne $lock.sha256) {throw 'Canonical MinGit archive digest mismatch'}
  Expand-Archive -LiteralPath $archiveFile -DestinationPath $dest -ErrorAction Stop
  $exe = Join-Path $dest 'cmd/git.exe'
  $core = Join-Path $dest 'ucrt64/bin/git.exe'
  foreach ($file in @($exe,$core)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      throw ('Canonical MinGit executable missing: ' + $file)
    }
    $stat = Get-Item -LiteralPath $file -Force
    if (($stat.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'Bundled Git executable cannot be a link'
    }
  }
  if ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant() -cne $lock.git_exe_sha256 -or
      (Get-FileHash -LiteralPath $core -Algorithm SHA256).Hash.ToLowerInvariant() -cne $lock.core_exe_sha256) {
    throw 'Bundled MinGit executables disagree with source lock'
  }
  $versionOutput = & $exe --version
  if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch ('git version ' + [regex]::Escape($pieces[0]+'.'+$pieces[1]+'.'+$pieces[2]+'.windows.'+$pieces[3]))) {
    throw ('Bundled MinGit version mismatch: ' + $versionOutput)
  }
  $receipt = [ordered]@{
    schema = 'ordax.windows-min-git-receipt/1'
    version = $lock.version
    archive_sha256 = $lock.sha256
    git_exe_sha256 = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
    core_exe_sha256 = (Get-FileHash -LiteralPath $core -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes(($receipt | ConvertTo-Json -Compress) + [Environment]::NewLine)
  [System.IO.File]::WriteAllBytes($receiptFile, $bytes)
  Write-Output ('ORDAX_BUNDLED_GIT_VERIFIED=' + $versionOutput)
  Write-Output ('ORDAX_BUNDLED_GIT_ARCHIVE_SHA256=' + $actualHash)
} catch {
  if (Test-Path -LiteralPath $dest) {Remove-Item -LiteralPath $dest -Recurse -Force}
  if (Test-Path -LiteralPath $receiptFile) {Remove-Item -LiteralPath $receiptFile -Force}
  throw
} finally {
  if ($downloaded -and (Test-Path -LiteralPath $archiveFile)) {
    Remove-Item -LiteralPath $archiveFile -Force
  }
}
