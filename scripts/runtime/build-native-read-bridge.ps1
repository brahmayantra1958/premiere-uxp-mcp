param([string]$SdkRoot=(Join-Path $PSScriptRoot '../../artifacts/sdk/premiere-26.0/Premiere Pro 26.0 C++ SDK'), [string]$OutputDirectory)
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$headers=Join-Path (Resolve-Path -LiteralPath $SdkRoot).Path 'Examples/Headers'
if(-not(Test-Path -LiteralPath (Join-Path $headers 'PrSDKExportController.h'))){throw 'Adobe Windows C++ SDK headers are required'}
$vswhere=(Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe')
$vs=(& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath).Trim()
$vc=Get-ChildItem -LiteralPath (Join-Path $vs 'VC/Tools/MSVC') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$kits=(Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10')
$win=Get-ChildItem -LiteralPath "$kits/Include" -Directory | Where-Object {Test-Path -LiteralPath (Join-Path $_.FullName 'um/Windows.h')} | Sort-Object Name -Descending | Select-Object -First 1
if(-not $vc -or -not $win){throw 'MSVC and Windows SDK are required'}
$output=if($OutputDirectory){[IO.Path]::GetFullPath($OutputDirectory)}else{Join-Path $repo 'artifacts/native-read-build'}
if(-not $output.StartsWith($repo+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Build output must remain inside this checkout'}
New-Item -ItemType Directory -Path $output -Force | Out-Null
$compiler=Join-Path $vc.FullName 'bin/Hostx64/x64/cl.exe'
$previousInclude=$env:INCLUDE
$previousLib=$env:LIB
try{
 $env:INCLUDE=(@((Join-Path $vc.FullName 'include'),"$($win.FullName)/ucrt","$($win.FullName)/shared","$($win.FullName)/um","$($win.FullName)/winrt")-join ';')
 $env:LIB=(@((Join-Path $vc.FullName 'lib/x64'),"$kits/Lib/$($win.Name)/ucrt/x64","$kits/Lib/$($win.Name)/um/x64")-join ';')
 $shared=@('/nologo','/std:c++17','/utf-8','/EHsc','/O2','/W4','/MT',"/I$headers",('/I'+(Join-Path $repo 'apps/native-read-bridge')),("/Fo"+$output.Replace('\','/')+'/'))
 $test=Join-Path $output 'native-read-request-test.exe'
 & $compiler @shared (Join-Path $repo 'tests/native/native-read-request.cpp') "/Fe$test" '/link' '/DYNAMICBASE' '/NXCOMPAT'
 if($LASTEXITCODE -ne 0){throw 'Native read request test build failed'}
 & $test
 if($LASTEXITCODE -ne 0){throw 'Native read request validation failed'}
 $settingsTest=Join-Path $output 'native-runtime-config-test.exe'
 & $compiler @shared (Join-Path $repo 'tests/native/native-runtime-config.cpp') "/Fe$settingsTest" '/link' '/DYNAMICBASE' '/NXCOMPAT'
 if($LASTEXITCODE -ne 0){throw 'Native runtime configuration test build failed'}
 & $settingsTest
 if($LASTEXITCODE -ne 0){throw 'Native runtime configuration validation failed'}
 $artifactPath=Join-Path $output 'PremiereMcpNativeRead.prm'
 & $compiler @shared '/LD' '/D_WINDOWS' '/D_WINDLL' (Join-Path $repo 'apps/native-read-bridge/NativeReadBridge.cpp') "/Fe$artifactPath" '/link' 'shell32.lib' 'ole32.lib' 'uuid.lib' '/DYNAMICBASE' '/NXCOMPAT'
 if($LASTEXITCODE -ne 0){throw 'Native read bridge build failed'}
 $trigger=Join-Path $output 'PremiereNativeReadTrigger.exe'
 & (Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe') '/nologo' '/target:exe' '/platform:x64' '/optimize+' '/reference:System.Web.Extensions.dll' "/out:$trigger" (Join-Path $repo 'apps/native-read-bridge/NativeReadTrigger.cs')
 if($LASTEXITCODE -ne 0){throw 'Native read trigger build failed'}
 $artifact=Get-Item -LiteralPath $artifactPath
 $receipt=@{artifact=$artifact.Name;bytes=$artifact.Length;sha256=(Get-FileHash -LiteralPath $artifact.FullName -Algorithm SHA256).Hash;requestTests='pass';configurationTests='pass';configurationProtocol=1;portable=$true;installed=$false}
 $receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'native-read-build.json') -Encoding utf8
 $receipt | ConvertTo-Json
}finally{$env:INCLUDE=$previousInclude;$env:LIB=$previousLib}
