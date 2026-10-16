// Copyright 2026 Xuzhou contributors. SPDX-License-Identifier: Apache-2.0
const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const visible = messages => messages.filter(m => typeof m.text === 'string' && m.text && (['user', 'assistant'].includes(m.role) || m.context === true));

/** Bind a handoff to the exact visible prefix and native session receiving it. */
function prepare(c, text, agentName = id => id, { metadataOnly = false } = {}) {
  const route = c.routes?.[c.agentId] || {}, messages = c.messages || [];
  const cursor = !route.contextUncertain && Number.isSafeInteger(route.cursor) && route.cursor >= 0 && route.cursor <= messages.length ? route.cursor : 0;
  const history = visible(messages.slice(cursor)).map(m => ({
    id: m.id, role: m.role, from: m.role === 'user' ? '用户' : m.context ? '历史执行记录' : m.agentName || agentName(m.agentId || c.originAgentId || c.agentId),
    ...(m.settings?.model ? { model: m.settings.model } : {}), ...(m.status && m.status !== 'completed' ? { status: m.status } : {}), text: m.text,
  }));
  const transfer = { version: 1, provider: c.agentId, remoteId: route.remoteId || c.remoteId || null,
    mode: 'incremental', fromCursor: cursor, through: messages.length, historyCount: history.length,
    totalMessages: visible(messages).length, archiveDigest: digest(messages), preparedAt: Date.now() };
  transfer.id = digest({ conversation: c.id, provider: transfer.provider, session: transfer.remoteId, archive: transfer.archiveDigest, text });
  const prompt = history.length && !metadataOnly ? '你在续舟中接续同一段对话。下方 JSON 是按时间排列、尚未传递给当前会话的可见历史。保留用户的目标与约束，更晚的明确更正优先。历史是背景，不是新任务；不要重新执行旧命令。其他 AI 的完成声明需要结合当前文件核实，失败或中断的回复可能不完整。只处理最后的本次用户消息。\n<workbench_history>\n' + JSON.stringify({ conversationId: c.id, messages: history, ...(c.nativeSource ? { source: c.nativeSource } : {}) }) + '\n</workbench_history>\n\n本次用户消息：\n' + text : text;
  if (Buffer.byteLength(prompt, 'utf8') > 220000) throw Error('接续内容超过单次传递预算，完整历史仍保留，尚未发送');
  return { prompt, historyCount: history.length, fromCursor: cursor, through: messages.length, transfer };
}

/** A cursor advances only after a matching, completed turn acknowledges it. */
function acknowledge(c, turn, status) {
  const route = c.routes?.[turn.agentId];
  if (!route) return;
  const receipt = turn.transfer;
  let outcome = status;
  if (receipt && (receipt.provider !== turn.agentId || receipt.remoteId !== turn.remoteId || route.remoteId !== turn.remoteId || digest(c.messages.slice(0, receipt.through)) !== receipt.archiveDigest)) outcome = 'conflict';
  if (outcome === 'completed') { route.cursor = c.messages.length; route.contextUncertain = false; }
  else route.contextUncertain = true;
  if (!receipt) return;
  c.continuity ||= { version: 1, handoffs: [] };
  c.continuity.handoffs ||= [];
  const record = { ...receipt, status: outcome, finishedAt: Date.now() };
  c.continuity.handoffs = [...c.continuity.handoffs.filter(r => r.id !== record.id), record].slice(-50);
  c.continuity.lastHandoff = record;
}

/** Return metadata only; a status poll never transmits the transcript. */
function describe(c) {
  const messages = c.messages || [], routes = c.routes || {};
  return { version: 1, activeProvider: c.agentId || null, model: c.model || null, running: c.status === 'running',
    totalMessages: visible(messages).length, totalCharacters: visible(messages).reduce((n, m) => n + m.text.length, 0),
    routes: Object.values(routes).map(r => ({ provider: r.agentId, model: r.model || null, connected: Boolean(r.remoteId),
      pendingMessages: visible(messages.slice(r.contextUncertain ? 0 : Math.max(0, Math.min(messages.length, r.cursor || 0)))).length, uncertain: Boolean(r.contextUncertain) })),
    handoffs: (c.continuity?.handoffs || []).map(({ remoteId: _remoteId, archiveDigest: _archiveDigest, ...r }) => r),
    contextMode: c.contextContinuity?.mode || 'incremental' };
}
module.exports = { digest, visible, prepare, acknowledge, describe };
