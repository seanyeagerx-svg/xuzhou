import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import syncHelpers from '../../../src/message-sync.cjs';
const { safeText } = syncHelpers;

export class LobsterClient {
  constructor(endpointFile, dataDir) {
    this.endpointFile = endpointFile;
    this.outbox = path.join(dataDir, 'lobster-outbox');
    this.clients = new Map(); this.sending = null;
    fs.mkdirSync(this.outbox, { recursive: true });
    this.timer = setInterval(() => {
      void this.flush();
      for (const client of this.clients.values()) void this.call('heartbeat', { clientId: client.id }).catch(() => {});
    }, 10000);
    this.timer.unref();
  }
  async call(method, data) {
    const endpoint = JSON.parse(fs.readFileSync(this.endpointFile, 'utf8')), u = new URL(endpoint.url);
    if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || u.pathname !== '/bridge' || !/^[\da-f]{64}$/.test(endpoint.token)) throw new Error('龙虾本机连接配置无效');
    const response = await fetch(u, { method: 'POST', headers: { Authorization: 'Bearer ' + endpoint.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ method, data }), signal: AbortSignal.timeout(5000) });
    const result = await response.json(); if (!response.ok || result.error) throw new Error(result.error || '龙虾同步连接失败'); return result.value;
  }
  client(c) {
    let client = this.clients.get(c.id);
    if (!client) { client = { id: crypto.randomUUID(), sessionId: c.id, cwd: c.cwd, links: null }; this.clients.set(c.id, client); }
    return client;
  }
  async attach(c) {
    const client = this.client(c);
    if (client.links) return client.links;
    try {
      await this.flush();
      const result = await this.call('attach', { clientId: client.id, sessionId: c.id, cwd: c.cwd, pid: process.pid });
      client.computers=result.features?.computers===true;
      client.links = result.links; return result.links;
    } catch { return null; }
  }
  async record(c, taskId, phase, { goal = '', result = '', error = '' } = {}) {
    const client = this.client(c), id = crypto.randomUUID();
    const event = { id, clientId: client.id, sessionId: c.id, taskId, cwd: c.cwd, agentId: c.agentId === 'kiro-v3' ? 'kiro' : c.agentId, phase, goal: safeText(goal, 16000), result: safeText(result, 22000), error: safeText(error), at: Date.now() };
    const file = path.join(this.outbox, id + '.json'), temporary = file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(event)); fs.renameSync(temporary, file);
    await this.flush();
  }
  async deviceContext(c) {
    const client=this.client(c);
    if(!client.links||!client.computers)return {deviceId:'local',configured:false};
    return this.call('device-context',{clientId:client.id});
  }
  supportsComputers(c){return this.clients.get(c.id)?.computers===true;}
  async flush() {
    this.dirty = true;
    if (this.sending) return this.sending;
    this.sending = (async () => {
      while (this.dirty) {
      this.dirty = false;
      const events = [];
      for (const file of fs.readdirSync(this.outbox).filter(f => /^[\da-f-]{36}\.json$/.test(f))) {
        try { events.push({ file, event: JSON.parse(fs.readFileSync(path.join(this.outbox, file), 'utf8')) }); } catch { /* Preserve unreadable records for inspection. */ }
      }
      for (const { file, event } of events.sort((a, b) => a.event.at - b.event.at || (a.event.phase === 'started' ? -1 : 1))) {
        try { await this.call('event', event); try { fs.unlinkSync(path.join(this.outbox, file)); } catch (e) { if (e.code !== 'ENOENT') throw e; } } catch { return; }
      }
      }
    })().finally(() => { this.sending = null; });
    return this.sending;
  }
  detach(c) {
    const client = this.clients.get(c.id); if (!client) return;
    void this.call('detach', { clientId: client.id }).catch(() => {});
    this.clients.delete(c.id);
  }
  close() { clearInterval(this.timer); }
}
