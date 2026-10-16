const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Computers } = require('../index.cjs');

function setup(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xuzhou-route-')), canonical = crypto.randomUUID();
  const profile = { host: 'fixture-cloud.invalid', port: 22, username: 'fixture' };
  const lobster = { maintenance: { ready: true, generation: 1, profile }, state: { conversations: [] }, snapshot: () => ({ approvals: [] }), decisions: new Map(), decision: async () => {}, active: () => {} };
  const resource = { diskFree: 4 * 1024 ** 3, diskTotal: 20 * 1024 ** 3, memoryAvailable: 200 * 1024 ** 2, memoryTotal: 1024 ** 3 };
  const calls = [];
  const remote = { probe: async () => resource, run: async () => ({ root: '/home/fixture/.xuzhou/workspaces/test' }), command: async (root, data) => { calls.push(['cloud', root, data]); return { output: 'REMOTE_FIXTURE', exitCode: 0 }; } };
  const local = { command: async () => { calls.push(['local']); return { output: 'LOCAL_FIXTURE', exitCode: 0 }; } };
  const computers = new Computers({ directory, sessionsDirectory: directory, backend: async route => ({ id: route.split('/').at(-1), extra: { workspace: directory, acp_session_id: canonical } }), lobster, remote, local, ...overrides });
  t.after(async () => { await computers.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { computers, directory, canonical, lobster, resource, calls, remote };
}
test('cloud low-space refusal does not prepare a directory or select the device', async t => {
  const f = setup(t); f.resource.diskFree = 30; let prepares = 0; f.remote.run = async () => { prepares++; };
  await assert.rejects(f.computers.call('computer-select', { conversationId: 'chat', deviceId: 'cloud' }), /CLOUD_SPACE_LOW/);
  assert.equal(prepares, 0); assert.equal((await f.computers.call('computer-state', { conversationId: 'chat' })).deviceId, 'local');
});
test('selected cloud commands run only remotely and never fall back after disconnect', async t => {
  const f = setup(t);
  await f.computers.call('computer-select', { conversationId: 'chat', deviceId: 'cloud' });
  const result = await f.computers.call('computer-command', { conversationId: 'chat', command: 'hostname' });
  assert.equal(result.deviceId, 'cloud'); assert.equal(f.calls[0][0], 'cloud');
  f.lobster.maintenance.ready = false;
  await assert.rejects(f.computers.call('computer-command', { conversationId: 'chat', command: 'hostname' }), /CLOUD_DISCONNECTED/);
  assert.equal(f.calls.length, 1);
  assert.equal((await f.computers.call('computer-state', { conversationId: 'chat' })).deviceId, 'cloud');
});
test('an approval cannot execute after the SSH identity changes', async t => {
  const f = setup(t);
  await f.computers.call('computer-select', { conversationId: 'chat', deviceId: 'cloud' });
  f.lobster.decision = async () => { f.lobster.maintenance.profile = { host: 'another-host.invalid', username: 'fixture', port: 22 }; };
  await assert.rejects(f.computers.tool('computer_command', { command: 'hostname' }, { sessionId: f.canonical }), /CONNECTION_CHANGED/);
  assert.equal(f.calls.length, 0);
});

test('reconnecting to the same SSH account invalidates an earlier approval', async t => {
  const f = setup(t);
  await f.computers.call('computer-select', { conversationId: 'chat', deviceId: 'cloud' });
  f.lobster.decision = async () => { f.lobster.maintenance.generation++; };
  await assert.rejects(f.computers.tool('computer_command', { command: 'hostname' }, { sessionId: f.canonical }), /CONNECTION_CHANGED/);
  assert.equal(f.calls.length, 0);
});

test('an AI file read cannot begin after its turn ended during the resource probe', async t => {
  const f = setup(t); let ended = false, reads = 0;
  await f.computers.call('computer-select', { conversationId: 'chat', deviceId: 'cloud' });
  f.remote.probe = async () => { ended = true; return f.resource; };
  f.lobster.active = () => { if (ended) throw Error('TURN_ENDED'); };
  f.remote.files = async () => { reads++; };
  await assert.rejects(f.computers.tool('computer_files', { operation: 'list', path: '' }, { sessionId: f.canonical }), /TURN_ENDED/);
  assert.equal(reads, 0);
});
test('phone cannot enable screen sharing or issue another owner pairing code', async t => {
  const f = setup(t, { native: { screen: { status: () => ({ available: true, mode: 'off' }), close:()=>{} } } });
  const caller = { source: 'phone', actor: 'paired-device' };
  await assert.rejects(f.computers.call('computer-screen', { conversationId: 'chat', operation: 'start' }, caller), /SCREEN_OWNER_REQUIRED/);
  await assert.rejects(f.computers.call('computer-pair', { conversationId: 'chat' }, caller), /PHONE_OWNER_REQUIRED/);
});
test('changing selected device is refused while an operation is awaiting approval', async t => {
  const f = setup(t); let release, waiting;
  f.lobster.decision = () => new Promise(resolve => { release = resolve; waiting?.(); });
  await f.computers.call('computer-state', { conversationId: 'chat' });
  const ready = new Promise(resolve => { waiting = resolve; });
  const command = f.computers.tool('computer_command', { command: 'hostname' }, { sessionId: f.canonical });
  await ready;
  await assert.rejects(f.computers.call('computer-select', { conversationId: 'chat', deviceId: 'cloud' }), /BUSY/);
  f.computers.busy.get('chat').abort.abort(); release();
  await assert.rejects(command, /CANCELLED/); assert.equal(f.calls.length, 0);
});
