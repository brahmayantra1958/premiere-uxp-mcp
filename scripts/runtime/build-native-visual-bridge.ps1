param([string]$SdkRoot=(Join-Path $PSScriptRoot '../../artifacts/sdk/premiere-26.0/Premiere Pro 26.0 C++ SDK'), [string]$OutputDirectory)
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$sdk=(Resolve-Path -LiteralPath $SdkRoot).Path
$headers=Join-Path $sdk 'Examples/Headers'
$required=Join-Path $headers 'adobesdk/controlsurface/host/ControlSurfaceHostCommandSuite.h'
if(-not(Test-Path -LiteralPath $required)){throw 'The actual Adobe Windows C++ SDK headers are required'}
$vswhere=(Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe')
$vs=(& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath).Trim()
$vc=Get-ChildItem -LiteralPath (Join-Path $vs 'VC/Tools/MSVC') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$kits=(Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10')
$win=Get-ChildItem -LiteralPath "$kits/Include" -Directory | Where-Object {Test-Path -LiteralPath (Join-Path $_.FullName 'um/Windows.h')} | Sort-Object Name -Descending | Select-Object -First 1
if(-not $vc -or -not $win){throw 'MSVC and Windows SDK are required'}
$output=if($OutputDirectory){[IO.Path]::GetFullPath($OutputDirectory)}else{Join-Path $repo 'artifacts/native-visual-build'}
if(-not $output.StartsWith($repo+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Build output must remain inside this checkout'}
New-Item -ItemType Directory -Path $output -Force | Out-Null
$compiler=Join-Path $vc.FullName 'bin/Hostx64/x64/cl.exe'
$previousInclude=$env:INCLUDE
$previousLib=$env:LIB
try{
 $env:INCLUDE=(@((Join-Path $vc.FullName 'include'),"$($win.FullName)/ucrt","$($win.FullName)/shared","$($win.FullName)/um","$($win.FullName)/winrt")-join ';')
 $env:LIB=(@((Join-Path $vc.FullName 'lib/x64'),"$kits/Lib/$($win.Name)/ucrt/x64","$kits/Lib/$($win.Name)/um/x64")-join ';')
 $arguments=@('/nologo','/std:c++17','/utf-8','/EHsc','/O2','/W4','/MT','/LD','/D_WINDOWS','/D_WINDLL',"/I$headers",("/Fo"+$output.Replace('\','/')+'/'),("/Fe"+(Join-Path $output 'PremiereMcpNativeVisual.acsrf')),(Join-Path $repo 'apps/native-visual-bridge/NativeVisualBridge.cpp'),(Join-Path $headers 'adobesdk/controlsurface/plugin/wrapper/ControlSurfaceBase.cpp'),'/link','advapi32.lib','user32.lib','oleacc.lib','oleaut32.lib','uuid.lib','shell32.lib','ole32.lib','/DYNAMICBASE','/NXCOMPAT')
 # Registering the SDK command interface is required for a host command ref.
 $linkIndex=[Array]::IndexOf($arguments,'/link')
 $arguments=@($arguments[0..($linkIndex-1)])+@((Join-Path $headers 'adobesdk/controlsurface/plugin/wrapper/ControlSurfaceCommandBase.cpp'))+@($arguments[$linkIndex..($arguments.Length-1)])
 & $compiler @arguments
 if($LASTEXITCODE -ne 0){throw 'Native visual bridge build failed'}
 $artifact=Get-Item -LiteralPath (Join-Path $output 'PremiereMcpNativeVisual.acsrf')
 $receipt=@{artifact=$artifact.Name;bytes=$artifact.Length;sha256=(Get-FileHash -LiteralPath $artifact.FullName -Algorithm SHA256).Hash;configurationProtocol=1;pluginId='ai.brahma.yantra.native-visual';pipePrefix='Brahma.Yantra.NativeVisual.v1.';portable=$true;installed=$false}
 $receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'native-visual-build.json') -Encoding utf8
 $receipt | ConvertTo-Json
}finally{$env:INCLUDE=$previousInclude;$env:LIB=$previousLib}
