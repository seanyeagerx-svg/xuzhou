$ErrorActionPreference = 'Stop'
$brandBase = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$auditRoot = [IO.Path]::GetFullPath((Join-Path $brandBase 'evidence/license-review'))
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $auditRoot 'core-source'))
$candidateRoot = [IO.Path]::GetFullPath((Join-Path $auditRoot 'release-core-source'))
$restrictedRoot = [IO.Path]::GetFullPath((Join-Path $sourceRoot 'crates/aionui-app/assets/builtin-skills/pdf'))
if (-not $candidateRoot.StartsWith($auditRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe candidate directory' }
if (Test-Path -LiteralPath $candidateRoot) { throw 'Candidate already exists; preserve it for review instead of overwriting.' }
$tag = Get-Content -Raw -LiteralPath (Join-Path $auditRoot 'core-tag.json') | ConvertFrom-Json
if ($tag.object.sha -ne '47e66d0d151123e973b3fd1e77afcb5671b3f8c5') { throw 'Unexpected AionCore source revision' }
New-Item -ItemType Directory -Path $candidateRoot | Out-Null
$copied = 0
foreach ($file in Get-ChildItem -LiteralPath $sourceRoot -File -Recurse -Force) {
  if ($file.FullName.StartsWith($restrictedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { continue }
  $relative = [IO.Path]::GetRelativePath($sourceRoot, $file.FullName)
  $target = Join-Path $candidateRoot $relative
  New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
  Copy-Item -LiteralPath $file.FullName -Destination $target
  $copied++
}
$pdfTarget = Join-Path $candidateRoot 'crates/aionui-app/assets/builtin-skills/pdf'
New-Item -ItemType Directory -Path $pdfTarget -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'pdf-SKILL.md') -Destination (Join-Path $pdfTarget 'SKILL.md')
Copy-Item -LiteralPath (Join-Path $sourceRoot 'LICENSE') -Destination (Join-Path $pdfTarget 'LICENSE.txt')
$cargoPath = Join-Path $candidateRoot 'Cargo.toml'
$cargo = Get-Content -LiteralPath $cargoPath -Raw
$cargo = $cargo -replace 'license = "MIT"', 'license = "Apache-2.0" # Xuzhou: align workspace metadata with the original root LICENSE.'
Set-Content -LiteralPath $cargoPath -Value $cargo -Encoding utf8
& (Join-Path $PSScriptRoot 'migrations.ps1') -SourceRoot $candidateRoot
$changeNote = "Xuzhou release candidate, 2026-10-15. Based on AionCore commit $($tag.object.sha).`nThe entire proprietary pdf skill directory was omitted and replaced by independently written Apache-2.0 instructions. Root LICENSE and other upstream notices are retained. Workspace license metadata now matches the root grant.`nThis source candidate is not a verified binary and has not replaced the running application. A release requires a reproducible build, dependency/source notices, functional checks and final package review.`n"
Set-Content -LiteralPath (Join-Path $candidateRoot 'XUZHOU-MODIFICATIONS.md') -Value $changeNote -Encoding utf8
$report = @{sourceCommit=$tag.object.sha;copiedFiles=$copied;excluded='crates/aionui-app/assets/builtin-skills/pdf/**';replacementSha256=(Get-FileHash -LiteralPath (Join-Path $pdfTarget 'SKILL.md') -Algorithm SHA256).Hash.ToLowerInvariant();candidate=$candidateRoot;compiled=$false;activated=$false;rustAvailable=[bool](Get-Command cargo -ErrorAction SilentlyContinue);originalBinaryChanged=$false}
$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $auditRoot 'core-candidate.json') -Encoding utf8
$report | ConvertTo-Json -Depth 4
