// Copyright 2026 Xuzhou contributors. SPDX-License-Identifier: Apache-2.0
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const routing = require('../../../../src/continuity/session.cjs');
const transfer = require('../../../../src/continuity/transfer.cjs');
const batching = require('../../../../src/continuity/sync.cjs');
const { continuation } = require('../../workspace/context/continuation.cjs');
const { ContinuityDesk } = require('../../workspace/context/desk.cjs');
const { History } = require('../../workspace/history.cjs');
const { AutoSync } = require('../../workspace/auto-sync.cjs');
const conversation = () => ({ id: crypto.randomUUID(), agentId: 'codex', remoteId: 'native-codex', model: 'codex-model', status: 'idle', messages: [{ id: 'u1', role: 'user', text: '保留原始素材，不要删除' }, { id: 'a1', role: 'assistant', text: '已记录', status: 'completed' }], routes: { codex: { agentId: 'codex', remoteId: 'native-codex', cursor: 2, model: 'codex-model' } } });

test('switches reuse provider sessions and send only unseen conversation text', () => {
  const c = conversation(); routing.bindSession(c, 'kiro-v3', 'native-kiro'); routing.activateRoute(c, 'kiro-v3');
  const carried = routing.continuation(c, '继续');
  assert.equal(carried.historyCount, 2); assert.match(carried.prompt, /不要删除/);
  c.messages.push({ id: 'u2', role: 'user', text: '继续' }, { id: 'a2', role: 'assistant', text: '完成', status: 'completed' });
  c.activeTurn = { agentId: c.agentId, remoteId: c.remoteId, transfer: carried.transfer }; routing.finishTurn(c, 'completed');
  routing.activateRoute(c, 'codex'); assert.equal(routing.continuation(c, '复核').historyCount, 2);
});
test('a failed or interrupted turn keeps all unacknowledged context for the next attempt', () => {
  const c = conversation(), carried = routing.continuation(c, '检查');
  c.activeTurn = { agentId: 'codex', remoteId: c.remoteId, transfer: carried.transfer }; routing.finishTurn(c, 'error');
  assert.equal(c.routes.codex.cursor, 2); assert.equal(routing.continuation(c, '再试').historyCount, 2);
});
test('a changed prefix cannot produce a successful handoff receipt', () => {
  const c = conversation(), carried = routing.continuation(c, '检查');
  c.messages[0].text = 'rewritten'; c.activeTurn = { agentId: 'codex', remoteId: c.remoteId, transfer: carried.transfer };
  routing.finishTurn(c, 'completed'); assert.equal(c.continuity.lastHandoff.status, 'conflict'); assert.equal(c.routes.codex.contextUncertain, true);
});
test('a rejected native model selection preserves the current software and model', async () => {
  const c = conversation(), before = JSON.stringify(c.messages);
  await assert.rejects(routing.selectModel(c, 'kiro-v3', 'other', async () => ({ setSessionOption: async () => ({ model: 'different' }) })), /未确认/);
  assert.equal(c.agentId, 'codex'); assert.equal(c.model, 'codex-model'); assert.equal(JSON.stringify(c.messages), before);
});
test('model changes cannot run during an active reply or access prototype names', async () => {
  const c = conversation(); c.status = 'running';
  await assert.rejects(routing.selectModel(c, 'codex', 'other', async () => { throw Error('must not connect'); }), /尚未结束/);
  assert.throws(() => routing.routeFor(c, '__proto__'), /编号无效/);
});
test('long handoffs keep source text and include late corrections plus full-history tools', () => {
  const c = conversation(); c.messages.push(...Array.from({ length: 60 }, (_, i) => ({ id: 'long-' + i, role: i % 2 ? 'assistant' : 'user', text: '普通工作记录' + '材料'.repeat(900), status: 'completed' })));
  c.messages.push({ id: 'correction', role: 'user', text: '更正，预算改为 7300，原来的 9000 作废。' });
  const before = JSON.stringify(c.messages), carried = continuation(c, '预算多少？');
  assert.match(carried.prompt, /7300/); assert.equal(carried.transfer.mode, 'searchable-history'); assert.equal(JSON.stringify(c.messages), before);
});
test('sync excludes imported and incomplete turns and refuses duplicate local identities', () => {
  const c = conversation(); c.messages[0].sourceMessageId = 'source'; assert.equal(batching.completedMessages(c).length, 0);
  delete c.messages[0].sourceMessageId; c.messages[1].id = 'u1'; assert.throws(() => batching.completedMessages(c), /重复/);
});
test('batch byte limits include multibyte characters and already acknowledged messages stay immutable', () => {
  const messages = Array.from({ length: 4 }, (_, i) => ({ key: String(i), role: 'user', text: '龙'.repeat(10000) }));
  assert.equal(batching.makeBatch('chat', messages, {}).messages.length, 1);
  assert.throws(() => batching.makeBatch('chat', messages, { 0: 'wrong-hash' }), /改写/);
});
test('metadata inspection does not expose the visible text or native session identifiers', () => {
  const c = conversation(), carried = routing.continuation(c, 'x'); c.activeTurn = { agentId: 'codex', remoteId: c.remoteId, transfer: carried.transfer }; routing.finishTurn(c, 'completed');
  const status = JSON.stringify(transfer.describe(c)); assert.doesNotMatch(status, /native-codex|原始素材|archiveDigest/);
});
test('desk restores legacy session documents without modifying them or accepting path traversal', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xuzhou-desk-')), c = conversation(), chatId = crypto.randomUUID();
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); c.cwd = root;
  const file = path.join(root, c.id + '.json'), before = JSON.stringify(c); fs.writeFileSync(file, before);
  const desk = new ContinuityDesk({ history: { directory: root }, sync: {}, backend: async () => ({ id: chatId, extra: { workspace: root, acp_session_id: c.id } }) });
  assert.equal((await desk.call('chat-continuity', { conversationId: chatId })).totalMessages, 2);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  await assert.rejects(desk.call('chat-continuity', { conversationId: '../secret' }), /编号无效/);
});
test('a completed local file triggers synchronization without waiting for the periodic poll', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xuzhou-watch-')), id = crypto.randomUUID(), c = conversation(); c.cwd = root; c.importId = id;
  const source = { id: 'native', agentId: 'codex', cwd: root, messages: [] };
  const history = new History({ directory: root, legacyDirectory: root, reader: { read: async () => source }, backend: async () => ({ id: 'chat', extra: { workbench_import_id: id, workspace: root } }) });
  fs.writeFileSync(path.join(root, 'imports', id + '.json'), JSON.stringify({ id, cwd: root, source, createdAt: 1 }));
  fs.writeFileSync(history.indexFile, JSON.stringify({ key: { id, conversationId: 'chat' } }));
  let resolveDelivery; const delivered = new Promise(resolve => { resolveDelivery = resolve; });
  const sync = new AutoSync({ history, interval: 15000, writer: { deliver: async (_source, batch) => resolveDelivery(batch), close() {} } });
  t.after(async () => { await sync.close(); history.close(); fs.rmSync(root, { recursive: true, force: true }); });
  sync.schedule = () => {}; sync.start(); fs.writeFileSync(path.join(root, c.id + '.json'), JSON.stringify(c));
  let timer;
  const result = await Promise.race([delivered, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('No file-triggered synchronization')), 3000); })]).finally(() => clearTimeout(timer));
  assert.equal(result.messages.length, 2);
});
