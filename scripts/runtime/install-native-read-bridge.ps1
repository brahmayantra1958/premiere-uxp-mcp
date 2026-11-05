param([Alias('Approved')][switch]$Apply, [switch]$LocalBuild, [string]$PremiereRoot, [string]$PayloadDirectory, [string]$NodeExe)
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if(-not $PayloadDirectory){$PayloadDirectory=Join-Path $repo 'artifacts/native-release/win-x64'}
if(-not $NodeExe){
 $command=Get-Command node.exe -ErrorAction SilentlyContinue
 if($command){$NodeExe=$command.Source}else{
  $distribution=Get-Content -LiteralPath (Join-Path $repo 'installer/distributions.json') -Raw | ConvertFrom-Json
  $NodeExe=Join-Path $repo ('artifacts/tools/node/node-v'+$distribution.version+'-win-x64/node.exe')
 }
}
if(-not(Test-Path -LiteralPath $NodeExe)){throw 'Run Setup first or pass -NodeExe with an installed Node.js executable'}
. (Join-Path $PSScriptRoot 'premiere-installation.ps1')
$premiere=Resolve-PremiereInstallation $PremiereRoot
# Both SDK plugins share a versioned configuration. Install the matching pair.
# Read-only unless -Apply; no host shutdown, Control Surface registration or
# security-policy change is performed. See docs/native-addons.md.
$arguments=@((Join-Path $repo 'installer/native-addons.mjs'),'--root',$repo,'--payload',$PayloadDirectory,'--premiere-root',$premiere)
if($Apply){$arguments+='--apply'}
if($LocalBuild){$arguments+='--local-build'}
& $NodeExe @arguments
if($LASTEXITCODE -ne 0){throw 'Native add-on preparation/installation failed; see the reported reason'}
