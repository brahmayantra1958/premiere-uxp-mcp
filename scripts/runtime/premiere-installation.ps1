function Resolve-PremiereInstallation([string]$Candidate) {
  if (-not $Candidate) {
    $settingsPath = Join-Path $PSScriptRoot '../../artifacts/settings.json'
    if (Test-Path -LiteralPath $settingsPath) { $Candidate = (Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json).premiereRoot }
  }
  if (-not $Candidate) {
    $parent = Join-Path $env:ProgramFiles 'Adobe'
    $installations = @(Get-ChildItem -LiteralPath $parent -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'Adobe Premiere Pro*' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'Adobe Premiere Pro.exe')) } | Sort-Object Name -Descending)
    if ($installations.Count -eq 1) { $Candidate = $installations[0].FullName }
  }
  if (-not $Candidate -or -not (Test-Path -LiteralPath (Join-Path $Candidate 'Adobe Premiere Pro.exe'))) { throw 'Specify -PremiereRoot with the exact Premiere installation directory, or set artifacts/settings.json premiereRoot.' }
  return (Resolve-Path -LiteralPath $Candidate).Path
}
