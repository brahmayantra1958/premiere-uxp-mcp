@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\connect.ps1"
set "result=%errorlevel%"
pause
exit /b %result%
