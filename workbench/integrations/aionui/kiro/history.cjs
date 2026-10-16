const {StdioRpc}=require('../../../src/rpc.cjs');
const {v3Config,samePath}=require('./adapter.cjs');
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(id);
function transcript(updates,sessionId) {
  const messages=[],byId=new Map();
  for(const u of updates){
    if(!['user_message_chunk','agent_message_chunk'].includes(u.sessionUpdate))continue;
    const meta=u._meta?.kiro||{},role=u.sessionUpdate==='user_message_chunk'?'user':'assistant';
    if(!meta.messageId||!meta.timestamp)throw Error('Kiro V3 回放缺少稳定的消息编号或时间，未合并');
    const text=u.content?.type==='text'?u.content.text:'[附件未带入；请在原 Kiro 中查看。]';
    if(!text)continue;
    const id='kiro-v3:'+sessionId+':'+meta.messageId;
    const existing=byId.get(id);
    if(existing){if(existing.role!==role)throw Error('Kiro V3 消息编号重复');existing.text+=text;}
    else {const value={id,role,text,createdAt:Date.parse(meta.timestamp)||0,status:'completed',...(role==='assistant'?{agentId:'kiro-v3',agentName:'Kiro V3'}:{})};messages.push(value);byId.set(id,value);}
  }
  return messages;
}
class KiroV3History {
  constructor({config,rpcFactory}){this.config=config;this.makeRpc=rpcFactory||((c,cwd)=>new StdioRpc(c.command,c.args,{cwd,env:c.env}));this.active=new Set();this.closed=false;}
  async connect(cwd) {
    if(this.closed)throw Error('Kiro V3 连接已关闭');
    const rpc=this.makeRpc(v3Config(this.config()),cwd);this.active.add(rpc);
    rpc.on('request',m=>m.method==='session/request_permission'?rpc.respond(m.id,{outcome:{outcome:'cancelled'}}):rpc.reject(m.id));
    try{const info=await rpc.request('initialize',{protocolVersion:1,clientInfo:{name:'aionui-kiro-sync',version:'1.0.0'},clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false}},45000);
      if(!info.agentCapabilities?.loadSession||!info.agentCapabilities?.sessionCapabilities?.list||!info.agentCapabilities?.sessionCapabilities?.close)throw Error('Kiro V3 尚未提供所需会话接口');
      rpc.kiroExtensions=info.agentCapabilities?._meta?.kiro?.extensionMethods||[];return rpc;
    }catch(e){this.dispose(rpc);throw e;}
  }
  dispose(rpc){rpc.close();this.active.delete(rpc);}
  async catalog(rpc,cursor){
    const r=await rpc.request('session/list',{...(cursor?{cursor}:{}),_meta:{kiro:{sessionSource:'local',listScope:'both'}}});
    if(!Array.isArray(r.sessions)||r._meta?.kiro?.warnings?.length)throw Error('Kiro V3 未返回完整的本机会话列表');
    return r;
  }
  item(s){
    const meta=s._meta?.kiro||{};
    if(meta.source!=='local'||meta.executionTarget?.kind!=='local'||!validId(s.sessionId))return null;
    return {id:s.sessionId,agentId:'kiro-v3',engine:'v3',title:s.title||'Kiro V3',cwd:s.cwd,updatedAt:Date.parse(s.updatedAt)||0,nativeStatus:meta.status};
  }
  async find(rpc,id){
    if(!validId(id))throw Error('Kiro V3 原会话编号无效');
    let cursor;const seen=new Set();
    for(let page=0;page<100;page++){
      const r=await this.catalog(rpc,cursor),item=r.sessions.map(s=>this.item(s)).find(s=>s?.id===id);if(item)return item;
      if(!r.nextCursor)break;if(seen.has(r.nextCursor))throw Error('Kiro V3 分页游标重复');cursor=r.nextCursor;seen.add(cursor);
    }
    throw Error('没有找到指定的本机 Kiro V3 会话，原记录未改动');
  }
  async list(cursor){const rpc=await this.connect();try{const r=await this.catalog(rpc,cursor);return {items:r.sessions.map(s=>this.item(s)).filter(Boolean),nextCursor:r.nextCursor||null,detail:'Kiro V3 本机会话'};}finally{this.dispose(rpc);}}
  async withSession(source,fn){
    const rpc=await this.connect(source.cwd);let loaded=false;
    try{
      const found=await this.find(rpc,source.id);
      if(source.agentId!=='kiro-v3'||!samePath(found.cwd,source.cwd))throw Error('Kiro V3 原会话或项目不匹配');
      // Xuzhou 2026-10-16: failed is a terminal state with readable replay, verified against the native CLI.
      if(!['idle','failed'].includes(found.nativeStatus))throw Error('原 Kiro V3 聊天正在回复，稍后自动重试');
      const updates=[];let size=0;
      const onUpdate=m=>{if(m.method==='session/update'&&m.params?.sessionId===source.id){size+=JSON.stringify(m.params.update).length;if(size<=8*1024*1024)updates.push(m.params.update);}};
      rpc.on('notification',onUpdate);
      const response=await rpc.request('session/load',{sessionId:source.id,cwd:source.cwd,mcpServers:[]},60000);loaded=true;
      rpc.off('notification',onUpdate);
      if(size>8*1024*1024)throw Error('Kiro V3 回放超过接续容量，未截断');
      if(response._meta?.id!==source.id||response._meta?.source!=='local'||!response._meta?.workspacePaths?.some(p=>samePath(p,source.cwd)))throw Error('Kiro V3 加载后的会话身份不匹配');
      return await fn(rpc,response,updates,found);
    }finally{try{if(loaded&&!rpc.closed)await rpc.request('session/close',{sessionId:source.id});}finally{this.dispose(rpc);}}
  }
  async read(id){
    const rpc=await this.connect();let found;try{found=await this.find(rpc,id);}finally{this.dispose(rpc);}
    return this.withSession(found,async(_r,response,updates)=>({...found,updatedAt:Date.parse(response._meta.lastModifiedAt)||found.updatedAt,messages:transcript(updates,id)}));
  }
  async create(cwd){
    const rpc=await this.connect(cwd);let id;
    try{const r=await rpc.request('session/new',{cwd,mcpServers:[]},60000);id=r.sessionId;if(!validId(id))throw Error('Kiro V3 未返回有效会话编号');
      return {id,agentId:'kiro-v3',engine:'v3',title:'Kiro V3 · 双向同步',cwd,updatedAt:Date.now(),messages:[]};
    }finally{try{if(id)await rpc.request('session/close',{sessionId:id});}finally{this.dispose(rpc);}}
  }
  async context(rpc,id){
    if(!rpc.kiroExtensions.includes('_kiro/session/context'))throw Error('Kiro V3 未提供上下文同步接口');
    const r=await rpc.request('_kiro/session/context',{sessionId:id,subcommand:'show'});
    if(!r.success||!Array.isArray(r.entries))throw Error('无法核对 Kiro V3 同步附件');return r;
  }
  close(){this.closed=true;for(const rpc of this.active)this.dispose(rpc);}
}
module.exports={KiroV3History,transcript,validId};
