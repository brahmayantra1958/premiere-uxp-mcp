$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$node = (Get-Content -LiteralPath (Join-Path $repository 'artifacts/install/node.json') -Raw | ConvertFrom-Json).executable
& $node (Join-Path $PSScriptRoot 'connect.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Connection verification failed; inspect the error above.' }
