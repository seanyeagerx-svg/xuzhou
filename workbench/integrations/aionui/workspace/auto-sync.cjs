const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {atomicJson}=require('../../../src/store.cjs');
const {snapshotFile}=require('./seed.cjs');
const {readUpdateState,fingerprint,saveUpdate,addedMessages}=require('./updates.cjs');
const {CodexHistoryWriter}=require('./codex-sync.cjs');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const syncFile=(root,id)=>snapshotFile(root,id).replace(/\.json$/,'.sync.json');
const samePath=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();

const {completedMessages,makeBatch,failure}=require('../../../src/continuity/sync.cjs');
class AutoSync {
  constructor({history,writer,interval=15000,now=Date.now}) {
    this.history=history; this.root=history.directory; this.interval=interval; this.now=now; this.states=new Map(); this.closed=false;
    const codex=new CodexHistoryWriter({directory:this.root,config:()=>history.config().agents.find(a=>a.id==='codex')});
    this.writer=writer || {deliver:(source,batch,enabled,id)=>source.agentId==='kiro-v3'?history.v3Sync.deliver(source,batch,enabled,id):codex.deliver(source,batch,enabled),close(){codex.close();history.v3Sync.close();}};
    this.lock=path.join(this.root,'imports','.auto-sync.lock'); this.token=crypto.randomUUID();
  }
  claim() {
    if(this.owned) return;
    try {fs.writeFileSync(this.lock,JSON.stringify({pid:process.pid,token:this.token}),{flag:'wx'});}
    catch(e) {
      if(e.code!=='EEXIST') throw e;
      const owner=JSON.parse(fs.readFileSync(this.lock,'utf8'));let alive=true;
      try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
      if(alive) throw new Error('自动同步已由另一个窗口接管');
      fs.unlinkSync(this.lock);fs.writeFileSync(this.lock,JSON.stringify({pid:process.pid,token:this.token}),{flag:'wx'});
    }
    this.owned=true;
  }
  entries() {
    const index=JSON.parse(fs.readFileSync(this.history.indexFile,'utf8'));
    return [...new Map(Object.values(index).filter(e=>e.conversationId).map(e=>[e.id,e])).values()];
  }
  state(id) {
    if(this.states.has(id)) return this.states.get(id);
    const snapshot=readUpdateState(this.root,id),file=syncFile(this.root,id);
    const s=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{id,enabled:true,sent:{},inbound:{state:'pending'},outbound:{state:['codex','kiro-v3'].includes(snapshot.source.agentId)?'pending':'unsupported'}};
    if(s.id!==id || typeof s.enabled!=='boolean' || !s.sent || !s.inbound || !s.outbound) throw new Error('自动同步记录不完整，未覆盖');
    s.sourceAgent=snapshot.source.agentId;
    this.states.set(id,s);return s;
  }
  save(s) {if(!this.closed)atomicJson(syncFile(this.root,s.id),s);}
  status(id) {
    const s=this.state(id);
    return {id,enabled:s.enabled,inbound:s.inbound,outbound:s.outbound,snapshot:readUpdateState(this.root,id),error:this.error};
  }
  setEnabled(id,enabled) {
    if(typeof enabled!=='boolean') throw new Error('同步开关无效');
    this.claim(); const s=this.state(id);s.enabled=enabled;
    if(enabled){s.inbound.nextAt=0;s.outbound.nextAt=0;}
    this.save(s);if(enabled)this.schedule(0);return this.status(id);
  }
  start() {
    if(this.closed || this.started)return;this.started=true;
    try {
      this.watcher=fs.watch(this.root,(_event,file)=>{if(file&&/^[a-f0-9-]{36}\.json$/i.test(String(file)))this.request();});
      this.watcher.on('error',()=>{this.watcher?.close();this.watcher=null;});
    } catch { /* The periodic pass remains authoritative on filesystems without watches. */ }
    this.schedule(1000);
  }
  request(delay=120) {
    if(this.closed)return;
    if(this.running){this.dirty=true;return;}
    clearTimeout(this.wakeTimer);
    this.wakeTimer=setTimeout(()=>{void this.tick();},delay);this.wakeTimer.unref?.();
  }
  async retry(id) {
    this.claim();const s=this.state(id);
    if(s.enabled){s.inbound.nextAt=0;s.outbound.nextAt=0;this.save(s);await this.tick();}
    return this.status(id);
  }
  schedule(delay=this.interval) {
    clearTimeout(this.timer);if(this.closed)return;
    this.timer=setTimeout(()=>{void this.tick().finally(()=>this.schedule());},delay);this.timer.unref?.();
  }
  tick() {
    if(this.running)return this.running;
    this.running=this.run().catch(e=>{this.error=String(e.message).slice(0,500);}).finally(()=>{this.running=null;if(this.dirty){this.dirty=false;this.request(0);}});
    return this.running;
  }
  fail(previous,error) {return failure(previous,error,this.now(),this.interval);}
  async incoming(s) {
    const current=readUpdateState(this.root,s.id);
    const source=await this.history.reader.read(current.source.agentId,current.source.id);
    if(this.closed || !s.enabled)return;
    const added=addedMessages(current.source,source),stamp=fingerprint(source);
    if(added.length) {
      const last=source.messages.filter(m=>['user','assistant'].includes(m.role)).at(-1);
      // Two unchanged polls and a completed answer avoid importing a half turn,
      // especially from Kiro's append-only file format without a busy flag.
      // A verified failed V3 terminal turn can end with a submitted user message;
      // no assistant reply is expected, but the same stability checks still apply.
      const failedUserTail=source.agentId==='kiro-v3'&&source.nativeStatus==='failed'&&last?.role==='user';
      if((last?.role!=='assistant'&&!failedUserTail) || s.observed!==stamp || this.now()-(s.observedAt||0)<this.interval) {
        if(s.observed!==stamp){s.observed=stamp;s.observedAt=this.now();}
        s.inbound={...s.inbound,state:'settling',lastCheckedAt:this.now(),nextAt:0};return;
      }
      saveUpdate(this.root,{importId:s.id,source,baseFingerprint:fingerprint(current.source),automatic:true});
    }
    delete s.observed;delete s.observedAt;
    s.inbound={state:'ready',lastCheckedAt:this.now(),lastSuccessAt:this.now(),records:source.messages.length,nextAt:0};
  }
  conversations(id,cwd) {
    return fs.readdirSync(this.root).filter(file=>/^[a-f0-9-]{36}\.json$/.test(file)).map(file=>JSON.parse(fs.readFileSync(path.join(this.root,file),'utf8'))).filter(c=>c.importId===id).map(c=>{
      if(!samePath(c.cwd,cwd))throw new Error('本聊天项目与导入记录不匹配，未回传');return c;
    });
  }
  async outgoing(s,entry) {
    const snapshot=readUpdateState(this.root,s.id);
    if(!['codex','kiro-v3'].includes(snapshot.source.agentId)){s.outbound={state:'unsupported'};return;}
    const cs=this.conversations(s.id,snapshot.cwd);
    if(cs.length>1) throw new Error('同一导入来源对应多个本地会话，未回传');
    if(cs.some(c=>c.status==='running')){s.outbound={...s.outbound,state:'settling',nextAt:0};return;}
    const messages=cs.flatMap(completedMessages);
    // Validate an in-flight batch against the immutable completed local text.
    if(s.pending && s.pending.messages.some(m=>!messages.some(n=>n.key===m.key && hash(n)===hash(m)))) throw new Error('待回传的本聊天记录被改写，未覆盖原聊天');
    const fresh=makeBatch(s.id,messages,s.sent),batch=s.pending||fresh;
    if(!batch){s.outbound={...s.outbound,state:'ready',records:Object.keys(s.sent).length,nextAt:0,detail:undefined};return;}
    const chat=await this.history.backend('/api/conversations/'+encodeURIComponent(entry.conversationId),'GET',undefined,true);
    if(!chat || chat.extra?.workbench_import_id!==s.id || !samePath(chat.extra.workspace||'',snapshot.cwd))throw new Error('原导入聊天已删除或来源不匹配，未回传');
    if(this.closed || !s.enabled)return;
    s.pending=batch;s.outbound={...s.outbound,state:'sending',pending:batch.messages.length};this.save(s);
    await this.writer.deliver(snapshot.source,batch,()=>!this.closed&&s.enabled,s.id);
    // A pause cannot undo an acknowledged in-flight write. Persist its receipt
    // so that re-enabling/restarting never exports it twice.
    for(const m of batch.messages)s.sent[m.key]=hash(m);
    delete s.pending;
    s.outbound={state:'ready',records:Object.keys(s.sent).length,lastSuccessAt:this.now(),nextAt:0};
  }
  async run() {
    if(this.closed)return;this.claim();this.error=undefined;
    if(!fs.existsSync(this.history.indexFile))return;
    for(const entry of this.entries()) {
      if(this.closed)break;
      let s;try{s=this.state(entry.id);}catch(e){this.error=String(e.message).slice(0,500);continue;}
      if(!s.enabled)continue;
      if((s.inbound.nextAt||0)<=this.now())try{await this.incoming(s);}catch(e){s.inbound=this.fail(s.inbound,e);}
      this.save(s);
      if(this.closed || !s.enabled)continue;
      // A changed source prefix must be resolved before writing back.
      if(!['ready','settling'].includes(s.inbound.state)) {
        if(['codex','kiro-v3'].includes(s.sourceAgent))s.outbound={...s.outbound,state:s.inbound.state==='conflict'?'conflict':'waiting',detail:'原聊天尚未核对成功，回传等待自动重试',nextAt:0};
      } else if((s.outbound.nextAt||0)<=this.now())try{await this.outgoing(s,entry);}catch(e){s.outbound=this.fail(s.outbound,e);}
      this.save(s);
    }
  }
  async close() {
    this.closed=true;clearTimeout(this.timer);clearTimeout(this.wakeTimer);this.watcher?.close();this.writer.close();await this.running;
    if(this.owned && fs.existsSync(this.lock) && JSON.parse(fs.readFileSync(this.lock,'utf8')).token===this.token)fs.unlinkSync(this.lock);
    this.owned=false;
  }
}
module.exports={AutoSync,makeBatch,completedMessages};
