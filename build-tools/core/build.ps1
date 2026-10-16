param([string]$BuildRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
$ErrorActionPreference = 'Stop'
$sourceRoot = Join-Path $BuildRoot 'core'
& (Join-Path $PSScriptRoot 'migrations.ps1') -SourceRoot $sourceRoot
$env:CARGO_HOME = Join-Path $BuildRoot 'tools/cargo'
$env:RUSTUP_HOME = Join-Path $BuildRoot 'tools/rustup'
$env:CARGO_TARGET_DIR = Join-Path $BuildRoot 'target'
$env:CARGO_BUILD_JOBS = '2'
$env:CARGO_NET_GIT_FETCH_WITH_CLI = 'true'
$env:RUSTFLAGS = '-C target-feature=+crt-static'
$env:PATH = (Join-Path $BuildRoot 'tools/cargo/bin') + ';' + $env:PATH
(Get-Process -Id $PID).PriorityClass = 'BelowNormal'
& (Join-Path $BuildRoot 'tools/msvc/Common7/Tools/Launch-VsDevShell.ps1') -Arch amd64 -HostArch amd64 -SkipAutomaticLocation
if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) { throw 'MSVC compiler not available' }
if (-not (Get-Command cmake.exe -ErrorAction SilentlyContinue)) { throw 'CMake not available' }
Push-Location $sourceRoot
try {
  & cargo.exe build --release --locked --target x86_64-pc-windows-msvc -p aionui-app *> (Join-Path $BuildRoot 'evidence/core-build.log')
  $buildExit = $LASTEXITCODE
  Get-Content -LiteralPath (Join-Path $BuildRoot 'evidence/core-build.log') -Tail 28
  if ($buildExit -ne 0) { throw "Core build failed: $buildExit" }
  $binary = Join-Path $env:CARGO_TARGET_DIR 'x86_64-pc-windows-msvc/release/aioncore.exe'
  @{rust=(& rustc.exe --version);cargo=(& cargo.exe --version);binary=$binary;sha256=(Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant();finishedAt=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $BuildRoot 'evidence/core-build-result.json') -Encoding utf8
  Get-Content -Raw -LiteralPath (Join-Path $BuildRoot 'evidence/core-build-result.json')
} finally { Pop-Location }
