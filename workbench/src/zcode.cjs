const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {Adapter,guard,sessionServers}=require('./adapters.cjs');
const {StdioRpc}=require('./rpc.cjs');
const {requireChoice,idleSession}=require('./session-options.cjs');
const {safeText}=require('./message-sync.cjs');

function discoverZcode(){
  const candidates=[path.join(process.env.LOCALAPPDATA||'','Programs','ZCode','ZCode.exe')];
  if(process.platform==='win32')try{
    const script="$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $ws=New-Object -ComObject WScript.Shell; $paths=@((Join-Path ([Environment]::GetFolderPath('Desktop')) 'ZCode.lnk'),(Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\ZCode.lnk')); foreach($p in $paths){if(Test-Path -LiteralPath $p){[Console]::WriteLine($ws.CreateShortcut($p).TargetPath)}}";
    candidates.unshift(...execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:5000}).trim().split(/\r?\n/));
  }catch{}
  const executable=candidates.find(p=>p&&path.isAbsolute(p)&&path.basename(p).toLowerCase()==='zcode.exe'&&fs.existsSync(path.join(path.dirname(p),'resources/glm/zcode.cjs')));
  return executable?{id:'zcode',name:'ZCode',role:'executor',type:'zcode',command:executable,description:'使用本机 ZCode 的登录、模型与执行能力'}:null;
}
function runtimeConfig(config){
  // Test/custom runtimes are explicit local configs, never inferred from chat content.
  if(config.args)return {command:config.command,args:config.args,env:config.env};
  const resources=path.join(path.dirname(config.command),'resources');
  const entry=path.join(resources,'glm/zcode.cjs'),builtin=path.join(resources,'config/provider/zcode-builtin.json');
  if(!fs.existsSync(entry)||!fs.existsSync(builtin))throw new Error('找不到 ZCode 原安装中的运行文件，请重新选择 ZCode.exe');
  return {command:config.command,args:[entry,'app-server'],env:{ELECTRON_RUN_AS_NODE:'1',ZCODE_BUILTIN_PROVIDER_CONFIG_FILE:builtin,ZCODE_PERSONAL_PROVIDER_CONFIG_FILE:path.join(os.homedir(),'.zcode/v2/provider_config.json')}};
}
class ZcodeRpc extends StdioRpc {
  send(value){const {jsonrpc,...message}=value;super.send(message);}
}
const modelId=ref=>ref?ref.providerId+'/'+ref.modelId:null;
function sessionOptions(snapshot){
  const settings=snapshot.settings||{},model=settings.model||{};
  return {
    models:(model.available||[]).map(m=>({id:modelId(m.ref),ref:m.ref,name:m.label||m.ref.modelId,description:m.providerLabel,efforts:(m.reasoning?.levels||[]).map(x=>({id:x.value,name:x.label||x.value})),defaultEffort:m.reasoning?.defaultLevel||null})),
    model:modelId(model.current),effort:settings.thoughtLevel?.current||model.current?.options?.reasoningLevel||null,
    modes:[{id:'build',name:'执行 · 按需确认'},{id:'edit',name:'编辑'}],mode:settings.mode?.current||snapshot.session?.mode||'build',apply:'acknowledged'
  };
}
class ZcodeAdapter extends Adapter {
  async connect(cwd){
    if(this.ready)return;this.close();this.status('connecting','正在连接本机 ZCode');
    const runtime=runtimeConfig(this.config);this.rpc=new ZcodeRpc(runtime.command,runtime.args,{cwd,env:runtime.env});this.wire();this.rpc.on('notification',m=>this.notification(m));
    try{await this.rpc.request('runtime/capabilities',{},60000);this.status('connected','已连接 ZCode 原运行环境');}
    catch(e){this.close();this.status('error',safeText(e.message));throw e;}
  }
  handleRequest(m){
    if(m.method==='session/requestRuntimePreferences')return this.rpc.respond(m.id,{nativeSearchEnhancementsEnabled:false,memoryEnabled:false,askUserQuestionAutoResolutionEnabled:false});
    if(m.method==='interaction/requestPermission'||m.method==='interaction/requestUserInput'){
      const key=String(m.id);this.approvals.set(key,m);const p=m.params||{};
      const questions=m.method==='interaction/requestUserInput'?(p.questions?.length?p.questions:[{question:p.prompt||'请填写回复'}]).map((q,i)=>({...q,id:'answer_'+i})):undefined;
      this.emit('approval',{agentId:this.config.id,requestId:key,method:m.method,params:{...p,...(questions?{questions}:{}),changes:p.input}});return;
    }
    this.rpc.reject(m.id,'工作台暂不支持这个 ZCode 客户端功能，请在原 ZCode 中使用');
  }
  approve(key,choice,answers){
    const m=this.approvals.get(key);if(!m)throw new Error('请求已结束');
    let result;
    if(m.method==='interaction/requestPermission')result={decision:choice==='allow'?'allow':'deny'};
    else if(choice!=='allow')result={action:'decline'};
    else {
      const qs=m.params.questions?.length?m.params.questions:[{question:m.params.prompt||'请填写回复'}];
      if(qs.some((q,i)=>!answers?.['answer_'+i]?.trim()))throw new Error('请先填写每一个问题的回答');
      result={action:'accept',content:{answers:Object.fromEntries(qs.map((q,i)=>[q.question,answers['answer_'+i].trim()])),answer:answers.answer_0.trim()}};
    }
    this.rpc.respond(m.id,result);this.approvals.delete(key);
  }
  async newSession(cwd,model,remoteId,conversationId){
    if(!this.ready)await this.connect(cwd);const servers=sessionServers(this,conversationId);
    const params={workspace:{workspacePath:cwd,workspaceKey:cwd},...(servers.length?{mcpServers:servers}:{})};
    const snapshot=await this.rpc.request(remoteId?'session/resume':'session/create',remoteId?{...params,sessionId:remoteId}:{...params,mode:'build',titleGenerationEnabled:false},90000);
    const id=snapshot.session?.sessionId;if(!id)throw new Error('ZCode 未返回会话编号');
    const s={busy:false,cwd,options:sessionOptions(snapshot),seq:snapshot.runtime?.eventSeq||0};this.sessions.set(id,s);
    try{
      if(remoteId){
        // The installed protocol returns only the active model for resumed snapshots.
        // A deferred, unsent session supplies the current catalog without a saved chat.
        const catalog=await this.rpc.request('session/create',{workspace:params.workspace,mode:'build',persistence:'deferred',titleGenerationEnabled:false},90000);
        s.options.models=mergeModels(sessionOptions(catalog).models,s.options.models);
        await this.rpc.request('session/close',{sessionId:catalog.session.sessionId,expectedPersistence:'deferred'});
      }
      await this.rpc.request('session/subscribe',{sessionId:id,deliveryKind:'desktop-continuous',afterSeq:s.seq,includeSnapshot:false});
      if(model&&s.options.model!==model)await this.setSessionOption(id,'model',model);
      return {id,model:s.options.model,options:this.sessionOptions(id)};
    }catch(e){this.sessions.delete(id);throw e;}
  }
  sessionOptions(id){return this.sessions.get(id)?.options;}
  async modelCatalog(cwd){
    const catalog=await this.rpc.request('session/create',{workspace:{workspacePath:cwd,workspaceKey:cwd},mode:'build',persistence:'deferred',titleGenerationEnabled:false},90000);
    try{return sessionOptions(catalog);}finally{await this.rpc.request('session/close',{sessionId:catalog.session.sessionId,expectedPersistence:'deferred'});}
  }
  async setSessionOption(id,key,value){
    const s=idleSession(this,id);let method,params={sessionId:id};
    if(key==='model'){
      requireChoice(s.options.models,value,'模型');const selected=s.options.models.find(m=>m.id===value);method='session/setModel';params.model={...selected.ref,...(selected.defaultEffort?{options:{reasoningLevel:selected.defaultEffort}}:{})};params.persistAsWorkspaceLastUsed=false;
    }else if(key==='effort'){
      requireChoice(s.options.models.find(m=>m.id===s.options.model)?.efforts||[],value,'思考强度');method='session/setThoughtLevel';params.thoughtLevel=value;params.persistAsWorkspaceLastUsed=false;
    }else if(key==='mode'){requireChoice(s.options.modes,value,'工作模式');method='session/setMode';params.mode=value;}
    else throw new Error('此 AI 不支持这个选项');
    const result=await this.rpc.request(method,params),next=sessionOptions(result.settings?result:await this.rpc.request('session/read',{sessionId:id}));
    if(next[key]!==value)throw new Error('ZCode 尚未确认该设置，当前选择保持不变');
    next.models=mergeModels(s.options.models,next.models);s.options=next;return s.options;
  }
  async prompt(id,text){
    const s=idleSession(this,id);s.busy=true;s.turnId=null;
    try{return await this.rpc.request('session/send',{sessionId:id,content:[guard,this.runtimeInstructions,text].filter(Boolean).join('\n\n')},60000);}
    catch(e){if(s.busy){s.busy=false;this.emitEvent(id,{type:'error',text:safeText(e.message)});}throw e;}
  }
  notification(m){
    if(m.method!=='session/event')return;const event=m.params||{},id=event.sessionId,s=this.sessions.get(id);if(!s)return;
    if(event.seq!==undefined){if(event.seq<=s.seq)return;s.seq=event.seq;}
    const p=event.payload||{};if(!s.busy)return;
    if(event.type==='turn.started'){s.turnId=event.turnId;this.emitEvent(id,{type:'started'});}
    if(s.turnId&&event.turnId&&s.turnId!==event.turnId)return;
    if(event.type==='model.streaming'&&p.kind==='text_delta')this.emitEvent(id,{type:'delta',text:p.delta||'',itemId:p.assistantMessageId});
    if(event.type==='tool.updated')this.emitEvent(id,{type:'tool',tool:p.toolName||p.tool?.name||'工具',text:p.toolName||p.tool?.name||'ZCode 工具',status:p.status||p.tool?.status,details:p});
    if(event.type==='turn.completed'||event.type==='turn.failed'){
      if(p.response)this.emitEvent(id,{type:'replace',text:p.response});s.busy=false;
      for(const [key,r] of this.approvals)if(r.params?.sessionId===id)this.approvals.delete(key);
      const type=event.type==='turn.failed'?'error':p.resultType==='cancelled'?'cancelled':p.resultType==='success'?'completed':'error';
      this.emitEvent(id,{type,text:type==='error'?safeText(p.error?.message||p.resultType||'ZCode 执行失败'):'',status:p.resultType});
    }
  }
  async cancel(id){if(this.sessions.get(id)?.busy)await this.rpc.request('session/stop',{sessionId:id});}
}
function mergeModels(catalog,current){return [...new Map([...catalog,...current].map(m=>[m.id,m])).values()];}
module.exports={ZcodeAdapter,ZcodeRpc,discoverZcode,runtimeConfig,sessionOptions};
