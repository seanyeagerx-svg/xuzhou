const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LocalTarget } = require('../targets/local.cjs');
const { capacity, fileRequest, relativeName, hash, commandRequest } = require('../targets/policy.cjs');

test('cloud capacity rejects missing readings, low disk, low free fraction and low memory', () => {
  const enough = { diskFree: 2 * 1024 ** 3, diskTotal: 20 * 1024 ** 3, memoryAvailable: 256 * 1024 ** 2, memoryTotal: 1024 ** 3 };
  assert.equal(capacity(enough).usable, true);
  assert.equal(capacity({ ...enough, diskFree: 1024 ** 3 - 1 }).reason, 'CLOUD_SPACE_LOW');
  assert.equal(capacity({ ...enough, diskTotal: 100 * 1024 ** 3 }).reason, 'CLOUD_SPACE_LOW');
  assert.equal(capacity({ ...enough, memoryAvailable: 128 * 1024 ** 2 - 1 }).reason, 'CLOUD_MEMORY_LOW');
  assert.equal(capacity({ diskFree: Infinity }).reason, 'CAPACITY_UNKNOWN');
  assert.equal(capacity({ ...enough, diskFree: enough.diskTotal + 1 }).usable, false);
});
test('relative file paths reject traversal, drive paths, alternate streams and absolute paths', () => {
  for (const value of ['../secret', 'a/../../b', '/etc/passwd', 'C:\\temp', 'name:stream', '\\server\\share', 'a\0b']) assert.throws(() => relativeName(value), /PATH_OUTSIDE/);
  assert.equal(relativeName('folder\\nested/file.txt'), 'folder/nested/file.txt');
  assert.throws(() => fileRequest({ operation: 'write', path: 'file.txt', base64: 'b2s=' }), /FILE_VERSION_REQUIRED/);
  assert.throws(() => commandRequest({ command: 'x', timeoutMs: 0 }), /TIMEOUT_INVALID/);
});
test('local file create, read and compare-before-save preserve later edits and never overwrite on create', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzhou-files-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = new LocalTarget();
  const request = text => fileRequest({ operation: 'write', path: 'continuation.txt', base64: Buffer.from(text).toString('base64'), expectedSha256: null });
  await target.files(root, request('first'));
  await assert.rejects(target.files(root, request('second')), /FILE_CONFLICT/);
  const original = await target.files(root, fileRequest({ operation: 'read', path: 'continuation.txt' }));
  assert.equal(Buffer.from(original.base64, 'base64').toString(), 'first');
  await target.files(root, { ...request('a'), expectedSha256: original.sha256 });
  assert.equal(await fs.readFile(path.join(root, 'continuation.txt'), 'utf8'), 'a');
  await assert.rejects(target.files(root, { ...request('stale'), expectedSha256: hash('first') }), /FILE_CONFLICT/);
  assert.equal(await fs.readFile(path.join(root, 'continuation.txt'), 'utf8'), 'a');
});
test('local files cannot follow a junction outside the selected chat directory', async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzhou-links-')); t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'root'), outside = path.join(parent, 'outside'); await fs.mkdir(root); await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'protected.txt'), 'keep');
  await fs.symlink(outside, path.join(root, 'jump'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(new LocalTarget().files(root, fileRequest({ operation: 'read', path: 'jump/protected.txt' })), /PATH_OUTSIDE/);
  assert.equal(await fs.readFile(path.join(outside, 'protected.txt'), 'utf8'), 'keep');
});
test('real local commands report failures and timeout instead of treating completion as success', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzhou-command-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const local = new LocalTarget();
  const result = await local.command(root, commandRequest({ command: process.platform === 'win32' ? "[IO.File]::WriteAllText((Join-Path (Get-Location) 'proof.txt'),'真实命令'); Write-Output 'COMMAND_OK'" : "printf 'real' > proof.txt; printf 'COMMAND_OK'" }));
  assert.equal(result.exitCode, 0); assert.match(result.output, /COMMAND_OK/);
  assert.equal((await fs.stat(path.join(root, 'proof.txt'))).isFile(), true);
  const bad = await local.command(root, commandRequest({ command: 'exit 7' })); assert.equal(bad.exitCode, 7);
  const slow = await local.command(root, commandRequest({ command: process.platform === 'win32' ? 'Start-Sleep -Seconds 5' : 'sleep 5', timeoutMs: 100 })); assert.equal(slow.stopped, 'TIMEOUT');
});
