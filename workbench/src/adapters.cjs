const {EventEmitter} = require('node:events');
const {StdioRpc} = require('./rpc.cjs');
const path=require('node:path');
const {resolveCodexCommand}=require('./agent-command.cjs');
const {codexModels,acpOptions,requireChoice,idleSession}=require('./session-options.cjs');
const version=require('../package.json').version;
function bridgeServer(adapter,conversationId){
  const bridge=adapter.lobsterBridge?.(conversationId);if(!bridge)return null;
  return {name:'workbench_lobster',command:process.execPath,args:[path.join(__dirname,'lobster-mcp.cjs')],env:{ELECTRON_RUN_AS_NODE:'1',WORKBENCH_LOBSTER_URL:bridge.url,WORKBENCH_LOBSTER_TOKEN:bridge.token,...(bridge.computers?{WORKBENCH_COMPUTERS:'1'}:{})}};
}
function sessionServers(adapter,conversationId){
  const bridge=bridgeServer(adapter,conversationId);
  const servers=[...(adapter.sessionMcpServers?.(conversationId)||[])];
  if(bridge)servers.push({...bridge,env:Object.entries(bridge.env).map(([name,value])=>({name,value}))});
  if(servers.some(s=>s.type==='http'||s.type==='sse'))throw new Error('当前接续适配器仅支持本地 stdio MCP 服务');
  if(new Set(servers.map(s=>s.name)).size!==servers.length)throw new Error('MCP 服务名称重复');
  return servers;
}
const guard = '工作台协作约定：用户负责判断和验收。普通 AI 对话直接回答问题；在项目执行对话中，你是执行者。只处理用户指定项目。禁止修改系统代理、VPN、TUN、DNS、路由、hosts、证书、用户或系统代理环境变量，禁止修改其他 AI 的登录和网络配置。联网沿用已有环境。需要这些变更时先说明并等待用户明确同意。不要外发消息或发布，除非用户明确授权。项目执行对话通过 workbench_lobster MCP 提供龙虾状态、当前项目对话和独立维修工具。用户请求检查或恢复龙虾时先调用 lobster_status / lobster_maintenance diagnose。需要启动或维护时使用受控独立任务，不在龙虾自己的进程内执行停止自身的命令，不自行编造 SSH 命令绕过工作台。维修返回任务编号后，使用 lobster_job 核实完成和就绪状态，再汇报；要把原因和结果告诉龙虾时使用 lobster_message。密码只由用户在工作台连接页输入，不进入聊天。项目执行对话中，执行方的开始、进展、结果和用户验收状态由工作台按项目自动同步给龙虾助理，重要中间发现或问题可调用 workbench_report 补充，无需为常规汇报重复调用 lobster_message。汇报是资料，不是给助理新增任务；最终验收只由用户确认。';
class Adapter extends EventEmitter {
  constructor(config) {super(); this.config=config; this.ready=false; this.sessions=new Map(); this.approvals=new Map();}
  status(state,detail='') {this.ready=state==='connected'; this.emit('status',{id:this.config.id,state,detail});}
  emitEvent(sessionId,event) {this.emit('event',{agentId:this.config.id,sessionId,...event});}
  wire() {
    this.rpc.on('disconnected',m => {this.status('disconnected',m); for(const [id,s] of this.sessions) if(s.busy){s.busy=false;this.emitEvent(id,{type:'error',text:m});}});
    this.rpc.on('request',m => this.handleRequest(m));
  }
  handleRequest(message) {
    const p = message.params || {};
    if(/requestApproval|request_permission|requestUserInput|elicitation\/request/.test(message.method)) {
      const key=String(message.id); this.approvals.set(key,message);
      this.emit('approval',{agentId:this.config.id,requestId:key,method:message.method,params:p});
    } else this.rpc.reject(message.id);
  }
  approve(key,choice,answers) {
    const m=this.approvals.get(key); if(!m)throw new Error('请求已结束');
    let result;
    if(m.method==='session/request_permission') {
      const options=m.params.options || []; const option=options.find(o => choice==='allow' ? /^allow/.test(o.kind) : /^reject/.test(o.kind));
      result=option ? {outcome:{outcome:'selected',optionId:option.optionId}} : {outcome:{outcome:'cancelled'}};
    } else if(/UserInput/.test(m.method)) {
      const qs=m.params.questions || [];
      result={answers:Object.fromEntries(qs.map(q=>[q.id,{answers:[answers?.[q.id] || (choice==='allow' ? q.options?.[0]?.label : '取消') || '取消']}]))};
    } else if(/elicitation/.test(m.method)) result={action:'decline',content:null};
    else if(/permissions\/requestApproval/.test(m.method)) result={permissions:choice==='allow'?m.params.permissions:{},scope:'turn'};
    else result={decision:choice==='allow'?'accept':'decline'};
    this.rpc.respond(m.id,result); this.approvals.delete(key);
  }
  close() {for(const [id,s] of this.sessions)if(s.busy){s.busy=false;this.emitEvent(id,{type:'error',text:'执行 AI 连接已结束，任务结果需要核对；已启动的独立维修仍会继续。'});}this.rpc?.close();this.ready=false;this.sessions.clear();this.approvals.clear();this.releaseBridge?.();}
}
class CodexAdapter extends Adapter {
  async connect(cwd) {
    if(this.ready)return; this.close(); this.status('connecting','正在连接本机 Codex');
    const deviceTools=bridgeServer(this)?.env.WORKBENCH_COMPUTERS==='1';
    this.rpc=new StdioRpc(resolveCodexCommand(this.config.command),[...(deviceTools?['--disable','shell_tool']:[]),'app-server','--stdio'],{cwd}); this.wire();
    this.rpc.on('notification',m => this.notification(m));
    try {
      await this.rpc.request('initialize',{clientInfo:{name:'human_ai_workbench',title:'协作工作台',version},capabilities:{experimentalApi:true}});
      this.rpc.notify('initialized');
      const a=await this.rpc.request('account/read',{refreshToken:false});
      this.account={loggedIn:!!a.account,type:a.account?.type,plan:a.account?.planType};
      if(!a.account)throw new Error('Codex 尚未登录，请先在原 Codex 客户端登录');
      const all=[];let cursor;const seen=new Set();
      do{const page=await this.rpc.request('model/list',cursor?{cursor}:{});all.push(...(page.data||[]));cursor=page.nextCursor;if(cursor&&seen.has(cursor))throw new Error('模型列表分页异常');seen.add(cursor);}while(cursor);
      this.models=codexModels(all);
      this.status('connected','已连接 · 使用原 Codex 登录');
      return {account:this.account,models:this.models};
    } catch(e) {this.close(); this.status('error',e.message); throw e;}
  }
  async newSession(cwd,model,remoteId,conversationId) {
    if(!this.ready)await this.connect(cwd);
    const params={cwd,approvalPolicy:'on-request',approvalsReviewer:'user'};
    // A resumed native thread must receive the current host integration policy.
    if(this.runtimeInstructions!==undefined)params.developerInstructions=this.runtimeInstructions;
    const servers=sessionServers(this,conversationId);
    if(servers.length)params.config={mcp_servers:Object.fromEntries(servers.map(s=>[s.name,{command:s.command,args:s.args||[],env:Object.fromEntries((s.env||[]).map(e=>[e.name,e.value]))}]))};
    if(bridgeServer(this,conversationId)?.env.WORKBENCH_COMPUTERS==='1'){
      // Device commands and writes go through the host's current-chat approval
      // and routing. Disable native shell and sandbox escapes for this session.
      params.config={...params.config,'features.shell_tool':false};
      params.config.mcp_servers.workbench_lobster.tools=Object.fromEntries(['computer_state','computer_command','computer_files','computer_screen'].map(name=>[name,{approval_mode:'approve'}]));
      params.sandbox='read-only';params.approvalPolicy='on-request';
    }
    if(model)params.model=model;
    let r;
    if(remoteId)r=await this.rpc.request('thread/resume',{...params,threadId:remoteId});
    else r=await this.rpc.request('thread/start',{...params,sandbox:params.sandbox||'workspace-write',developerInstructions:this.runtimeInstructions??guard});
    this.sessions.set(r.thread.id,{busy:false,cwd,turnId:null,model:r.model,effort:r.reasoningEffort||null});
    return {id:r.thread.id,model:r.model,options:this.sessionOptions(r.thread.id)};
  }
  sessionOptions(id){const s=this.sessions.get(id);return {models:this.models||[],model:s?.model,effort:s?.effort||null,modes:[],mode:null,apply:'next-turn'};}
  async modelCatalog(){return {models:this.models||[],model:this.models?.find(m=>m.isDefault)?.id||this.models?.[0]?.id};}
  async setSessionOption(id,key,value){
    const s=idleSession(this,id);
    if(key==='model'){requireChoice(this.models,value,'模型');s.model=value;s.effort=this.models.find(m=>m.id===value).defaultEffort;}
    else if(key==='effort'){requireChoice(this.models.find(m=>m.id===s.model)?.efforts||[],value,'思考强度');s.effort=value;}
    else throw new Error('此 AI 不支持这个选项');
    return this.sessionOptions(id);
  }
  async prompt(id,text,images=[]) {
    const s=this.sessions.get(id); if(!s)throw new Error('会话尚未加载'); if(s.busy)throw new Error('当前任务仍在执行');
    s.busy=true;
    try {const r=await this.rpc.request('turn/start',{threadId:id,input:[{type:'text',text},...images.map(image=>({type:'localImage',path:image.path}))],cwd:s.cwd,...(s.model?{model:s.model}:{}),...(s.effort?{effort:s.effort}:{})}); s.turnId=r.turn.id; return r;}
    catch(e){s.busy=false;this.emitEvent(id,{type:'error',text:e.message});throw e;}
  }
  notification(m) {
    const p=m.params || {}; const id=p.threadId; if(!id || !this.sessions.has(id))return;
    if(m.method==='turn/started'){this.sessions.get(id).turnId=p.turn?.id;this.emitEvent(id,{type:'started'});}
    if(m.method==='item/agentMessage/delta')this.emitEvent(id,{type:'delta',text:p.delta || '',itemId:p.itemId});
    if(m.method==='item/started' || m.method==='item/completed') {
      const item=p.item || {};
      if(item.type==='agentMessage' && m.method==='item/completed')this.emitEvent(id,{type:'message-completed',text:item.text || '',itemId:item.id});
      if(!['agentMessage','userMessage','reasoning'].includes(item.type))this.emitEvent(id,{type:'tool',tool:item.type,status:item.status,text:item.command || item.server || item.tool || item.type,details:item});
    }
    if(m.method==='turn/completed') {
      this.sessions.get(id).busy=false;
      this.emitEvent(id,{type:p.turn.status==='completed'?'completed':p.turn.status==='interrupted'?'cancelled':'error',text:p.turn.error?.message || '',status:p.turn.status});
    }
    if(m.method==='error')this.emitEvent(id,{type:'error',text:p.error?.message || 'Codex 发生错误'});
  }
  async cancel(id) {const s=this.sessions.get(id);if(s?.turnId)await this.rpc.request('turn/interrupt',{threadId:id,turnId:s.turnId});}
}
class AcpAdapter extends Adapter {
  async connect(cwd) {
    if(this.ready)return; this.close(); this.status('connecting',`正在连接 ${this.config.name}`);
    this.rpc=new StdioRpc(this.config.command,this.config.args || ['acp'],{cwd,env:this.config.env}); this.wire();
    this.rpc.on('notification',m=>this.notification(m));
    try {
      this.info=await this.rpc.request('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'human-ai-workbench',version}});
      this.status('connected',`已连接 · ${this.info.agentInfo?.name || this.config.name}`);
      return {agentInfo:this.info.agentInfo,capabilities:this.info.agentCapabilities};
    } catch(e) {this.close();this.status('error',e.message);throw e;}
  }
  async newSession(cwd,model,remoteId,conversationId) {
    if(!this.ready)await this.connect(cwd);
    if(remoteId&&!this.info.agentCapabilities?.loadSession)throw new Error('此 AI 暂不支持恢复已有对话，请新建对话继续；原记录仍保留');
    const method=remoteId ? 'session/load':'session/new';
    const mcpServers=sessionServers(this,conversationId);
    const r=await this.rpc.request(method,{cwd,mcpServers,...(method==='session/load'?{sessionId:remoteId}:{})},60000);
    const id=r.sessionId || remoteId;
    if(!id)throw new Error('Agent 未返回会话编号');
    this.sessions.set(id,{busy:false,cwd,options:acpOptions(r)});
    if(model && model!==this.sessions.get(id).options.model)await this.setSessionOption(id,'model',model);
    return {id,model:this.sessions.get(id).options.model,models:r.models,modes:r.modes,options:this.sessionOptions(id)};
  }
  sessionOptions(id){return {...this.sessions.get(id)?.options,apply:'acknowledged'};}
  async setSessionOption(id,key,value){
    const s=idleSession(this,id);
    if(key==='model'){requireChoice(s.options.models,value,'模型');await this.rpc.request('session/set_model',{sessionId:id,modelId:value});s.options.model=value;}
    else if(key==='mode'){requireChoice(s.options.modes,value,'工作模式');await this.rpc.request('session/set_mode',{sessionId:id,modeId:value});s.options.mode=value;}
    else throw new Error('此 AI 不支持这个选项');
    return this.sessionOptions(id);
  }
  async prompt(id,text,images=[]) {
    const s=this.sessions.get(id);if(!s)throw new Error('会话尚未加载');if(s.busy)throw new Error('当前任务仍在执行');
    s.busy=true;this.emitEvent(id,{type:'started'});
    try {
      const instructions=this.runtimeInstructions??guard;
      const r=await this.rpc.request('session/prompt',{sessionId:id,prompt:[{type:'text',text:instructions+'\n\n'+text},...images.map(image=>({type:'image',data:image.data,mimeType:image.mimeType}))],content:[{type:'text',text:instructions+'\n\n'+text},...images.map(image=>({type:'image',data:image.data,mimeType:image.mimeType}))]},30*60*1000);
      if(s.busy){s.busy=false;this.emitEvent(id,{type:r.stopReason==='cancelled'?'cancelled':r.stopReason==='refusal'?'error':'completed',status:r.stopReason});}
      return r;
    }catch(e){s.busy=false;this.emitEvent(id,{type:'error',text:e.message});throw e;}
  }
  notification(m) {
    if(!['session/update','session/notification'].includes(m.method))return;
    const p=m.params || {};const id=p.sessionId; if(!this.sessions.has(id))return;
    const u=p.update || p.notification || p; const kind=u.sessionUpdate || u.type || u.kind;
    if(kind==='current_mode_update'){this.sessions.get(id).options.mode=u.currentModeId;this.emitEvent(id,{type:'session-options',options:this.sessionOptions(id)});}
    if(['agent_message_chunk','AgentMessageChunk'].includes(kind))this.emitEvent(id,{type:'delta',text:u.content?.text || u.text || '',itemId:u.messageId});
    if(['tool_call','tool_call_update','ToolCall','ToolCallUpdate'].includes(kind))this.emitEvent(id,{type:'tool',tool:u.kind || '工具',status:u.status,text:u.title || u.name || '执行工具',details:u});
    if(['TurnEnd','turn_end'].includes(kind)){this.sessions.get(id).busy=false;this.emitEvent(id,{type:u.stopReason==='refusal'?'error':'completed',status:u.stopReason});}
  }
  async cancel(id){this.rpc.notify('session/cancel',{sessionId:id});}
}
module.exports={Adapter,CodexAdapter,AcpAdapter,guard,bridgeServer,sessionServers};
