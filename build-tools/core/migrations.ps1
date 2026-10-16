param([Parameter(Mandatory=$true)][string]$SourceRoot)
$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'migrations.json') -Raw | ConvertFrom-Json
$directory = Join-Path $SourceRoot 'crates/aionui-db/migrations'
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$files = Get-ChildItem -LiteralPath $directory -File -Filter '*.sql'
if ($files.Count -ne @($manifest.sqlSha384.PSObject.Properties).Count) { throw 'Unexpected migration set' }
foreach ($file in $files) {
  $expected = $manifest.sqlSha384.($file.Name)
  if (-not $expected) { throw "Unreviewed SQL migration: $($file.Name)" }
  $text = [IO.File]::ReadAllText($file.FullName, $utf8).Replace("`r`n", "`n").Replace("`n", "`r`n")
  $bytes = $utf8.GetBytes($text)
  $actual = [Convert]::ToHexString([Security.Cryptography.SHA384]::HashData($bytes)).ToLowerInvariant()
  if ($actual -ne $expected) { throw "Migration SQL content changed: $($file.Name)" }
  $existing = [Convert]::ToHexString([Security.Cryptography.SHA384]::HashData([IO.File]::ReadAllBytes($file.FullName))).ToLowerInvariant()
  if ($existing -ne $expected) { [IO.File]::WriteAllBytes($file.FullName, $bytes) }
}
Write-Output "Verified $($files.Count) original SQL migrations with Windows CRLF checksums; database validation remains enabled."
