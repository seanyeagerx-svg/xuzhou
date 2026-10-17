const {AcpAdapter,sessionServers}=require('../../../src/adapters.cjs');
const path=require('node:path');
const samePath=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
function v3Config(config) {
  if(!config?.command)throw Error('没有找到本机 Kiro 连接配置');
  return {...config,id:'kiro-v3',name:'Kiro V3',type:'acp',args:['acp','--agent-engine=v3']};
}
function choices(option) {
  return (option?.options||[]).flatMap(o=>Array.isArray(o.options)?o.options:[o]).filter(o=>typeof o.value==='string').map(o=>({id:o.value,name:o.name||o.value,description:o.description}));
}
function sessionOptions(reply,previous={}) {
  const config=[...new Map([...(previous.configOptions||[]),...(reply.configOptions||[])].map(o=>[o.id,o])).values()];
  const model=config.find(o=>o.category==='model'||o.id==='model');
  const effort=config.find(o=>o.category==='thought_level'||o.id==='effortLevel');
  const mode=config.find(o=>o.category==='mode'||o.id==='mode');
  const efforts=choices(effort);
  return {model:model?.currentValue,models:choices(model).map(m=>({...m,...(m.id===model.currentValue?{efforts}:{})})),
    effort:efforts.length?effort.currentValue:null,efforts,modelConfig:model?.id,effortConfig:effort?.id,
    modes:choices(mode),mode:mode?.currentValue,configOptions:config,apply:'acknowledged'};
}
class KiroV3Adapter extends AcpAdapter {
  constructor(config){super(v3Config(config));this.earlyOptions=new Map();}
  async newSession(cwd,model,remoteId,conversationId) {
    if(!this.ready)await this.connect(cwd);
    if(!this.info.agentCapabilities?.sessionCapabilities?.list)throw Error('Kiro V3 会话接口未就绪');
    const r=await this.rpc.request(remoteId?'session/load':'session/new',{cwd,mcpServers:sessionServers(this,conversationId),...(remoteId?{sessionId:remoteId}:{})},60000);
    const id=r.sessionId||remoteId;
    if(!id)throw Error('Kiro V3 未返回会话编号');
    if(remoteId&&(r._meta?.id!==id||!r._meta?.workspacePaths?.some(p=>samePath(p,cwd))))throw Error('Kiro V3 会话编号或项目不匹配');
    this.sessions.set(id,{busy:false,cwd,options:sessionOptions({configOptions:this.earlyOptions.get(id)||[]},sessionOptions(r))});
    this.earlyOptions.delete(id);
    if(!this.sessions.get(id).options.models.length){
      await new Promise((resolve,reject)=>{
        const listener=e=>{if(e.sessionId===id&&this.sessionOptions(id)?.models.length){cleanup();resolve();}};
        const timer=setTimeout(()=>{cleanup();reject(Error('Kiro V3 尚未提供模型列表，请刷新模型后重试'));},15000);
        const cleanup=()=>{clearTimeout(timer);this.off('event',listener);};this.on('event',listener);
        listener({sessionId:id});
      });
    }
    if(model&&model!==this.sessions.get(id).options.model)await this.setSessionOption(id,'model',model);
    return {id,model:this.sessions.get(id).options.model,options:this.sessionOptions(id)};
  }
  async setSessionOption(id,key,value) {
    const s=this.sessions.get(id);if(!s)throw Error('Kiro V3 会话尚未加载');if(s.busy)throw Error('当前任务仍在执行');
    const options=key==='model'?s.options.models:key==='effort'?s.options.efforts:[];
    const configId=key==='model'?s.options.modelConfig:s.options.effortConfig;
    if(!configId||!options.some(o=>o.id===value))throw Error('Kiro V3 未提供此配置选项');
    const r=await this.rpc.request('session/set_config_option',{sessionId:id,configId,value});
    s.options=sessionOptions(r,s.options);
    if(s.options[key]!==value)throw Error('Kiro V3 尚未确认配置变更');
    return this.sessionOptions(id);
  }
  notification(message) {
    if(message.method!=='session/update')return;
    const p=message.params||{},s=this.sessions.get(p.sessionId),u=p.update||{};
    if(!s){if(u.sessionUpdate==='config_option_update'&&typeof p.sessionId==='string'){if(!this.earlyOptions.has(p.sessionId)&&this.earlyOptions.size>=100)this.earlyOptions.delete(this.earlyOptions.keys().next().value);const previous=this.earlyOptions.get(p.sessionId)||[];this.earlyOptions.set(p.sessionId,sessionOptions(u,sessionOptions({configOptions:previous})).configOptions);}return;}
    if(u._meta?.kiro?.replay)return;
    if(u.sessionUpdate==='config_option_update'){
      s.options=sessionOptions(u,s.options);this.emitEvent(p.sessionId,{type:'session-options',options:this.sessionOptions(p.sessionId)});return;
    }
    // Only the prompt response settles V3 turns; lifecycle notices are not final.
    if(['TurnEnd','turn_end','session_info_update'].includes(u.sessionUpdate))return;
    if(u.sessionUpdate==='agent_message_chunk'){
      this.emitEvent(p.sessionId,{type:'delta',text:u.content?.text||'',itemId:u._meta?.kiro?.messageId||u.messageId});return;
    }
    super.notification(message);
  }
  async release(id) {
    if(this.ready&&this.sessions.has(id))await this.rpc.request('session/close',{sessionId:id});
    this.sessions.delete(id);
  }
}
module.exports={KiroV3Adapter,v3Config,sessionOptions,samePath};
