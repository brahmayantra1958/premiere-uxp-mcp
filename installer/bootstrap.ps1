param(
  [switch]$PrepareOnly,
  [ValidateSet('codex','claude','gemini','both','none')][string]$Client,
  [switch]$NonInteractive,
  [switch]$NoConnect,
  [switch]$Connect,
  [switch]$ReplaceClient,
  [switch]$ReplaceSkills,
  [string]$ClientConfig,
  [string]$SkillsTarget,
  [string]$NativeAddons,
  [switch]$Help
)
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'This Windows installer requires x64 Windows.' }
$distributions = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'distributions.json') -Raw | ConvertFrom-Json
$distribution = $distributions.'win-x64'
$toolsDirectory = Join-Path $repository 'artifacts/tools/node'
$archive = Join-Path $toolsDirectory $distribution.file
$node = Join-Path $toolsDirectory ('node-v' + $distributions.version + '-win-x64/node.exe')
New-Item -ItemType Directory -Path $toolsDirectory -Force | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (-not (Test-Path -LiteralPath $archive)) {
  Invoke-WebRequest -UseBasicParsing -Uri ('https://nodejs.org/dist/v' + $distributions.version + '/' + $distribution.file) -OutFile ($archive + '.download')
  if ((Get-FileHash -LiteralPath ($archive + '.download') -Algorithm SHA256).Hash -ne $distribution.sha256) { throw 'Node archive checksum mismatch' }
  Move-Item -LiteralPath ($archive + '.download') -Destination $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $distribution.sha256) { throw 'Node archive checksum mismatch' }
if (-not (Test-Path -LiteralPath $node)) { Expand-Archive -LiteralPath $archive -DestinationPath $toolsDirectory }
$arguments = @((Join-Path $PSScriptRoot 'install.mjs'))
if ($PrepareOnly) { $arguments += '--prepare-only' }
if ($Client) { $arguments += @('--client', $Client) }
if ($NonInteractive) { $arguments += '--non-interactive' }
if ($NoConnect) { $arguments += '--no-connect' }
if ($Connect) { $arguments += '--connect' }
if ($ReplaceClient) { $arguments += '--replace-client' }
if ($ReplaceSkills) { $arguments += '--replace-skills' }
if ($ClientConfig) { $arguments += @('--client-config', $ClientConfig) }
if ($SkillsTarget) { $arguments += @('--skills-target', $SkillsTarget) }
if ($NativeAddons) { $arguments += @('--native-addons', $NativeAddons) }
if ($Help) { $arguments += '--help' }
& $node @arguments
if ($LASTEXITCODE -ne 0) { throw "Installer failed (exit $LASTEXITCODE)" }
