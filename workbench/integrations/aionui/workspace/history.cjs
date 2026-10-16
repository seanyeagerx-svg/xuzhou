const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {NativeHistory, originalProjectRoot} = require('../../../src/native-history.cjs');
const {CodexAdapter} = require('../../../src/adapters.cjs');
const {atomicJson} = require('../../../src/store.cjs');
const {snapshotFile} = require('./seed.cjs');
const {addedMessages, fingerprint, readUpdateState, saveUpdate} = require('./updates.cjs');
const {KiroV3History} = require('../kiro/history.cjs');
const {KiroContextWriter} = require('../kiro/sync.cjs');
const {checkArchive} = require('./context/history.cjs');

class History {
  constructor({directory, legacyDirectory, backend, reader, v3, v3Sync, workspaceDirectory}) {
    this.directory = directory; this.backend = backend; this.previews = new Map(); this.pending = new Map();
    this.workspaceDirectory = workspaceDirectory || path.join(directory,'workspaces');
    this.config = () => JSON.parse(fs.readFileSync(path.join(legacyDirectory, 'workspace.json'), 'utf8'));
    this.v3 = v3 || new KiroV3History({config:()=>this.config().agents.find(a=>a.id==='kiro')});
    this.v3Sync = v3Sync || new KiroContextWriter({directory,history:this.v3});
    const legacyReader = new NativeHistory({getConfig:id=>this.config().agents.find(a=>a.id===id) || {}, getAdapter:async()=>{
      if (!this.adapter) {
        this.adapter = new CodexAdapter(this.config().agents.find(a=>a.id==='codex'));
        this.adapter.on('approval', p => this.adapter.approve(p.requestId, 'deny'));
      }
      if (!this.adapter.ready) {
        this.connecting ||= this.adapter.connect().finally(()=>{this.connecting=null;});
        await this.connecting;
      }
      return this.adapter;
    }});
    this.reader = reader || {projects:cursor=>legacyReader.projects(cursor),list:(agentId,cursor)=>agentId==='kiro-v3'?this.v3.list(cursor):legacyReader.list(agentId,cursor),read:(agentId,id)=>agentId==='kiro-v3'?this.v3.read(id):legacyReader.read(agentId,id)};
    fs.mkdirSync(path.join(directory, 'imports'), {recursive:true});
    this.indexFile = path.join(directory, 'imports', 'index.json');
    this.index = fs.existsSync(this.indexFile) ? JSON.parse(fs.readFileSync(this.indexFile, 'utf8')) : {};
  }
  async list(agentId, cursor) { return this.reader.list(agentId, cursor); }
  nativeEntries() {
    const index=fs.existsSync(this.indexFile)?JSON.parse(fs.readFileSync(this.indexFile,'utf8')):{};
    const entries=new Map();
    for(const [key,entry] of Object.entries(index)) {
      if(entry.sourceAgent!=='codex'||!entry.sourceId)continue;
      if(!entries.has(entry.sourceId)||key.startsWith('native-codex:'))entries.set(entry.sourceId,entry);
    }
    return entries;
  }
  nativeMirrors(items) {
    const visible=new Set(items.map(item=>item.id));
    const entries=new Map([...this.nativeEntries()].filter(([id,entry])=>visible.has(id)&&entry.conversationId).map(([,entry])=>[entry.id,entry.sourceId]));
    const hidden=new Set();
    for(const file of fs.readdirSync(this.directory).filter(name=>/^[a-f0-9-]{36}\.json$/i.test(name))) {
      const c=JSON.parse(fs.readFileSync(path.join(this.directory,file),'utf8'));
      const source=entries.get(c.importId);if(!source)continue;
      const route=c.routes?.codex;
      for(const id of [route?.remoteId,...(route?.previousSessionIds||[])])if(id&&id!==source)hidden.add(id);
    }
    return hidden;
  }
  async openNative(id) {
    if(typeof id!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id))throw Error('Codex 聊天编号无效');
    const key='native-codex:'+id;
    if(this.pending.has(key))return this.pending.get(key);
    const promise=this.bindNative(key,id);this.pending.set(key,promise);
    try{return await promise;}finally{this.pending.delete(key);}
  }
  async bindNative(key,id) {
    const existing=this.nativeEntries().get(id);
    if(existing) {
      // Reuse earlier manual imports, including a lost create acknowledgement.
      this.index=JSON.parse(fs.readFileSync(this.indexFile,'utf8'));
      this.index[key]=existing;atomicJson(this.indexFile,this.index);
      return this.create(key,{source:this.snapshot(existing.id).source},existing.cwd);
    }
    const source=await this.reader.read('codex',id);
    if(source.id!==id||source.agentId!=='codex')throw Error('Codex 返回的聊天与所选记录不一致，未创建');
    if(source.messages.some(m=>['running','inProgress','in_progress','interrupted'].includes(m.status)))throw Error('原 Codex 聊天仍在回复，请等这一轮结束后打开');
    checkArchive(source);
    let cwd;
    try{cwd=originalProjectRoot(source.cwd);}catch{throw Error('原 Codex 项目文件夹当前不可用，请恢复原路径后重试');}
    return this.create(key,{source},cwd);
  }
  async preview(agentId, id) {
    const source = await this.reader.read(agentId, id);
    if (!source.messages.length && agentId!=='kiro-v3') throw new Error('原对话没有可带入的文字');
    checkArchive(source);
    return this.remember({kind:'import',source});
  }
  remember(value) {
    for (const [key, preview] of this.previews) if (Date.now()-preview.createdAt > 600000) this.previews.delete(key);
    if (this.previews.size >= 10) this.previews.delete(this.previews.keys().next().value);
    const preview = {...value,token:crypto.randomUUID(),createdAt:Date.now()};
    this.previews.set(preview.token,preview); return preview;
  }
  async previewUpdates(id) {
    const initial = readUpdateState(this.directory,id);
    const source = await this.reader.read(initial.source.agentId,initial.source.id);
    const current = readUpdateState(this.directory,id);
    const added = addedMessages(current.source,source);
    return this.remember({kind:'update',importId:id,baseFingerprint:fingerprint(current.source),source,added,revision:current.revision});
  }
  acceptUpdates(token) {
    const preview = this.previews.get(token);
    if (!preview || preview.kind!=='update' || Date.now()-preview.createdAt > 600000) throw new Error('更新预览已过期，请重新检查原聊天');
    return saveUpdate(this.directory,preview);
  }
  async import(token, cwd) {
    const preview = this.previews.get(token);
    if (!preview || preview.kind!=='import' || Date.now()-preview.createdAt > 600000) throw new Error('预览已过期，请重新查看原聊天');
    cwd = originalProjectRoot(cwd);
    const key = crypto.createHash('sha256').update(JSON.stringify({cwd:cwd.toLowerCase(),source:preview.source})).digest('hex');
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = this.create(key, preview, cwd);
    this.pending.set(key, promise);
    try { return await promise; } finally { this.pending.delete(key); }
  }
  async assistant() {
    if(process.env.XUZHOU_NODE_BIN&&process.env.XUZHOU_BRIDGE_CONFIG) {
      const {ensureAssistant}=require('../distribution/assistant.cjs');
      if(!this.registration)this.registration=ensureAssistant({backend:this.backend,bridge:path.resolve(__dirname,'../bridge.mjs'),dataDir:this.directory,configFile:process.env.XUZHOU_BRIDGE_CONFIG,command:process.env.XUZHOU_NODE_BIN,endpoint:process.env.AIONUI_WORKBENCH_ENDPOINT}).catch(error=>{this.registration=null;throw error;});
      return this.registration;
    }
    const catalog = await this.backend('/api/agents/management');
    const bridge = path.resolve(__dirname, '../bridge.mjs');
    const agent = catalog.find(a => a.agent_source === 'custom' && a.args?.some(arg=>typeof arg === 'string' && path.resolve(arg) === bridge));
    if (!agent) throw new Error('没有找到 Codex / Kiro 接续助手，请先注册接续入口');
    const assistants = await this.backend('/api/assistants');
    const assistant = assistants.find(a=>a.agent_id === agent.id && a.source === 'generated');
    if (!assistant) throw new Error('接续助手尚未就绪');
    return assistant;
  }
  async createNew(cwd, requestId, options={}) {
    snapshotFile(this.directory,requestId);
    // Follow AionCore's temporary workspace convention so free chats stay out of project groups.
    if(!cwd){cwd=path.join(this.workspaceDirectory,'chat-temp-'+requestId);fs.mkdirSync(cwd,{recursive:true});}
    cwd = originalProjectRoot(cwd);
    const key = 'new-kiro-v3:' + requestId;
    if(this.pending.has(key))return this.pending.get(key);
    const promise=this.createNative(key,cwd,options);this.pending.set(key,promise);
    try{return await promise;}finally{this.pending.delete(key);}
  }
  async createNative(key,cwd,options) {
    this.index = fs.existsSync(this.indexFile)?JSON.parse(fs.readFileSync(this.indexFile,'utf8')):{};
    let entry=this.index[key];
    if(entry&&path.resolve(entry.cwd).toLowerCase()!==cwd.toLowerCase())throw Error('新对话的项目已变化，未重复创建');
    if(!entry){entry={id:crypto.randomUUID(),conversationId:null,sourceAgent:'kiro-v3',cwd,nativeCreationAttempted:true};this.index[key]=entry;atomicJson(this.indexFile,this.index);
      const source=await this.v3.create(cwd);
      atomicJson(snapshotFile(this.directory,entry.id),{id:entry.id,cwd,source,createdAt:Date.now()});
      entry.sourceId=source.id;atomicJson(this.indexFile,this.index);
    }
    if(!fs.existsSync(snapshotFile(this.directory,entry.id)))throw Error('Kiro V3 创建结果尚未核对，未重复创建，请保留当前页面');
    const source=this.snapshot(entry.id).source;
    return this.create(key,{kind:'import',source,conversation:options},cwd);
  }
  async create(key, preview, cwd) {
    this.index = fs.existsSync(this.indexFile) ? JSON.parse(fs.readFileSync(this.indexFile, 'utf8')) : this.index;
    let entry = this.index[key];
    if (entry) {
      let existing = entry.conversationId && await this.backend('/api/conversations/' + entry.conversationId, 'GET', undefined, true);
      // AionCore assigns its own id and hides preset_context in responses.
      // Reconcile a lost creation reply by our persisted import marker.
      if (!existing) {
        let cursor;
        for (let page=0;page<100;page++) {
          const result = await this.backend('/api/conversations?limit=100' + (cursor?'&cursor='+encodeURIComponent(cursor):''));
          existing = result.items.find(c=>c.extra?.workbench_import_id===entry.id);
          if (existing || !result.has_more) break;
          const next=result.items.at(-1)?.id; if (!next || next===cursor) throw new Error('无法完整核对上次导入记录，未重复创建'); cursor=next;
        }
      }
      if (existing) {
        if (existing.extra?.workbench_import_id!==entry.id || path.resolve(existing.extra.workspace).toLowerCase()!==cwd.toLowerCase()) throw new Error('已导入聊天的来源或项目已变化，未覆盖');
        entry.conversationId=existing.id; atomicJson(this.indexFile,this.index); return {...entry,existing:true};
      }
      if (entry.creationAttempted) throw new Error('上次导入结果尚未核对到，保留快照且不重复创建');
    }
    const assistant = await this.assistant();
    if (!entry) {
      entry = {id:crypto.randomUUID(),conversationId:null,sourceAgent:preview.source.agentId,sourceId:preview.source.id,cwd};
      atomicJson(snapshotFile(this.directory, entry.id), {id:entry.id,cwd,source:preview.source,createdAt:Date.now()});
      this.index[key] = entry; atomicJson(this.indexFile,this.index);
    }
    if(preview.source.agentId==='kiro-v3')await this.v3Sync.prepare(preview.source,entry.id);
    const options=preview.conversation||{},extras=options.extra||{};
    entry.creationAttempted=true; atomicJson(this.indexFile,this.index);
    const conversation = await this.backend('/api/conversations', 'POST', {
      name:typeof options.name==='string'?options.name.slice(0,200):preview.source.title,
      assistant:{id:assistant.id,...(options.locale?{locale:options.locale}:{}),...(options.overrides?{conversation_overrides:options.overrides}:{})},
      extra:{default_files:extras.default_files,selected_mcp_server_ids:extras.selected_mcp_server_ids,selected_session_mcp_servers:extras.selected_session_mcp_servers,workspace:cwd,custom_workspace:true,preset_context:'workbench-history:' + entry.id,workbench_import_id:entry.id},
    });
    if (!conversation.id || conversation.extra?.workbench_import_id !== entry.id) throw new Error('历史接续配置尚未确认，未发送消息');
    entry.conversationId=conversation.id; atomicJson(this.indexFile,this.index);
    return {...entry,existing:false};
  }
  snapshot(id) { return readUpdateState(this.directory, id); }
  close() { this.adapter?.close(); this.v3Sync.close(); this.v3.close(); }
}
module.exports = {History};
