param([switch]$Apply)
$PrepareOnly = -not $Apply
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$sourceRoot = Join-Path $repositoryRoot 'apps\cep-project-selection'
$extensionId = 'ai.brahma.yantra.project-selection'
$extensionsRoot = [IO.Path]::GetFullPath((Join-Path $env:APPDATA 'Adobe\CEP\extensions'))
$destination = [IO.Path]::GetFullPath((Join-Path $extensionsRoot $extensionId))
$deploymentRoot = Join-Path $repositoryRoot 'artifacts\cep-project-selection-deployment'
$runRoot = Join-Path $deploymentRoot ([Guid]::NewGuid().ToString())
$staging = Join-Path $runRoot 'unsigned'
$verified = Join-Path $runRoot 'verified'
$backup = Join-Path $runRoot 'previous-installation'
$utf8 = New-Object Text.UTF8Encoding($false)
function Assert-Child([string]$Candidate, [string]$Parent) {
  if (-not [IO.Path]::GetFullPath($Candidate).StartsWith([IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Path escaped declared root: $Candidate" }
}
Assert-Child $destination $extensionsRoot
foreach ($candidate in @($runRoot,$staging,$verified,$backup)) { Assert-Child $candidate $deploymentRoot }
$connectionPath = Join-Path $repositoryRoot 'artifacts\runtime\project-selection-connection.json'
$token = $null
if (Test-Path -LiteralPath $connectionPath) { $token = (Get-Content -LiteralPath $connectionPath -Raw | ConvertFrom-Json).token }
if (-not $token) {
  $randomBytes = New-Object byte[] 32
  $random = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $random.GetBytes($randomBytes) } finally { $random.Dispose() }
  $token = ([BitConverter]::ToString($randomBytes)).Replace('-','').ToLowerInvariant()
}
if ($token -notmatch '^[a-f0-9]{64}$') { throw 'Invalid local credential' }
$config = [ordered]@{ port=8097; token=$token; version='0.1.1' }
$clientConfig = [ordered]@{ port=8097; token=$token; extensionId=$extensionId; installation=$destination; repositoryRoot=$repositoryRoot }
New-Item -ItemType Directory -Path $staging -Force | Out-Null
foreach ($relative in @('CSXS\manifest.xml','host\selection.jsx','index.html','client.js','service.cjs')) {
  $target = Join-Path $staging $relative
  New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $sourceRoot $relative) -Destination $target
}
$hostPath = Join-Path $staging 'host\selection.jsx'
$hostCode = (Get-Content -LiteralPath $hostPath -Raw -Encoding UTF8)
[IO.File]::WriteAllText($hostPath,$hostCode,$utf8)
[IO.File]::WriteAllText((Join-Path $staging 'config.js'),('window.BrahmaYantraProjectSelectionConfig = ' + ($clientConfig | ConvertTo-Json -Compress) + ';'),$utf8)
$signer = Join-Path $repositoryRoot 'artifacts\tools\ZXPSignCmd-4.1.3\ZXPSignCmd.exe'
if (-not (Test-Path -LiteralPath $signer -PathType Leaf)) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $signer) -Force | Out-Null
  Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/ZXPSignCMD/4.1.3/x64/ZXPSignCmd.exe' -OutFile $signer
}
if ((Get-FileHash -LiteralPath $signer -Algorithm SHA256).Hash -ne 'FFC2223167225CE61D024EB463FC5AD1A1BE16133F99EF334A646F7311916C98') { throw 'Adobe signer hash mismatch' }
$certificate = Join-Path $runRoot 'ephemeral.p12'
$package = Join-Path $runRoot ($extensionId + '.zxp')
$password = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
function Invoke-Signer([string[]]$Arguments) {
  $output = & $signer @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw ('Signing failed: ' + (($output -join [Environment]::NewLine).Replace($password,'[redacted]'))) }
  return $output -join [Environment]::NewLine
}
try {
  Invoke-Signer @('-selfSignedCert','KR','Seoul','Local Premiere Tools','Local project selection helper',$password,$certificate,'-validityDays','3650') | Out-Null
  Invoke-Signer @('-sign',$staging,$package,$certificate,$password) | Out-Null
  $packageVerification = Invoke-Signer @('-verify',$package)
} finally {
  if (Test-Path -LiteralPath $certificate) { Remove-Item -LiteralPath $certificate -Force }
  $password = $null
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($package)
try { foreach ($entry in $archive.Entries) { Assert-Child (Join-Path $verified $entry.FullName) $verified } } finally { $archive.Dispose() }
[IO.Compression.ZipFile]::ExtractToDirectory($package,$verified)
$directoryVerification = Invoke-Signer @('-verify',$verified)
if (-not $PrepareOnly) {
  New-Item -ItemType Directory -Path $extensionsRoot -Force | Out-Null
  $newDestinationTouched = $false
  try {
    # Both recursive move endpoints are resolved and bounded above.
    if (Test-Path -LiteralPath $destination) { Move-Item -LiteralPath $destination -Destination $backup }
    $newDestinationTouched = $true
    Move-Item -LiteralPath $verified -Destination $destination
    $directoryVerification = Invoke-Signer @('-verify',$destination)
    [IO.File]::WriteAllText($connectionPath,($config | ConvertTo-Json),$utf8)
  } catch {
    $failed = Join-Path $runRoot 'failed-installation'
    Assert-Child $failed $deploymentRoot
    if ($newDestinationTouched -and (Test-Path -LiteralPath $destination)) { Move-Item -LiteralPath $destination -Destination $failed }
    if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $destination }
    throw
  }
}
$receipt = [ordered]@{ status=$(if ($PrepareOnly) {'prepared'} else {'installed'}); extensionId=$extensionId; version='0.1.1'; destination=$destination; packagePath=$package; packageSha256=(Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash; packageVerification=$packageVerification; directoryVerification=$directoryVerification; registryChanged=$false; privateKeyRetained=$false; port=8097; nativeSelectionVerification='UNVERIFIED' }
$json = $receipt | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $runRoot 'deployment.json'),$json,$utf8)
$json
