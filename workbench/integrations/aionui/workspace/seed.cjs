const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {readJson} = require('./context/history.cjs');
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
function snapshotFile(directory, id) {
  if (!uuid(id)) throw new Error('历史快照编号无效');
  return path.join(directory, 'imports', id + '.json');
}
function readSnapshot(directory, id) {
  const snapshot = readJson(snapshotFile(directory, id));
  if (snapshot.id !== id || !Array.isArray(snapshot.source?.messages)) throw new Error('历史快照损坏，原对话仍保留');
  return snapshot;
}
// Only the application-created assistant preamble activates an import. A quote
// inside ordinary user text is not an import request, and never runs a command.
function applyImport(c, text, directory) {
  const match = text.match(/^\[Assistant Rules\]\r?\nworkbench-history:([a-f0-9-]{36})\r?\n/i);
  if (!match) return text;
  const end = text.indexOf('[/Assistant Rules]', match[0].length);
  if (end < 0) throw new Error('历史接续说明不完整，尚未发送');
  const id = match[1];
  if (c.importId && c.importId !== id) throw new Error('此聊天已绑定其他历史，未覆盖已有内容');
  if (!c.importId) {
    const snapshot = readSnapshot(directory, id);
    if (fs.realpathSync(c.cwd).toLowerCase() !== fs.realpathSync(snapshot.cwd).toLowerCase()) throw new Error('历史接续的项目已变化，尚未发送');
    if (c.messages.length) throw new Error('只能把历史带入空聊天，已有消息保持不变');
    c.messages = snapshot.source.messages.map(m => ({...m, sourceMessageId:m.id, id:crypto.randomUUID()}));
    c.nativeSource = {agentId:snapshot.source.agentId,id:snapshot.source.id,cwd:snapshot.source.cwd,readAt:snapshot.createdAt};
    c.importId = id;
    c.importRevision = 0;
    for (const route of Object.values(c.routes || {})) route.cursor = 0;
  }
  // AionUi appends its available skills inside this same block. Preserve them
  // while consuming only our local marker, never send a dangling import token.
  const rules = text.slice(match[0].length, end).trim();
  const message = text.slice(end + '[/Assistant Rules]'.length).trimStart();
  return rules ? '[Assistant Rules]\n' + rules + '\n[/Assistant Rules]\n\n' + message : message;
}
module.exports = {snapshotFile, readSnapshot, applyImport};
