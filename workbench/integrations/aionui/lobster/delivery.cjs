const crypto = require('node:crypto');
const { textOf, safeText, displayReport } = require('../../../src/message-sync.cjs');

function remoteBusy(history) {
  return history.sessionInfo?.hasActiveRun === true || history.sessionInfo?.runStatus === 'running' || !!history.inFlightRun?.runId;
}
function workReceipt(history, batch) {
  const receipt = history.inputReceipts?.find(x => x.runId === batch.id && x.state === 'consumed') || history.inputConsumptions?.find(x => x.runId === batch.id);
  if (receipt) return receipt.consumedByEventId || batch.id;
  const row = history.messages?.find(m => m.role === 'user' && textOf(m).includes(batch.marker));
  return row && (row.__openclaw?.id || row.id || batch.id);
}

class Delivery {
  constructor(runtime) { this.r = runtime; }
  inbox(projectId) {
    const r = this.r;
    r.project(projectId);
    let c = r.state.conversations.find(x => x.projectId === projectId && x.agentId === 'openclaw' && x.gateway === r.gatewayConfig().url);
    if (!c) {
      c = { id: crypto.randomUUID(), projectId, agentId: 'openclaw', gateway: r.gatewayConfig().url, title: '龙虾助理 · 工作汇报', assistantInbox: true, status: 'idle', messages: [], activities: [], createdAt: Date.now() };
      r.state.conversations.push(c);
      r.save();
    }
    return c;
  }
  async session(c) {
    const a = this.r.gateway;
    if (!a?.ready) throw new Error('龙虾离线，工作信息已保留');
    if (!c.remoteId || !a.sessions.has(c.remoteId)) {
      c.remoteId = (await a.newSession(this.r.project(c.projectId).root, null, c.remoteId)).id;
      this.r.save();
    }
    return a;
  }
  record(c, batch) {
    const id = 'sync-report:' + batch.id;
    if (!c.messages.some(x => x.id === id)) c.messages.push({ id, role: 'report', text: this.r.sync.data.items.filter(x => x.batchId === batch.id).map(displayReport).join('\n\n'), createdAt: Date.now() });
    this.r.save();
  }
  reply(c, id) {
    let m = c.messages.find(x => x.id === id);
    if (!m) { m = { id, role: 'assistant', text: '', status: 'running', createdAt: Date.now() }; c.messages.push(m); }
    c.pendingReplyId = id;
    c.pendingStartedAt = Date.now();
    c.status = 'running';
    this.r.save();
    return m;
  }
  event(e) {
    const c = this.r.state.conversations.find(x => x.agentId === 'openclaw' && x.remoteId === e.sessionId && x.gateway === this.r.gatewayConfig().url);
    if (!c) return;
    const reply = c.messages.find(x => x.id === c.pendingReplyId);
    if (reply && e.type === 'replace') reply.text = safeText(e.text, 30000);
    if (['completed', 'error', 'cancelled'].includes(e.type)) {
      if (reply) { reply.status = e.type; if (e.type === 'error') reply.error = safeText(e.text); }
      c.status = 'idle'; delete c.pendingReplyId; delete c.pendingStartedAt;
    }
    this.r.save();
  }
  finishFromHistory(c, batch, history) {
    if (remoteBusy(history)) return;
    const rows = history.messages || [];
    const start = rows.findIndex(x => x.role === 'user' && textOf(x).includes(batch.marker));
    let text = '';
    if (start >= 0) for (const row of rows.slice(start + 1)) {
      if (row.role === 'user') break;
      if (row.role === 'assistant' && textOf(row)) text = textOf(row);
    }
    if (!text && history.sessionInfo?.hasActiveRun !== false && !['completed', 'idle', 'error', 'aborted'].includes(history.sessionInfo?.runStatus)) return;
    const reply = c.messages.find(x => x.id === 'sync-reply:' + batch.id);
    if (reply && text) { reply.text = safeText(text, 30000); reply.status = 'completed'; }
    if (c.pendingReplyId === reply?.id) { c.status = 'idle'; delete c.pendingReplyId; delete c.pendingStartedAt; }
    const native = this.r.gateway.sessions.get(c.remoteId);
    if (native) native.busy = false;
    this.r.save();
  }
  async deliver(batch) {
    const r = this.r;
    if (!r.gateway?.ready) return { wait: true, detail: '龙虾离线，信息已保存在本机' };
    if (batch.gateway !== r.gatewayConfig().url) throw new Error('旧信息仍保留在原网关的同步队列');
    const c = this.inbox(batch.projectId), a = await this.session(c);
    if (batch.remoteId && batch.remoteId !== c.remoteId) throw new Error('原助理对话已变化，请核对同步目标');
    batch.conversationId = c.id; batch.remoteId = c.remoteId; r.sync.save();
    let history = await a.history(c.remoteId, batch.id);
    const receipt = workReceipt(history, batch);
    if (receipt) { this.record(c, batch); this.finishFromHistory(c, batch, history); return { confirmed: true, conversationId: c.id, receipt }; }
    if (batch.everSent && history.hasMore) {
      const e = new Error('历史页中尚未找到发送记录，需要核对后重试'); e.needsReview = true; throw e;
    }
    if (remoteBusy(history) || a.sessions.get(c.remoteId)?.busy) return { wait: true, detail: '助理正在处理上一条消息' };
    this.record(c, batch); this.reply(c, 'sync-reply:' + batch.id);
    batch.everSent = true; r.sync.save();
    await a.report(c.remoteId, batch.payload, batch.id);
    for (let i = 0; i < 8; i++) {
      history = await a.history(c.remoteId, batch.id);
      const receipt = workReceipt(history, batch);
      if (receipt) { this.finishFromHistory(c, batch, history); return { confirmed: true, conversationId: c.id, receipt }; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('已提交汇报，仍在等待持久消息记录');
  }
  async reconcile() {
    if (this.reconciling || !this.r.gateway?.ready) return;
    this.reconciling = true;
    try {
      for (const c of this.r.state.conversations.filter(x => x.agentId === 'openclaw' && x.pendingReplyId && Date.now() - (x.pendingStartedAt || 0) > 120000 && x.gateway === this.r.gatewayConfig().url)) {
        const batch = this.r.sync.data.batches.find(b => 'sync-reply:' + b.id === c.pendingReplyId);
        if (batch) this.finishFromHistory(c, batch, await this.r.gateway.history(c.remoteId, batch.id));
        else await this.refresh(c.projectId);
      }
    } catch { /* Offline data stays intact for reconnect and manual refresh. */ }
    finally { this.reconciling = false; }
  }
  async refresh(projectId) {
    const c = this.inbox(projectId), a = await this.session(c);
    const history = await a.history(c.remoteId);
    // Stable remote IDs keep refreshes idempotent. Remote content remains data.
    for (const row of (history.messages || []).slice(-30)) {
      const text = textOf(row); if (!text || !['user', 'assistant'].includes(row.role)) continue;
      const id = 'remote:' + (row.__openclaw?.id || row.id || crypto.createHash('sha256').update(row.role + '\n' + text).digest('hex'));
      if (!c.messages.some(x => x.id === id || x.text === text || (row.role === 'user' && text.includes('[WORKBENCH_REPORT:')))) c.messages.push({ id, role: row.role, text: safeText(text, 30000), createdAt: row.timestamp || Date.now(), status: 'completed' });
    }
    if (!remoteBusy(history)) { const s = a.sessions.get(c.remoteId); if (s) s.busy = false; c.status = 'idle'; }
    this.r.save();
    return { state: c.status, conversationId: c.id };
  }
  async send(projectId, message, wait = false) {
    if (typeof message !== 'string' || !message.trim() || message.length > 20000) throw new Error('消息为空或过长');
    const c = this.inbox(projectId), a = await this.session(c);
    if (remoteBusy(await a.history(c.remoteId)) || a.sessions.get(c.remoteId)?.busy) throw new Error('龙虾正在处理项目消息，请稍后发送');
    c.messages.push({ id: crypto.randomUUID(), role: 'user', text: safeText(message), createdAt: Date.now() });
    const reply = this.reply(c, crypto.randomUUID());
    let cleanup = () => {};
    const finished = wait ? new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('回复仍未结束，请在龙虾面板查看')); }, 180000);
      const listener = e => {
        if (e.sessionId !== c.remoteId || !['completed', 'error', 'cancelled'].includes(e.type)) return;
        cleanup(); e.type === 'completed' ? resolve({ state: 'completed', conversationId: c.id, reply: reply.text }) : reject(new Error(e.text || '回复中断'));
      };
      cleanup = () => { clearTimeout(timer); a.off('event', listener); };
      a.on('event', listener);
    }) : null;
    finished?.catch(() => {});
    try { await a.prompt(c.remoteId, message); } catch (e) { cleanup(); throw e; }
    return finished || { state: 'submitted', conversationId: c.id };
  }
}
module.exports = { Delivery, remoteBusy, workReceipt };
