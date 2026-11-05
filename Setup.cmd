@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\bootstrap.ps1" %*
set "result=%errorlevel%"
if not "%result%"=="0" echo Setup failed. Read the error above before retrying.
pause
exit /b %result%
