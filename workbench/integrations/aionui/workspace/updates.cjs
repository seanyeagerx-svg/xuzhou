const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {atomicJson} = require('../../../src/store.cjs');
const {snapshotFile, readSnapshot} = require('./seed.cjs');
const {checkArchive} = require('./context/history.cjs');

const messageValue = m => ({id:m.id,role:m.role,text:m.text,status:m.status,context:m.context,agentId:m.agentId,agentName:m.agentName,createdAt:m.createdAt});
const identity = source => [source.agentId,source.id,path.normalize(source.cwd || '').toLowerCase()];
function fingerprint(source) {
  return crypto.createHash('sha256').update(JSON.stringify({identity:identity(source),messages:source.messages.map(messageValue)})).digest('hex');
}
// Only an unchanged prefix may be extended. Rewrites, deletions and streaming
// edits require a separate import, never an invisible alteration of past turns.
function addedMessages(previous, next) {
  if (JSON.stringify(identity(previous)) !== JSON.stringify(identity(next))) throw new Error('原聊天的来源或项目已变化，未合并更新');
  if (!Array.isArray(next.messages)) throw new Error('原聊天记录不完整，未合并内容');
  checkArchive(next);
  const ids = new Set();
  for (const message of next.messages) {
    if (typeof message.id !== 'string' || !message.id || ids.has(message.id)) throw new Error('原聊天的消息编号不完整或重复，未合并更新');
    ids.add(message.id);
  }
  if (next.messages.length < previous.messages.length || previous.messages.some((m,i)=>JSON.stringify(messageValue(m))!==JSON.stringify(messageValue(next.messages[i] || {})))) {
    throw new Error('原聊天的已有内容被修改、删减或仍在生成，请稍后重试；若已改写，可从“接着旧聊天聊”另行带入，当前聊天保持不变');
  }
  const added = next.messages.slice(previous.messages.length);
  if (added.some(m => ['running','inProgress','in_progress','interrupted'].includes(m.status))) throw new Error('原聊天仍在生成，请等回复结束后再检查更新');
  return added;
}
const updateFile = (directory,id) => snapshotFile(directory,id).replace(/\.json$/,'.updates.json');
function readUpdateState(directory,id) {
  const base = readSnapshot(directory,id), file = updateFile(directory,id);
  if (!fs.existsSync(file)) return {...base,revision:0};
  const head = JSON.parse(fs.readFileSync(file,'utf8'));
  if (head.id!==id || !Number.isSafeInteger(head.revision) || head.revision<1 || head.baseFingerprint!==fingerprint(base.source)) throw new Error('已保存的原聊天更新不完整，原快照保持不变');
  addedMessages(base.source,head.source);
  return {...base,source:head.source,revision:head.revision,updatedAt:head.createdAt};
}
function saveUpdate(directory,preview) {
  const current = readUpdateState(directory,preview.importId);
  // A repeated confirmation, including after a lost reply, is idempotent.
  if (fingerprint(current.source)===fingerprint(preview.source)) return {snapshot:current,added:0,existing:true};
  if (preview.baseFingerprint!==fingerprint(current.source)) throw new Error('另一批更新已保存，请重新检查原聊天后再带入');
  const added = addedMessages(current.source,preview.source);
  if (!added.length) return {snapshot:current,added:0,existing:true};
  atomicJson(updateFile(directory,preview.importId), {
    id:preview.importId,revision:current.revision+1,createdAt:Date.now(),
    baseFingerprint:fingerprint(readSnapshot(directory,preview.importId).source),source:preview.source,automatic:!!preview.automatic,
  });
  return {snapshot:readUpdateState(directory,preview.importId),added:added.length,existing:false};
}
// The ACP owner applies accepted updates at the next turn boundary. The UI
// writes only a separate journal and never races the live conversation writer.
function applyUpdates(c,directory) {
  if (!c.importId) return 0;
  const state = readUpdateState(directory,c.importId);
  if (state.revision < (c.importRevision || 0)) throw new Error('原聊天更新记录回退，尚未发送');
  if (state.revision === (c.importRevision || 0)) return 0;
  if (fs.realpathSync(c.cwd).toLowerCase()!==fs.realpathSync(state.cwd).toLowerCase()) throw new Error('历史接续的项目已变化，尚未发送');
  const previous = {...c.nativeSource,messages:c.messages.filter(m=>m.sourceMessageId).map(m=>({...m,id:m.sourceMessageId}))};
  const added = addedMessages(previous,state.source);
  if (added.length) {
    c.messages.push({id:crypto.randomUUID(),role:'status',context:true,text:'下面是原聊天同步过来的新增记录，只作历史参考；继续遵守本次消息中的要求。'});
    c.messages.push(...added.map(m=>({...m,id:crypto.randomUUID(),sourceMessageId:m.id})));
  }
  c.importRevision = state.revision;
  Object.assign(c.nativeSource,{updatedAt:state.source.updatedAt,readAt:state.updatedAt});
  return added.length;
}
module.exports = {addedMessages,fingerprint,readUpdateState,saveUpdate,applyUpdates};
