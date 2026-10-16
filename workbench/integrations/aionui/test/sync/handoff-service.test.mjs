// Copyright 2026 Xuzhou contributors. SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { WorkbenchAgent } from '../../service.mjs';

test('ACP conversations use Xuzhou handoffs across Codex, Kiro V3 and ZCode and survive restart', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xuzhou-service-')), prompts = [], adapters = new Map();
  const agents = ['codex', 'kiro-v3', 'zcode'].map(id => ({ id, name: id, type: id === 'zcode' ? 'zcode' : id === 'codex' ? 'codex' : 'acp' }));
  class Adapter extends EventEmitter {
    constructor(config) { super(); this.config = config; this.sessions = new Map(); }
    async connect() { this.ready = true; }
    sessionOptions() { return { model: 'test', models: [{ id: 'test', name: 'Test', efforts: [{ id: 'high', name: 'High' }] }], effort: 'high' }; }
    async newSession(_cwd, _model, resume) { const id = resume || this.config.id + '-native'; this.sessions.set(id, {}); return { id, options: this.sessionOptions() }; }
    async setSessionOption() { return this.sessionOptions(); }
    async prompt(sessionId, text) {
      prompts.push({ provider: this.config.id, text, tools: this.sessionMcpServers() });
      this.emit('event', { type: 'delta', agentId: this.config.id, sessionId, text: this.config.id + ' replied' });
      this.emit('event', { type: 'completed', agentId: this.config.id, sessionId });
    }
    close() { this.ready = false; }
  }
  const options = { agents, dataDir: root, adapterFactory: config => { const adapter = new Adapter(config); adapters.set(config.id, adapter); return adapter; } };
  const connection = { sessionUpdate: async () => {}, requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }) };
  let agent = new WorkbenchAgent(connection, options);
  t.after(() => { agent.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const created = await agent.newSession({ cwd: root, mcpServers: [] });
  const say = text => agent.prompt({ sessionId: created.sessionId, prompt: [{ type: 'text', text }] });
  await say('项目代号 S-739，保留 Codex 和 v2rayN 配置。');
  await agent.unstable_setSessionModel({ sessionId: created.sessionId, modelId: 'kiro-v3/test' });
  await say('接着做');
  assert.match(prompts[1].text, /S-739/); assert.match(prompts[1].text, /v2rayN/);
  await agent.unstable_setSessionModel({ sessionId: created.sessionId, modelId: 'zcode/test' }); await say('复核');
  assert.match(prompts[2].text, /kiro-v3 replied/);
  await agent.unstable_setSessionModel({ sessionId: created.sessionId, modelId: 'codex/test' }); await say('继续');
  assert.match(prompts[3].text, /zcode replied/); assert.doesNotMatch(prompts[3].text, /S-739/);
  const before = agent.store.read(created.sessionId);
  assert.equal(before.continuity.handoffs.length, 4); assert.ok(before.continuity.handoffs.every(r => r.status === 'completed'));
  assert.ok(prompts.every(p => p.tools.some(tool => tool.name === 'workbench_history')));
  agent.close(); agent = new WorkbenchAgent(connection, options);
  await agent.loadSession({ sessionId: created.sessionId, cwd: root, mcpServers: [] });
  await say('恢复后继续');
  const after = agent.store.read(created.sessionId);
  assert.deepEqual(after.messages.slice(0, before.messages.length), before.messages);
  assert.equal(after.continuity.handoffs.length, 5);
});

test('late events from a different provider never become the current response', async () => {
  // This boundary uses the same event ownership check as the runtime bridge.
  const { acceptsTurnEvent } = await import('../../../../src/continuity/session.cjs');
  const c = { status: 'running', agentId: 'kiro-v3', remoteId: 'kiro-native', activeTurn: { agentId: 'kiro-v3', remoteId: 'kiro-native' } };
  assert.equal(acceptsTurnEvent(c, { agentId: 'codex', sessionId: 'old-native' }), false);
});
