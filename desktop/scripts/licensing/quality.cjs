const fs = require('node:fs');
const path = require('node:path');
const { files, hashFile } = require('./artifact.cjs');
const knownFixtureFailures = new Set([
  'skill_batch_import_reports_partial_failures_without_rolling_back_successes',
  'connection_test_unreachable_url',
  'service_test::create_rejects_unavailable_workspace_with_trailing_whitespace_in_request',
  'session_context::tests::is_auto_workspace_matches_by_structure_across_user_and_date',
]);
function counts(log) {
  const results = [...log.matchAll(/test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored;/g)];
  return results.reduce(
    (n, row) => ({
      passed: n.passed + +row[1],
      failed: n.failed + +row[2],
      ignored: n.ignored + +row[3],
      suites: n.suites + 1,
    }),
    { passed: 0, failed: 0, ignored: 0, suites: 0 }
  );
}
function assessRustResults(workspace, log, regression, regressionLog) {
  const original = counts(log);
  if (original.suites < 20) throw Error('Workspace test output is incomplete');
  if (workspace.exitCode === 0) {
    if (original.failed || /error: test failed|error: could not compile/.test(log))
      throw Error('Workspace test output contradicts success');
    return { mode: 'full-workspace', ...original, command: workspace.command };
  }
  const failures = [...log.matchAll(/^test (.+) \.\.\. FAILED\s*$/gm)].map((m) => m[1]);
  if (
    workspace.exitCode !== 101 ||
    !/error: \d+ targets? failed:/.test(log) ||
    !failures.length ||
    failures.length !== original.failed ||
    failures.some((name) => !knownFixtureFailures.has(name))
  )
    throw Error('Unresolved or unknown workspace failure');
  const retried = counts(regressionLog || '');
  if (
    !/Running unittests [^\r\n]*aionui_conversation-[^ )]+\.exe/.test(regressionLog || '') ||
    !/Running tests[\\/]extension_e2e\.rs/.test(regressionLog || '') ||
    !/Running tests[\\/]mcp_e2e\.rs/.test(regressionLog || '')
  )
    throw Error('Affected test groups were not all rerun');
  if (
    regression?.exitCode !== 0 ||
    retried.failed ||
    retried.passed < 538 ||
    /error: test failed|error: could not compile/.test(regressionLog || '')
  )
    throw Error('Affected test groups have not passed');
  for (const name of failures) {
    if (!(regressionLog || '').split(/\r?\n/).some((line) => line.trim() === 'test ' + name + ' ... ok'))
      throw Error('Failed case was not rerun: ' + name);
  }
  // Count each original test once, rather than inflating totals with passing reruns.
  return {
    mode: 'full-workspace-plus-affected-group-reruns',
    passed: original.passed + original.failed,
    failed: 0,
    ignored: original.ignored,
    suites: original.suites,
    initialWorkspaceExitCode: workspace.exitCode,
    initialFailures: failures,
    rerunPassed: retried.passed,
    command: workspace.command + '; then ' + regression.command,
  };
}
function reviewCoreChanges(original, candidate) {
  const normalize = (file) => fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
  const list = (root) =>
    files(root)
      .filter((file) => file.endsWith('.rs'))
      .map((file) => path.relative(root, file).replaceAll('\\', '/'))
      .sort();
  const before = list(original),
    after = list(candidate);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Unexpected Rust source addition or removal');
  const allowed = new Set([
    'crates/aionui-ai-agent/src/terminal.rs',
    'crates/aionui-app/tests/extension_e2e.rs',
    'crates/aionui-conversation/src/service_test.rs',
    'crates/aionui-conversation/src/session_context.rs',
    'crates/aionui-extension/src/lifecycle.rs',
    'crates/aionui-extension/src/skill_service.rs',
    'crates/aionui-extension/tests/lifecycle_hooks_test.rs',
    'crates/aionui-file/src/service.rs',
    'crates/aionui-file/tests/directory_browsing.rs',
    'crates/aionui-file/tests/file_read_write.rs',
    'crates/aionui-mcp/tests/connection_test_integration.rs',
    'crates/aionui-office/src/conversion.rs',
    'crates/aionui-office/src/watch_manager.rs',
    'crates/aionui-project/src/canonical_test.rs',
    'crates/aionui-project/src/containment_test.rs',
    'crates/aionui-project/src/runtime/tree_model_test.rs',
    'crates/aionui-project/src/scm/git_provider_test.rs',
    'crates/aionui-project/tests/scm_request_path.rs',
    'crates/aionui-project/tests/service.rs',
    'crates/aionui-runtime/src/node_runtime/managed/tests.rs',
    'crates/aionui-runtime/src/node_runtime/mod.rs',
    'crates/aionui-runtime/src/node_runtime/system.rs',
    'crates/aionui-runtime/src/shell_env.rs',
    'crates/aionui-runtime/src/spawn.rs',
    'crates/aionui-runtime/src/test_support.rs',
    'crates/aionui-shell/src/shell.rs',
    'crates/aionui-sidebar/src/service_test.rs',
    'crates/aionui-team/tests/session_service_integration.rs',
  ]);
  const changed = before.filter(
    (relative) => normalize(path.join(original, relative)) !== normalize(path.join(candidate, relative))
  );
  const reviewedProductionChanges = {};
  for (const relative of changed) {
    if (!allowed.has(relative)) throw Error('Unreviewed production Rust change: ' + relative);
    const originalText = normalize(path.join(original, relative));
    const candidateText = normalize(path.join(candidate, relative));
    if (
      !relative.includes('/tests/') &&
      !relative.endsWith('_test.rs') &&
      relative !== 'crates/aionui-runtime/src/node_runtime/managed/tests.rs' &&
      relative !== 'crates/aionui-runtime/src/test_support.rs'
    ) {
      const marker = /#\[cfg\(test\)\]\s*mod tests\s*\{/;
      const a = originalText.search(marker),
        b = candidateText.search(marker);
      let expectedPrefix = originalText.slice(0, a);
      if (relative === 'crates/aionui-extension/src/skill_service.rs') {
        const anchor = '    if metadata.file_type().is_symlink() || metadata.is_file() {';
        if (!expectedPrefix.includes(anchor)) throw Error('Directory link patch base changed');
        expectedPrefix = expectedPrefix.replace(
          anchor,
          '    // Xuzhou modification (2026-10-16): directory reparse points require RemoveDirectory,\n    // including dangling junctions whose symlink_metadata().is_dir() is false.\n    #[cfg(windows)]\n    {\n        use std::os::windows::fs::FileTypeExt;\n        if metadata.file_type().is_symlink_dir() {\n            tokio::fs::remove_dir(path).await?;\n            return Ok(());\n        }\n    }\n\n' +
            anchor
        );
        reviewedProductionChanges[relative] = {
          sha256: hashFile(path.join(candidate, relative)),
          change: 'Remove Windows directory reparse points with remove_dir; preserve linked source contents',
        };
      }
      if (a < 0 || b < 0 || expectedPrefix !== candidateText.slice(0, b))
        throw Error('Production implementation changed: ' + relative);
    }
    const functions = (text) => [...text.matchAll(/^\s*(?:async\s+)?fn (\w+)\(/gm)].map((m) => m[1]);
    const remaining = new Set(functions(candidateText));
    if (functions(originalText).some((name) => !remaining.has(name)))
      throw Error('Existing fixture function removed: ' + relative);
    const occurrences = (text, regex) => [...text.matchAll(regex)].length;
    if (
      occurrences(candidateText, /#\[ignore(?:\([^\]]*\))?\]/g) >
      occurrences(originalText, /#\[ignore(?:\([^\]]*\))?\]/g)
    )
      throw Error('Test disabled: ' + relative);
    if (
      occurrences(candidateText, /#\[(?:tokio::)?test(?:\([^\]]*\))?\]/g) <
      occurrences(originalText, /#\[(?:tokio::)?test(?:\([^\]]*\))?\]/g)
    )
      throw Error('Test attribute removed: ' + relative);
  }
  const links = [
    ['crates/aionui-conversation/src/lib.rs', 'service_test'],
    ['crates/aionui-project/src/canonical.rs', 'canonical_test'],
    ['crates/aionui-project/src/containment.rs', 'containment_test'],
    ['crates/aionui-project/src/runtime/tree_model.rs', 'tree_model_test'],
    ['crates/aionui-project/src/scm/git_provider.rs', 'git_provider_test'],
    ['crates/aionui-sidebar/src/service.rs', 'service_test'],
    ['crates/aionui-runtime/src/node_runtime/managed.rs', 'tests'],
    ['crates/aionui-runtime/src/lib.rs', 'test_support'],
  ];
  for (const [file, name] of links) {
    const expected = new RegExp('#\\[cfg\\(test\\)\\]\\s*(?:#\\[path = "[^"\\n]+"\\]\\s*)?mod ' + name + ';');
    if (!expected.test(normalize(path.join(candidate, file)))) throw Error('Fixture is not test-only: ' + file);
  }
  return {
    productionRustUnchanged: Object.keys(reviewedProductionChanges).length === 0,
    reviewedProductionChanges,
    changedRustFiles: Object.fromEntries(
      changed.map((relative) => [relative, hashFile(path.join(candidate, relative))])
    ),
  };
}
function rustVerification(build, upstream) {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(build, 'evidence', name), 'utf8').replace(/^\uFEFF/, ''));
  const workspace = read('core-test-result.json');
  const testedRoot = path.join(build, 'core');
  const expectedSources = files(testedRoot)
    .filter((file) => file.endsWith('.rs'))
    .map((file) => path.relative(testedRoot, file).replaceAll('\\', '/'))
    .concat('Cargo.lock')
    .sort();
  if (
    !workspace.sourceSha256 ||
    JSON.stringify(Object.keys(workspace.sourceSha256).sort()) !== JSON.stringify(expectedSources)
  )
    throw Error('Tested source manifest is absent or incomplete');
  for (const file of expectedSources) {
    if (hashFile(path.join(testedRoot, file)) !== workspace.sourceSha256[file])
      throw Error('Source changed since tests: ' + file);
  }
  const logFile = path.join(build, 'evidence/core-tests.log');
  if (Date.parse(workspace.finishedAt) + 2000 < fs.statSync(logFile).mtimeMs)
    throw Error('Workspace result is stale or still running');
  const log = fs.readFileSync(logFile, 'utf8');
  const retried = workspace.exitCode === 0 ? undefined : read('core-regression-result.json');
  const retryFile = path.join(build, 'evidence/core-regression-tests.log');
  if (retried && Date.parse(retried.finishedAt) + 2000 < fs.statSync(retryFile).mtimeMs)
    throw Error('Regression result is stale or still running');
  const result = assessRustResults(workspace, log, retried, retried ? fs.readFileSync(retryFile, 'utf8') : '');
  return {
    ...result,
    ...reviewCoreChanges(upstream, path.join(build, 'core')),
    testedSourceFiles: expectedSources.length,
    testedSourceBound: true,
    workspaceLogSha256: hashFile(logFile),
    ...(retried ? { regressionLogSha256: hashFile(retryFile) } : {}),
  };
}
module.exports = { counts, assessRustResults, reviewCoreChanges, rustVerification };
