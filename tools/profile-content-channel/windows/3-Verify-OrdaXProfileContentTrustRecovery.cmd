@echo off
setlocal
if "%~1"=="" (
  echo Usage: %~nx0 ^<restored-private-key-path^>
  exit /b 2
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Complete-OrdaXProfileContentTrust.ps1" -RecoveredPrivateKeyPath "%~1"
exit /b %errorlevel%
