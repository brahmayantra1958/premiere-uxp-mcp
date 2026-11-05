@echo off
setlocal
for %%I in ("%~dp0\..\..") do set "PREMIERE_UXP_ROOT=%%~fI"
pushd "%PREMIERE_UXP_ROOT%"
if not exist "apps\mcp-server\dist\runtime-cli.js" (
  call npm run build -w @premiere-uxp/mcp-server
  if errorlevel 1 goto :failed
)
node "apps\mcp-server\dist\runtime-cli.js" ready --timeout-ms 90000 %*
if errorlevel 1 goto :failed
echo.
echo Premiere UXP is ready and will remain connected in the background.
popd
exit /b 0

:failed
echo.
echo Premiere UXP could not become ready. Review the message above.
pause
popd
exit /b 1
