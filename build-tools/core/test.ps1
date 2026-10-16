param([string]$BuildRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),[ValidateRange(1,8)][int]$Jobs=4,[switch]$AffectedOnly)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'migrations.ps1') -SourceRoot (Join-Path $BuildRoot 'core')
$env:CARGO_HOME = Join-Path $BuildRoot 'tools/cargo'
$env:RUSTUP_HOME = Join-Path $BuildRoot 'tools/rustup'
$env:CARGO_TARGET_DIR = Join-Path $BuildRoot 'target'
$env:CARGO_BUILD_JOBS = [string]$Jobs
$env:CARGO_NET_GIT_FETCH_WITH_CLI = 'true'
$env:RUSTFLAGS = '-C target-feature=+crt-static'
# A real native Node fixture is required by Windows managed-runtime validation tests.
$env:AIONUI_TEST_NODE_EXECUTABLE = Join-Path $BuildRoot 'desktop/resources/bundled-aioncore/win32-x64/managed-resources/node/node-v24.11.0-win-x64/node.exe'
# Keep loopback fixtures local even when the parent process has an outbound proxy.
# This modifies only the test process and its children, never system proxy settings.
$env:NO_PROXY = (@('127.0.0.1','localhost','::1') + @($env:NO_PROXY -split ',' | Where-Object {$_})) -join ','
$env:PATH = (Join-Path $BuildRoot 'tools/cargo/bin') + ';' + $env:PATH
(Get-Process -Id $PID).PriorityClass = 'BelowNormal'
& (Join-Path $BuildRoot 'tools/msvc/Common7/Tools/Launch-VsDevShell.ps1') -Arch amd64 -HostArch amd64 -SkipAutomaticLocation
Push-Location (Join-Path $BuildRoot 'core')
try {
  $testSourceSha256=[ordered]@{}
  $testFiles=@(& rg.exe --files -g '*.rs')+@('Cargo.lock')
  if($LASTEXITCODE -ne 0){throw 'Cannot enumerate test source'}
  foreach($testFile in ($testFiles|Sort-Object)){
    $relative=$testFile.Replace('\','/')
    $testSourceSha256[$relative]=(Get-FileHash -LiteralPath $testFile -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  $testArgs=if($AffectedOnly){@('test','-p','aionui-app','-p','aionui-conversation','-p','aionui-extension','-p','aionui-file','-p','aionui-mcp','-p','aionui-office','-p','aionui-project','-p','aionui-runtime','-p','aionui-shell','-p','aionui-sidebar','-p','aionui-team','--lib','--test','extension_e2e','--test','mcp_e2e','--test','lifecycle_hooks_test','--test','directory_browsing','--test','file_read_write','--test','connection_test_integration','--test','scm_request_path','--test','service','--test','session_service_integration')}else{@('test','--workspace')}
  $testArgs+=@('--no-fail-fast','--release','--locked','--target','x86_64-pc-windows-msvc')
  $testLog=if($AffectedOnly){'evidence/core-regression-tests.log'}else{'evidence/core-tests.log'}
  $testResult=if($AffectedOnly){'evidence/core-regression-result.json'}else{'evidence/core-test-result.json'}
  & cargo.exe @testArgs *> (Join-Path $BuildRoot $testLog)
  $testExit=$LASTEXITCODE
  Get-Content -LiteralPath (Join-Path $BuildRoot $testLog) -Tail 32
  @{exitCode=$testExit;finishedAt=(Get-Date).ToUniversalTime().ToString('o');command=('cargo '+($testArgs -join ' '));loopbackIsolated=$true;sourceSha256=$testSourceSha256}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $BuildRoot $testResult) -Encoding utf8
  exit $testExit
} finally { Pop-Location }
