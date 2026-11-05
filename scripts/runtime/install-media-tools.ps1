param()
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$destination = Join-Path $repository 'artifacts/tools/ffmpeg'
$download = Join-Path $repository 'artifacts/tools/downloads'
New-Item -ItemType Directory -Path $destination,$download -Force | Out-Null
# Provider linked by https://ffmpeg.org/download.html. Verify the archive before
# extraction; do not change machine PATH or require an elevated installer.
$url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
$archive = Join-Path $download 'ffmpeg-release-essentials.zip'
$checksumFile = Join-Path $download 'ffmpeg-release-essentials.zip.sha256'
& curl.exe --fail --location --silent --show-error --max-time 180 --output $checksumFile ($url + '.sha256')
if ($LASTEXITCODE -ne 0) { throw 'FFmpeg checksum download failed' }
$expected = ((Get-Content -LiteralPath $checksumFile -Raw).Trim() -split '\s+')[0]
if ($expected -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid FFmpeg checksum' }
if (!(Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected) {
  & curl.exe --fail --location --silent --show-error --max-time 600 --output $archive $url
  if ($LASTEXITCODE -ne 0) { throw 'FFmpeg download failed' }
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected) { throw 'FFmpeg archive checksum mismatch' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
  foreach ($name in @('ffmpeg.exe','ffprobe.exe')) {
    $entries = @($zip.Entries | Where-Object { $_.FullName -match ('/bin/' + [regex]::Escape($name) + '$') })
    if ($entries.Count -ne 1) { throw ('Missing or ambiguous binary: ' + $name) }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entries[0], (Join-Path $destination $name), $true)
  }
  $license = @($zip.Entries | Where-Object { $_.FullName -match '/LICENSE$' })
  if ($license.Count -eq 1) { [IO.Compression.ZipFileExtensions]::ExtractToFile($license[0], (Join-Path $destination 'LICENSE'), $true) }
} finally { $zip.Dispose() }
$version = (& (Join-Path $destination 'ffmpeg.exe') -version | Select-Object -First 1)
if ($LASTEXITCODE -ne 0) { throw 'FFmpeg executable verification failed' }
& (Join-Path $destination 'ffprobe.exe') -version | Select-Object -First 1
if ($LASTEXITCODE -ne 0) { throw 'FFprobe executable verification failed' }
@{ source=$url; sha256=$expected.ToLowerInvariant(); installedAt=[DateTime]::UtcNow.ToString('o'); version=$version } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination 'installation.json') -Encoding UTF8
Write-Output $version
