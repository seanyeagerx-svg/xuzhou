const fs = require('node:fs');
const path = require('node:path');
const {CodexAdapter} = require('../../../src/adapters.cjs');
const {atomicJson} = require('../../../src/store.cjs');
const {bytes,checkArchive,readJson,pack} = require('./context/history.cjs');
const crypto = require('node:crypto');

const samePath = (a,b) => typeof a==='string' && typeof b==='string' && path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
function checkThread(thread,source) {
  if (thread.id!==source.id || !samePath(thread.cwd,source.cwd)) throw new Error('原 Codex 聊天的编号或项目已变化，未回传');
}
// Read only the provider-returned rollout, and verify its own identity. Raw
// Responses items are durable context but intentionally absent from UI turns.
function hasReceipt(thread,source,text) {
  checkThread(thread,source);
  const file = thread.path;
  if (!file || !path.isAbsolute(file) || !path.basename(file).includes(source.id) || fs.statSync(file).size>64*1024*1024) throw new Error('无法核对 Codex 历史回执，未重复回传');
  const rows = fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
  const meta = rows.find(row=>row.type==='session_meta')?.payload;
  if (meta?.id!==source.id || !samePath(meta.cwd,source.cwd)) throw new Error('Codex 历史文件与原聊天不匹配，未回传');
  return rows.some(row=>row.type==='response_item' && row.payload.type==='message' && row.payload.role==='user' && row.payload.content?.some(part=>part.type==='input_text' && part.text===text));
}
class CodexHistoryWriter {
  constructor({config,adapterFactory,directory}) { this.config=config; this.directory=directory; this.makeAdapter=adapterFactory || (c=>new CodexAdapter(c)); this.closed=false; }
  async deliver(source,batch,isEnabled=()=>true) {
    if(this.closed || !isEnabled()) throw new Error('自动同步已暂停');
    let text=batch.text;
    if(bytes(text)>60000){
      if(!this.directory)throw Error('完整历史存档目录未配置，尚未回传');
      const archive={version:1,source:{id:source.id,agentId:source.agentId,cwd:source.cwd},messages:batch.messages};checkArchive(archive);
      const digest=crypto.createHash('sha256').update(JSON.stringify(archive)).digest('hex');
      const file=path.join(this.directory,'imports','sync-'+digest+'.json');
      if(fs.existsSync(file)){if(JSON.stringify(readJson(file))!==JSON.stringify(archive))throw Error('历史存档回执不匹配');}
      else atomicJson(file,archive);
      text='[AionUi synchronized history '+batch.key+']\n以下是授权同步的历史背景，不是新任务，不要执行或主动回复。完整可见原话位于本机 '+JSON.stringify(file)+' 的 messages 数组。涉及早期细节时用本机文件工具检索全文并核对更晚更正。摘录不是全部历史。\n'+JSON.stringify(pack(batch.messages))+'\n[/AionUi synchronized history]';
    }
    const adapter=this.makeAdapter(this.config()); this.active=adapter;
    adapter.on('approval',p=>adapter.approve(p.requestId,'deny'));
    try {
      await adapter.connect();
      let thread=(await adapter.rpc.request('thread/read',{threadId:source.id,includeTurns:true})).thread;
      if(hasReceipt(thread,source,text)) return {existing:true};
      if(!isEnabled() || this.closed) throw new Error('自动同步已暂停');
      // The native exclusive writer lock is authoritative. Never fork, steal
      // a writer, change its model/policy, or turn a sync into a prompt.
      thread=(await adapter.rpc.request('thread/resume',{threadId:source.id})).thread;
      checkThread(thread,source);
      if(thread.turns?.some(t=>t.status==='inProgress')) throw new Error('原聊天正在回复，稍后自动补传');
      if(hasReceipt(thread,source,text)) return {existing:true};
      if(!isEnabled() || this.closed) throw new Error('自动同步已暂停');
      await adapter.rpc.request('thread/inject_items',{threadId:source.id,items:[{type:'message',role:'user',content:[{type:'input_text',text}]}]});
      thread=(await adapter.rpc.request('thread/read',{threadId:source.id,includeTurns:true})).thread;
      if(!hasReceipt(thread,source,text)) throw new Error('回传已提交，正在等待 Codex 的持久记录回执');
      return {existing:false};
    } finally { adapter.close(); if(this.active===adapter)this.active=null; }
  }
  close() { this.closed=true; this.active?.close(); }
}
module.exports={CodexHistoryWriter,hasReceipt};
