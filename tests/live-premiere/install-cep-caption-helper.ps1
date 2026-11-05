param(
  [string]$SourceRoot = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) "apps\cep-caption-helper"),
  [string]$ExtensionsRoot = (Join-Path $env:APPDATA "Adobe\CEP\extensions"),
  [switch]$PrepareOnly,
  # Compatibility: signed installation never changes PlayerDebugMode.
  [switch]$SkipPlayerDebugMode
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$extensionId = "ai.brahma.yantra.caption-helper"
$sourceRoot = [IO.Path]::GetFullPath($SourceRoot)
$repositoryRoot = [IO.Path]::GetFullPath((Split-Path -Parent (Split-Path -Parent $sourceRoot)))
$scratchRoot = Join-Path $repositoryRoot "artifacts\scratch"
$extensionsRoot = [IO.Path]::GetFullPath($ExtensionsRoot)
$destination = [IO.Path]::GetFullPath((Join-Path $extensionsRoot $extensionId))
$deploymentRoot = Join-Path $repositoryRoot "artifacts\cep-deployment"
function Assert-ChildPath([string]$Candidate, [string]$Parent) {
  $resolved = [IO.Path]::GetFullPath($Candidate)
  $prefix = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Path escaped its declared root: $resolved"
  }
}
Assert-ChildPath $destination $extensionsRoot
$required = @("CSXS\manifest.xml", ".debug", "index.html", "client.js", "host\caption.jsx")
foreach ($relativePath in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot $relativePath) -PathType Leaf)) {
    throw "Missing CEP helper source file: $relativePath"
  }
}
[xml]$manifest = Get-Content -LiteralPath (Join-Path $sourceRoot "CSXS\manifest.xml") -Encoding UTF8 -Raw
[xml](Get-Content -LiteralPath (Join-Path $sourceRoot ".debug") -Encoding UTF8 -Raw) | Out-Null
$helperVersion = [string]$manifest.ExtensionManifest.ExtensionBundleVersion
if (-not $helperVersion -or $manifest.ExtensionManifest.ExtensionBundleId -ne $extensionId) {
  throw "Unexpected caption helper identity"
}
$clientSource = Get-Content -LiteralPath (Join-Path $sourceRoot "client.js") -Encoding UTF8 -Raw
$hostSource = Get-Content -LiteralPath (Join-Path $sourceRoot "host\caption.jsx") -Encoding UTF8 -Raw
if (-not $clientSource.Contains("__PREMIERE_MCP_REPOSITORY_ROOT__") -or
    -not $clientSource.Contains("__PREMIERE_MCP_CEP_VERSION__") -or
    -not $hostSource.Contains("__PREMIERE_MCP_SCRATCH_ROOT__")) {
  throw "CEP helper source is missing a required deployment token"
}
# Official Adobe Windows signer; pin bytes before executing a cached/downloaded tool.
$signToolPath = Join-Path $repositoryRoot "artifacts\tools\ZXPSignCmd-4.1.3\ZXPSignCmd.exe"
$signToolSha256 = "FFC2223167225CE61D024EB463FC5AD1A1BE16133F99EF334A646F7311916C98"
$signToolUrl = "https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/ZXPSignCMD/4.1.3/x64/ZXPSignCmd.exe"
if (-not (Test-Path -LiteralPath $signToolPath -PathType Leaf)) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $signToolPath) -Force | Out-Null
  Invoke-WebRequest -UseBasicParsing -Uri $signToolUrl -OutFile $signToolPath
}
if ((Get-FileHash -LiteralPath $signToolPath -Algorithm SHA256).Hash -ne $signToolSha256) {
  throw "ZXPSignCmd SHA256 mismatch; refusing to execute"
}
$runRoot = Join-Path $deploymentRoot ([Guid]::NewGuid().ToString())
$staging = Join-Path $runRoot "unsigned"
$extracted = Join-Path $runRoot "verified"
$packagePath = Join-Path $runRoot ($extensionId + ".zxp")
$certificatePath = Join-Path $runRoot "ephemeral-signing.p12"
$backupPath = Join-Path $runRoot "previous-installation"
foreach ($candidate in @($runRoot, $staging, $extracted, $backupPath)) { Assert-ChildPath $candidate $deploymentRoot }
New-Item -ItemType Directory -Path $staging -Force | Out-Null
foreach ($relativePath in $required) {
  $targetFile = Join-Path $staging $relativePath
  New-Item -ItemType Directory -Path (Split-Path -Parent $targetFile) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $sourceRoot $relativePath) -Destination $targetFile
}
function ConvertTo-JavaScriptStringContent([string]$Value) {
  return $Value.Replace('\', '\\').Replace('"', '\"')
}
$deployedClient = $clientSource.Replace("__PREMIERE_MCP_REPOSITORY_ROOT__", (ConvertTo-JavaScriptStringContent $repositoryRoot)).Replace("__PREMIERE_MCP_CEP_VERSION__", $helperVersion)
$deployedHost = $hostSource.Replace("__PREMIERE_MCP_SCRATCH_ROOT__", (ConvertTo-JavaScriptStringContent $scratchRoot))
$utf8NoBom = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $staging "client.js"), $deployedClient, $utf8NoBom)
[IO.File]::WriteAllText((Join-Path $staging "host\caption.jsx"), $deployedHost, $utf8NoBom)
if ($deployedClient.Contains("__PREMIERE_MCP_") -or $deployedHost.Contains("__PREMIERE_MCP_")) { throw "Unresolved deployment token" }
# Path injection precedes signing. This ephemeral local identity is not an Adobe publisher identity.
$certificatePassword = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
function Invoke-Signer([string[]]$SignerArguments) {
  $output = & $signToolPath @SignerArguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    $safeOutput = $output -join [Environment]::NewLine
    if ($certificatePassword) { $safeOutput = $safeOutput.Replace($certificatePassword, "[redacted]") }
    throw ("ZXPSignCmd failed: " + $safeOutput)
  }
  return ($output -join [Environment]::NewLine)
}
try {
  Invoke-Signer @('-selfSignedCert', 'KR', 'Seoul', 'Local Premiere Tools', 'Local caption helper', $certificatePassword, $certificatePath, '-validityDays', '3650') | Out-Null
  Invoke-Signer @('-sign', $staging, $packagePath, $certificatePath, $certificatePassword) | Out-Null
  $packageVerification = Invoke-Signer @('-verify', $packagePath)
} finally {
  if (Test-Path -LiteralPath $certificatePath) { Remove-Item -LiteralPath $certificatePath -Force }
  $certificatePassword = $null
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($packagePath)
try {
  foreach ($entry in $archive.Entries) { Assert-ChildPath (Join-Path $extracted $entry.FullName) $extracted }
} finally { $archive.Dispose() }
[IO.Compression.ZipFile]::ExtractToDirectory($packagePath, $extracted)
if (-not (Test-Path -LiteralPath (Join-Path $extracted "META-INF\signatures.xml"))) { throw "Missing package signature" }
$directoryVerification = Invoke-Signer @('-verify', $extracted)
$installed = $false
if (-not $PrepareOnly) {
  New-Item -ItemType Directory -Path $extensionsRoot -Force | Out-Null
  $newDestinationTouched = $false
  try {
    # Both recursive move endpoints are resolved and bounded above.
    if (Test-Path -LiteralPath $destination) { Move-Item -LiteralPath $destination -Destination $backupPath }
    $newDestinationTouched = $true
    Move-Item -LiteralPath $extracted -Destination $destination
    $directoryVerification = Invoke-Signer @('-verify', $destination)
    $installed = $true
  } catch {
    $failedPath = Join-Path $runRoot "failed-installation"
    Assert-ChildPath $failedPath $deploymentRoot
    if ($newDestinationTouched -and (Test-Path -LiteralPath $destination)) { Move-Item -LiteralPath $destination -Destination $failedPath }
    if (Test-Path -LiteralPath $backupPath) { Move-Item -LiteralPath $backupPath -Destination $destination }
    throw
  }
}
$result = [ordered]@{
  status = $(if ($installed) { 'installed' } else { 'prepared' })
  extensionId = $extensionId
  version = $helperVersion
  repositoryRoot = $repositoryRoot
  scratchRoot = $scratchRoot
  destination = $destination
  packagePath = $packagePath
  verifiedDirectory = $(if ($installed) { $destination } else { $extracted })
  backupPath = $(if (Test-Path -LiteralPath $backupPath) { $backupPath } else { $null })
  signingToolSha256 = $signToolSha256
  packageSha256 = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash
  packageVerification = $packageVerification
  directoryVerification = $directoryVerification
  privateKeyRetained = $false
  registryChanged = $false
  liveHelperVerified = $false
  requiresHostReload = $installed
}
$json = $result | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $runRoot "deployment.json"), $json, $utf8NoBom)
$json
