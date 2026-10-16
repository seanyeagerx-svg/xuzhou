const fs = require('node:fs');
const path = require('node:path');
const {Companion, completedMessages} = require('../../../src/companion.cjs');
const {atomicJson} = require('../../../src/store.cjs');
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const samePath = (a,b) => typeof a === 'string' && typeof b === 'string' && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** Adapts the existing companion to canonical unified chats; renderer text is never trusted as history. */
class ChatCompanion {
  constructor({directory,sessionsDirectory,backend,lobster}) {
    Object.assign(this,{directory,sessionsDirectory,backend,lobster});
    this.file=path.join(directory,'companion.json');this.sources=new Map();
    const value=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{companion:{chats:{}}};
    if(!value.companion?.chats || Array.isArray(value.companion.chats))throw Error('小龙虾旁听记录损坏，已保留原文件');
    this.core=new Companion({store:{value,save:()=>atomicJson(this.file,value)},getSource:id=>this.sources.get(id),transport:{
      gateway:()=>lobster.gatewayConfig().url,
      prepare:async(source,run)=>{
        const latest=await this.refresh(source.id);
        if(!latest || latest.canonicalId!==source.canonicalId || !samePath(latest.cwd,source.cwd))throw Error('当前聊天来源已变化，未发送旁听资料');
        if(!lobster.gateway.ready){
          if(run.automatic)throw Error('龙虾尚未连接，自动旁听已等待；主对话可以继续。');
          await lobster.connectGateway();
        }
        await lobster.gateway.newSession(source.cwd,null,run.remoteId);
      },
      send:(_source,run,prompt)=>lobster.gateway.report(run.remoteId,prompt,run.id),
      history:run=>lobster.gateway.history(run.remoteId,run.id),
      cancel:async run=>{if(lobster.gateway.ready&&lobster.gateway.sessions.has(run.remoteId))await lobster.gateway.cancel(run.remoteId);}
    }});
    this.listener=event=>this.core.event(event);lobster.gateway.on('event',this.listener);
    this.timer=setInterval(()=>void this.tick(),5000);this.timer.unref?.();
  }
  async refresh(id) {
    if(typeof id!=='string'||!/^[-\w]{1,128}$/.test(id))throw Error('聊天编号无效');
    const chat=await this.backend('/api/conversations/'+encodeURIComponent(id),'GET',undefined,true);
    if(!chat){this.sources.delete(id);return null;}
    const extra=chat.extra||{};
    let candidates=[];
    if(uuid(extra.acp_session_id)){
      const file=path.join(this.sessionsDirectory,extra.acp_session_id+'.json');
      if(fs.existsSync(file))candidates=[JSON.parse(fs.readFileSync(file,'utf8'))];
    }
    if(!candidates.length&&uuid(extra.workbench_import_id)){
      candidates=fs.readdirSync(this.sessionsDirectory).filter(f=>uuid(f.slice(0,-5))&&f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync(path.join(this.sessionsDirectory,f),'utf8'))).filter(c=>c.importId===extra.workbench_import_id);
    }
    if(candidates.length>1)throw Error('聊天对应多个接续记录，旁听已暂停');
    const canonical=candidates[0];
    if(canonical&&(!samePath(canonical.cwd,extra.workspace)||!uuid(canonical.id)||!Array.isArray(canonical.messages)))throw Error('聊天项目与接续记录不一致，旁听已暂停');
    if(!canonical){this.sources.delete(id);return null;}
    const source={...canonical,id,canonicalId:canonical.id,title:chat.name||id,archived:chat.archived===true};
    this.sources.set(id,source);return source;
  }
  snapshot(id,source) {
    return {available:true,ready:!!source,conversationId:id,title:source?.title||'',gatewayConnected:this.lobster.gateway.ready,
      sourceCount:source?completedMessages(source).length:0,
      entry:this.core.data.chats[id]||{mode:'off',intervalMinutes:5,status:'idle',notes:[]}};
  }
  async call(action,data={}) {
    const id=data.conversationId,source=await this.refresh(id);
    if(action==='companion-state')return this.snapshot(id,source);
    if(!source)throw Error('请先在统一聊天中完成一轮回复，再叫小龙虾');
    if(action==='companion-configure')await this.core.configure(id,{mode:data.mode,intervalMinutes:data.intervalMinutes});
    else if(action==='companion-request')await this.core.request(id,{kind:data.kind,question:data.question});
    else if(action==='companion-cancel')await this.core.cancel(id);
    else if(action==='companion-read')this.core.read(id);
    else throw Error('未知小龙虾操作');
    return this.snapshot(id,this.sources.get(id));
  }
  async tick() {
    if(this.ticking||this.closed)return;this.ticking=true;
    try {
      for(const [id,entry]of Object.entries(this.core.data.chats)){
        if(entry.mode==='off'&&!entry.run)continue;
        try {
          const source=await this.refresh(id);
          if(!source||source.archived)throw Error('原聊天不可用，旁听已暂停');
        } catch(error) {
          const run=entry.run;
          if(run){this.core.fail(entry,run,error);await this.core.transport.cancel(run).catch(()=>{});}
          entry.mode='off';entry.error=error.message;entry.status='error';this.sources.delete(id);this.core.changed();
        }
      }
      await this.core.tick();
    } catch { /* Transient read errors never trigger generation or change main chat data. */ }
    finally{this.ticking=false;}
  }
  async close() {
    this.closed=true;clearInterval(this.timer);this.core.stop();
    for(const entry of Object.values(this.core.data.chats))if(entry.run){
      const run=entry.run;this.core.fail(entry,run,new Error('工作台已关闭，本次整理中断'),'interrupted');
      await this.core.transport.cancel(run).catch(()=>{});
    }
    this.lobster.gateway.removeListener('event',this.listener);
  }
}
module.exports={ChatCompanion};
