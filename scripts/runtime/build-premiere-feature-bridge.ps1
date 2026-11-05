[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sourcePath = Join-Path $repositoryRoot 'apps\mcp-server\native\windows\PremiereFeatureBridge.cs'
$outputDirectory = Join-Path $repositoryRoot 'apps\mcp-server\native\windows\bin'
$outputPath = Join-Path $outputDirectory 'PremiereFeatureBridge.exe'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'

function Get-Sha256([string]$filePath) {
  $stream = [System.IO.File]::OpenRead($filePath)
  try {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
      return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '')
    } finally {
      $algorithm.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
  throw "C# compiler is unavailable: $compiler"
}
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "Native bridge source is unavailable: $sourcePath"
}
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

& $compiler /nologo /target:exe /platform:x64 /optimize+ /reference:System.Web.Extensions.dll "/out:$outputPath" $sourcePath
if ($LASTEXITCODE -ne 0) {
  throw "Premiere feature bridge compilation failed with exit code $LASTEXITCODE"
}
if (-not (Test-Path -LiteralPath $outputPath -PathType Leaf)) {
  throw "Premiere feature bridge output was not produced: $outputPath"
}

$hash = Get-Sha256 $outputPath
$panelSource = Join-Path $repositoryRoot 'apps\mcp-server\native\windows\PremierePanelBridge.cs'
$panelOutput = Join-Path $outputDirectory 'PremierePanelBridge.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ /reference:System.Web.Extensions.dll "/out:$panelOutput" $panelSource
if ($LASTEXITCODE -ne 0) { throw "Premiere panel bridge compilation failed" }
$toolStateSource = Join-Path $repositoryRoot 'apps\mcp-server\native\windows\PremiereToolStateBridge.cs'
$effectScrollSource=Join-Path $repositoryRoot 'apps\mcp-server\native\windows\PremiereEffectScrollBridge.cs'
$effectScrollOutput=Join-Path $outputDirectory 'PremiereEffectScrollBridge.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ /reference:System.Web.Extensions.dll /reference:Accessibility.dll "/out:$effectScrollOutput" $effectScrollSource
if ($LASTEXITCODE -ne 0) { throw 'Effect scroll bridge compilation failed' }
$toolStateOutput = Join-Path $outputDirectory 'PremiereToolStateBridge.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ /reference:System.Web.Extensions.dll /reference:Accessibility.dll "/out:$toolStateOutput" $toolStateSource
if ($LASTEXITCODE -ne 0) { throw "Premiere native tool observer compilation failed" }
$effectStateSource = Join-Path $repositoryRoot 'apps\mcp-server\native\windows\PremiereEffectStateBridge.cs'
$effectStateOutput = Join-Path $outputDirectory 'PremiereEffectStateBridge.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ /reference:System.Web.Extensions.dll /reference:Accessibility.dll "/out:$effectStateOutput" $effectStateSource
if ($LASTEXITCODE -ne 0) { throw "Premiere native effect observer compilation failed" }
$effectSessionSource=Join-Path $repositoryRoot 'apps\mcp-server\native\windows\PremiereEffectSessionBridge.cs'
$effectSessionOutput=Join-Path $outputDirectory 'PremiereEffectSessionBridge.exe'
$parameterStateSource=Join-Path $repositoryRoot 'apps\mcp-server\native\windows\PremiereParameterStateBridge.cs'
$nativeReadTriggerSource=Join-Path $repositoryRoot 'apps\native-read-bridge\NativeReadTrigger.cs'
& $compiler /nologo /target:exe /platform:x64 /optimize+ /main:PremiereEffectSessionBridge /reference:System.Web.Extensions.dll /reference:Accessibility.dll "/out:$effectSessionOutput" $effectSessionSource $effectStateSource $panelSource $effectScrollSource $parameterStateSource $nativeReadTriggerSource
if ($LASTEXITCODE -ne 0) { throw 'Effect session worker compilation failed' }
$effectTreeSource = Join-Path $repositoryRoot 'apps\mcp-server\native\windows\PremiereEffectTreeBridge.cs'
$effectTreeOutput = Join-Path $outputDirectory 'PremiereEffectTreeBridge.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ /reference:System.Web.Extensions.dll /reference:Accessibility.dll "/out:$effectTreeOutput" $effectTreeSource
if ($LASTEXITCODE -ne 0) { throw "Premiere native effect tree observer compilation failed" }
# The unapproved notification adapter is deliberately NOT part of this build.
$maskTrackingSource = Join-Path $repositoryRoot 'apps\mcp-server\native\windows\PremiereMaskTrackingBridge.cs'
$maskTrackingOutput = Join-Path $outputDirectory 'PremiereMaskTrackingBridge.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ /reference:System.Web.Extensions.dll /reference:Accessibility.dll "/out:$maskTrackingOutput" $maskTrackingSource
if ($LASTEXITCODE -ne 0) { throw "Premiere native mask tracking bridge compilation failed" }
$captionStyleSource = Join-Path $repositoryRoot 'apps\mcp-server\native\windows\PremiereCaptionStyleBridge.cs'
$captionStyleOutput = Join-Path $outputDirectory 'PremiereCaptionStyleBridge.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ /reference:System.Web.Extensions.dll /reference:Accessibility.dll "/out:$captionStyleOutput" $captionStyleSource
if ($LASTEXITCODE -ne 0) { throw 'Premiere caption style bridge compilation failed' }
[pscustomobject]@{
  status = 'pass'
  outputPath = $outputPath
  sha256 = $hash
} | ConvertTo-Json -Compress
