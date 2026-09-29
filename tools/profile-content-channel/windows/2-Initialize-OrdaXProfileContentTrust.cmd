@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Initialize-OrdaXProfileContentTrust.ps1" -GenerateKey
exit /b %ERRORLEVEL%
