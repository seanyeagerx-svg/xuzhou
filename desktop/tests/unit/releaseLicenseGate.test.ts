import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const { verifyRelease } = createRequire(import.meta.url)('../../scripts/licensing/verify.cjs');
const { hashFile, manifest } = createRequire(import.meta.url)('../../scripts/licensing/artifact.cjs');
const { prepareApplication } = createRequire(import.meta.url)('../../scripts/licensing/runtimeModules.cjs');
const { assessRustResults } = createRequire(import.meta.url)('../../scripts/licensing/quality.cjs');
const created: string[] = [];
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
type TestPolicy = {
  schemaVersion: number;
  product: string;
  status: string;
  blockers: Array<{ id: string; message: string }>;
  inputSha256: Record<string, string>;
  approvedCoreBinaries: string[];
  resourceSha256?: Record<string, string>;
};
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xuzhou-license-test-'));
  created.push(root);
  const inventory = JSON.stringify({ missingLicenseText: [], unresolvedDependencies: [] });
  const inputs: Record<string, string> = {
    'package.json': '{}',
    'bun.lock': 'locked',
    'packages/desktop/electron-builder.yml': 'publish: null',
    'public/branding/LICENSE': 'original license',
    'public/branding/NOTICE': 'original attribution',
    'public/branding/MODIFICATIONS.md': 'changed files',
    'public/branding/license-inventory.json': inventory,
    'public/branding/third-party-notices.html': '<html>notices</html>',
    'public/branding/compliance/license-decisions.json': '{}',
    'public/branding/compliance/source-materials.json': '{}',
  };
  for (const [name, body] of Object.entries(inputs)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), body);
  }
  const policy: TestPolicy = {
    schemaVersion: 1,
    product: 'Xuzhou',
    status: 'blocked',
    blockers: [{ id: 'restricted-core-material', message: 'PDF material prohibits redistribution' }],
    inputSha256: Object.fromEntries(Object.entries(inputs).map(([file, body]) => [file, hash(body)])),
    approvedCoreBinaries: [],
  };
  const save = () =>
    fs.writeFileSync(path.join(root, 'public/branding/compliance/release-policy.json'), JSON.stringify(policy));
  save();
  return { root, policy, save };
}

function candidateFixture() {
  const result = fixture();
  const { root, policy, save } = result;
  const resources = {
    'resources/bundled-aioncore/win32-x64/aioncore.exe': 'reviewed replacement',
    'resources/bundled-aioncore/win32-x64/manifest.json': '{}',
    'resources/bundled-aioncore/win32-x64/managed-resources/manifest.json': '{}',
    'resources/hub/index.json': '{}',
    'resources/hub/LICENSE': 'original Hub license',
    'resources/workbench/integrations/aionui/bridge.mjs': 'bridge code',
  };
  for (const [file, body] of Object.entries(resources)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), body);
  }
  policy.status = 'candidate';
  policy.blockers = [{ id: 'final-artifact-review', message: 'Inspect the actual installer' }];
  policy.approvedCoreBinaries = [hash(resources['resources/bundled-aioncore/win32-x64/aioncore.exe'])];
  policy.resourceSha256 = Object.fromEntries(Object.entries(resources).map(([file, body]) => [file, hash(body)]));
  save();
  return result;
}

function approvedFixture() {
  const result = candidateFixture();
  const installer = path.join(result.root, 'reviewed-installer.exe');
  const payload = path.join(result.root, 'extracted');
  const runtime = path.join(result.root, 'runtime-result.json');
  const reportFile = path.join(result.root, 'release-verified.json');
  fs.mkdirSync(payload);
  fs.writeFileSync(path.join(payload, 'app.txt'), 'verified payload');
  fs.writeFileSync(installer, 'verified installer');
  fs.writeFileSync(runtime, '{"passed":true}');
  const sourceArchive = path.join(result.root, 'reviewed-source.zip');
  fs.writeFileSync(sourceArchive, 'verified source');
  const report = {
    schemaVersion: 1,
    status: 'verified',
    policySha256: hashFile(path.join(result.root, 'public/branding/compliance/release-policy.json')),
    installer: { path: installer, sha256: hashFile(installer) },
    sourceArchive: { path: sourceArchive, sha256: hashFile(sourceArchive) },
    extractedPayloadDirectory: payload,
    payloadSha256: manifest(payload),
    functionalEvidence: [{ path: runtime, sha256: hashFile(runtime) }],
  };
  const saveReport = () => fs.writeFileSync(reportFile, JSON.stringify(report));
  saveReport();
  return { ...result, installer, reportFile, report, saveReport };
}
afterEach(() => {
  for (const dir of created.splice(0)) {
    if (!path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'xuzhou-license-test-'))
      throw new Error('Unsafe test cleanup');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
describe('Xuzhou distribution license gate', () => {
  const fixtureFailures = [
    'skill_batch_import_reports_partial_failures_without_rolling_back_successes',
    'connection_test_unreachable_url',
    'service_test::create_rejects_unavailable_workspace_with_trailing_whitespace_in_request',
    'session_context::tests::is_auto_workspace_matches_by_structure_across_user_and_date',
  ];
  const workspaceLog =
    'test result: ok. 1 passed; 0 failed; 0 ignored;\n'.repeat(21) +
    fixtureFailures.map((name) => 'test ' + name + ' ... FAILED').join('\n') +
    '\ntest result: FAILED. 0 passed; 4 failed; 0 ignored;\nerror: 3 targets failed:\n';
  const regressionLog =
    'Running unittests src/lib.rs (aionui_conversation-123.exe)\nRunning tests/extension_e2e.rs\nRunning tests/mcp_e2e.rs\n' +
    fixtureFailures.map((name) => 'test ' + name + ' ... ok').join('\n') +
    '\ntest result: ok. 538 passed; 0 failed; 0 ignored;\n';
  it('keeps original failures visible while counting resolved cases only once', () => {
    const result = assessRustResults(
      { exitCode: 101, command: 'full workspace' },
      workspaceLog,
      { exitCode: 0, command: 'affected groups' },
      regressionLog
    );
    expect(result).toMatchObject({ passed: 25, failed: 0, initialWorkspaceExitCode: 101, rerunPassed: 538 });
    expect(result.initialFailures).toEqual(fixtureFailures);
  });
  it('blocks an unknown workspace failure even when later output says success', () => {
    expect(() =>
      assessRustResults(
        { exitCode: 101 },
        workspaceLog.replace(fixtureFailures[0], 'unknown_failure'),
        { exitCode: 0 },
        regressionLog
      )
    ).toThrow('unknown workspace failure');
  });
  it('requires each failed case and every affected group to actually be rerun', () => {
    expect(() =>
      assessRustResults(
        { exitCode: 101 },
        workspaceLog,
        { exitCode: 0 },
        regressionLog.replace(fixtureFailures[0] + ' ... ok', 'other_case ... ok')
      )
    ).toThrow('not rerun');
    expect(() =>
      assessRustResults(
        { exitCode: 101 },
        workspaceLog,
        { exitCode: 0 },
        regressionLog.replace('Running tests/mcp_e2e.rs', '')
      )
    ).toThrow('not all rerun');
  });
  it('rejects failed or partial regression runs', () => {
    expect(() => assessRustResults({ exitCode: 101 }, workspaceLog, { exitCode: 101 }, regressionLog)).toThrow(
      'not passed'
    );
    expect(() =>
      assessRustResults(
        { exitCode: 101 },
        workspaceLog,
        { exitCode: 0 },
        regressionLog.replace('538 passed', '4 passed')
      )
    ).toThrow('not passed');
  });
  it('rejects a fully hash-listed bridge whose relative helper is missing', () => {
    const { root, policy, save } = candidateFixture();
    const file = 'resources/workbench/integrations/aionui/bridge.mjs';
    const code = 'require("./missing.cjs")';
    fs.writeFileSync(path.join(root, file), code);
    policy.resourceSha256![file] = hash(code);
    save();
    expect(() => verifyRelease(root, { forBuild: true })).toThrow('Cannot find module');
  });
  it('preserves conflicting runtime versions and excludes unrelated development tools', () => {
    const { root } = fixture();
    const put = (relative: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      fs.writeFileSync(path.join(root, relative), text);
    };
    const fakePackage = (
      relative: string,
      name: string,
      version: string,
      dependencies: Record<string, string>,
      code: string
    ) => {
      put(relative + '/package.json', JSON.stringify({ name, version, main: 'index.cjs', dependencies }));
      put(relative + '/index.cjs', code);
    };
    put('LICENSE', 'Original license');
    put('out/main/index.js', 'application');
    put(
      'package.json',
      JSON.stringify({
        name: 'xuzhou-workbench',
        dependencies: { a: '1', b: '2' },
        devDependencies: { rollup: '4' },
        workspaces: ['packages/*'],
      })
    );
    fakePackage(
      'node_modules/a',
      'a',
      '1',
      { b: '1', c: '1' },
      "exports.name='A';exports.b=require('b');exports.c=require('c');"
    );
    fakePackage('node_modules/b', 'b', '2', {}, "module.exports='two';");
    fakePackage('node_modules/a/node_modules/b', 'b', '1', {}, "module.exports='one';");
    fakePackage(
      'node_modules/a/node_modules/c',
      'c',
      '1',
      { a: '1', b: '1' },
      "module.exports={b:require('b'),a:require('a').name};"
    );
    fakePackage('node_modules/rollup', 'rollup', '4', {}, "throw Error('Development tool must not be shipped');");
    const prepared = prepareApplication(root);
    const packagedRequire = createRequire(path.join(prepared.destination, 'package.json'));
    expect(packagedRequire('a')).toEqual({ name: 'A', b: 'one', c: { b: 'one', a: 'A' } });
    expect(packagedRequire('b')).toBe('two');
    expect(fs.existsSync(path.join(prepared.destination, 'node_modules/rollup'))).toBe(false);
    const pkg = JSON.parse(fs.readFileSync(path.join(prepared.destination, 'package.json'), 'utf8'));
    expect(pkg.devDependencies).toBeUndefined();
    expect(pkg.workspaces).toBeUndefined();
  });
  it('accepts final approval only for the exact installer, payload and runtime evidence', () => {
    const { root, reportFile } = approvedFixture();
    expect(verifyRelease(root, { artifactApproval: reportFile })).toMatchObject({ releaseReady: true });
  });
  it('rejects an installer changed after final approval', () => {
    const { root, installer, reportFile } = approvedFixture();
    fs.writeFileSync(installer, 'different installer');
    expect(() => verifyRelease(root, { artifactApproval: reportFile })).toThrow('Installer changed');
  });
  it('rejects source changed after final approval', () => {
    const { root, reportFile, report } = approvedFixture();
    fs.writeFileSync(report.sourceArchive.path, 'different source');
    expect(() => verifyRelease(root, { artifactApproval: reportFile })).toThrow('source archive changed');
  });
  it('rejects an extra file in the verified installer payload', () => {
    const { root, reportFile, report } = approvedFixture();
    fs.writeFileSync(path.join(report.extractedPayloadDirectory, 'unlisted.txt'), 'extra content');
    expect(() => verifyRelease(root, { artifactApproval: reportFile })).toThrow('payload changed');
  });
  it('rejects runtime evidence changed after final approval', () => {
    const { root, reportFile, report } = approvedFixture();
    fs.writeFileSync(report.functionalEvidence[0].path, '{"passed":false}');
    expect(() => verifyRelease(root, { artifactApproval: reportFile })).toThrow('Runtime evidence changed');
  });
  it('does not accept a final approval flag without packaged runtime evidence', () => {
    const { root, reportFile, report, saveReport } = approvedFixture();
    report.functionalEvidence = [];
    saveReport();
    expect(() => verifyRelease(root, { artifactApproval: reportFile })).toThrow(
      'Missing actual packaged runtime evidence'
    );
  });
  it('allows a fully reviewed candidate to build without claiming final installer approval', () => {
    const { root } = candidateFixture();
    expect(verifyRelease(root, { forBuild: true })).toMatchObject({ buildAllowed: true, releaseReady: false });
    expect(() => verifyRelease(root)).toThrow('Final installer approval');
  });
  it('rejects an unlisted file added after resource review', () => {
    const { root } = candidateFixture();
    fs.writeFileSync(path.join(root, 'resources/hub/unreviewed.zip'), 'unreviewed');
    expect(() => verifyRelease(root, { forBuild: true })).toThrow('Unlisted or missing');
  });
  it('rejects a candidate whose executable changes after review', () => {
    const { root } = candidateFixture();
    fs.writeFileSync(path.join(root, 'resources/bundled-aioncore/win32-x64/aioncore.exe'), 'another binary');
    expect(() => verifyRelease(root, { forBuild: true })).toThrow('Unreviewed release resource');
  });
  it('rejects resource approval with the Core omitted', () => {
    const { root, policy, save } = candidateFixture();
    delete policy.resourceSha256!['resources/bundled-aioncore/win32-x64/aioncore.exe'];
    save();
    expect(() => verifyRelease(root, { forBuild: true })).toThrow('Exactly one reviewed');
  });
  it('validates local notices without claiming distribution approval', () => {
    const { root } = fixture();
    expect(verifyRelease(root, { noticesOnly: true })).toMatchObject({ noticesVerified: true, releaseReady: false });
  });
  it('blocks public packaging even when all notices are present', () => {
    const { root } = fixture();
    expect(() => verifyRelease(root)).toThrow('restricted-core-material');
  });
  it('rejects a missing source or attribution attachment', () => {
    const { root, policy, save } = fixture();
    policy.inputSha256['public/branding/compliance/sources/missing.crate'] = hash('source');
    save();
    expect(() => verifyRelease(root, { noticesOnly: true })).toThrow();
  });
  it('rejects dependency or notice changes after review', () => {
    const { root } = fixture();
    fs.writeFileSync(path.join(root, 'bun.lock'), 'different dependency version');
    expect(() => verifyRelease(root, { noticesOnly: true })).toThrow('stale');
  });
  it('cannot approve a binary merely by changing a status flag', () => {
    const { root, policy, save } = fixture();
    policy.status = 'ready';
    policy.blockers = [];
    save();
    expect(() => verifyRelease(root)).toThrow('Missing reviewed rebuilt Core');
  });
  it('refuses chat/profile material even if a manifest lists it', () => {
    const { root, policy, save } = fixture();
    policy.inputSha256['profile-local/aionui/auth.json'] = hash('private');
    save();
    expect(() => verifyRelease(root, { noticesOnly: true })).toThrow('Private or escaping path');
  });
  it('rejects traversal in an audit manifest', () => {
    const { root, policy, save } = fixture();
    policy.inputSha256['../outside.txt'] = hash('outside');
    save();
    expect(() => verifyRelease(root, { noticesOnly: true })).toThrow('Private or escaping path');
  });
  it('rejects omission of a mandatory notice from the tracked inputs', () => {
    const { root, policy, save } = fixture();
    delete policy.inputSha256['public/branding/NOTICE'];
    save();
    expect(() => verifyRelease(root, { noticesOnly: true })).toThrow('Untracked required');
  });
  it('still rejects prohibited material in a hash-listed replacement executable', () => {
    const { root, policy, save } = fixture();
    const body = 'Distribute, sublicense, or transfer these materials';
    const relative = 'resources/bundled-aioncore/win32-x64/aioncore.exe';
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), body);
    policy.status = 'ready';
    policy.blockers = [];
    policy.approvedCoreBinaries = [hash(body)];
    policy.resourceSha256 = { [relative]: hash(body) };
    save();
    expect(() => verifyRelease(root)).toThrow('Restricted or unapproved');
  });
});
