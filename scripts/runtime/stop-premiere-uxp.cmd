@echo off
setlocal
for %%I in ("%~dp0\..\..") do set "PREMIERE_UXP_ROOT=%%~fI"
pushd "%PREMIERE_UXP_ROOT%"
node "apps\mcp-server\dist\runtime-cli.js" stop
set "PREMIERE_UXP_EXIT=%ERRORLEVEL%"
popd
exit /b %PREMIERE_UXP_EXIT%
