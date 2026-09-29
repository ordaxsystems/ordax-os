@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Initialize-OrdaXProfileContentTrust.ps1" -GenerateKey
exit /b %errorlevel%
