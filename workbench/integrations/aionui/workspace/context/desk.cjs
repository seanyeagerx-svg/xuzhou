// Copyright 2026 Xuzhou contributors. SPDX-License-Identifier: Apache-2.0
const fs = require('node:fs');
const path = require('node:path');
const { describe } = require('../../../../src/continuity/transfer.cjs');
const { readJson } = require('./history.cjs');
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const chatId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,127}$/i.test(value);
const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** Inspect locally saved metadata; status polling never connects an AI account. */
class ContinuityDesk {
  constructor({ history, sync, backend }) { this.history = history; this.sync = sync; this.backend = backend; this.bindings = new Map(); }
  find(chat, importId) {
    const session = chat.extra?.acp_session_id, cached = this.bindings.get(chat.id);
    const names = [...new Set([session, cached].filter(uuid))];
    if (importId) names.push(...fs.readdirSync(this.history.directory).filter(name => /^[a-f0-9-]{36}\.json$/i.test(name)).map(name => name.slice(0, -5)).filter(id => !names.includes(id)));
    for (const id of names) {
      const file = path.join(this.history.directory, id + '.json');
      if (!fs.existsSync(file)) continue;
      const c = readJson(file);
      if (c.id !== id || !samePath(c.cwd, chat.extra?.workspace)) continue;
      if (importId ? c.importId !== importId : id !== session) continue;
      this.bindings.set(chat.id, id);
      return c;
    }
    return null;
  }
  async call(action, data) {
    if (!chatId(data.conversationId)) throw Error('聊天编号无效');
    const chat = await this.backend('/api/conversations/' + data.conversationId, 'GET', undefined, true);
    if (!chat || chat.id !== data.conversationId) throw Error('聊天不存在，原记录未修改');
    const importId = chat.extra?.workbench_import_id;
    if (importId && !uuid(importId)) throw Error('聊天接续编号无效');
    const c = this.find(chat, importId);
    if (!importId && !c) return { available: false };
    if (action === 'chat-sync-toggle') {
      if (!importId) throw Error('此聊天尚未绑定原软件同步');
      this.sync.setEnabled(importId, data.enabled);
    }
    if (action === 'chat-sync-now' && importId) await this.sync.retry(importId);
    const status = importId ? this.sync.status(importId) : null;
    return { available: true, conversationId: chat.id, ...(c ? describe(c) : { activeProvider: null, model: null, running: false, totalMessages: status?.snapshot.source.messages.length || 0, totalCharacters: 0, routes: [], handoffs: [], contextMode: 'incremental' }),
      sync: status ? { id: importId, enabled: status.enabled, provider: status.snapshot.source.agentId, revision: status.snapshot.revision,
        inbound: status.inbound, outbound: status.outbound, error: status.error } : null };
  }
}
module.exports = { ContinuityDesk };
