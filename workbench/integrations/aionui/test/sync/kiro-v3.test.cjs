const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {KiroV3Adapter,v3Config,sessionOptions}=require('../../kiro/adapter.cjs');
const {transcript,KiroV3History}=require('../../kiro/history.cjs');
const {KiroContextWriter,contextFile,readDocument}=require('../../kiro/sync.cjs');
const {History}=require('../../workspace/history.cjs');
const options=(model='a',effort='high')=>[
  {id:'model',category:'model',currentValue:model,options:[{name:'Models',options:[{value:'a',name:'A'},{value:'b',name:'B'}]}]},
  {id:'effortLevel',currentValue:effort,options:[{value:'low'},{value:'high'}]},
];
const chunk=(role,id,text)=>({sessionUpdate:role==='user'?'user_message_chunk':'agent_message_chunk',content:{type:'text',text},_meta:{kiro:{messageId:id,timestamp:'2026-10-15T00:00:00Z',replay:true}}});

test('V3 uses an explicit engine and keeps existing authentication and environment intact',()=>{
  const original={id:'kiro',command:'kiro-cli',args:['acp'],env:{SAMPLE:'preserved'}};
  const config=v3Config(original);assert.deepEqual(config.args,['acp','--agent-engine=v3']);assert.equal(config.id,'kiro-v3');assert.deepEqual(config.env,original.env);assert.deepEqual(original.args,['acp']);
});
test('real V3 configuration choices supply model and thought level without fabricating options',()=>{
  const parsed=sessionOptions({configOptions:options()});assert.equal(parsed.model,'a');assert.equal(parsed.effort,'high');assert.deepEqual(parsed.models[0].efforts.map(e=>e.id),['low','high']);
  assert.equal(parsed.models[1].efforts,undefined);assert.deepEqual(sessionOptions({configOptions:[]}).efforts,[]);
});
test('V3 accepts an option only after server acknowledgement and rejects unavailable choices',async()=>{
  const a=new KiroV3Adapter({command:'kiro-cli'});a.sessions.set('s',{busy:false,options:sessionOptions({configOptions:options()})});const calls=[];
  a.rpc={request:async(method,p)=>{calls.push({method,p});return {configOptions:options('a',p.value)};}};
  await a.setSessionOption('s','effort','low');assert.equal(a.sessionOptions('s').effort,'low');assert.equal(calls[0].method,'session/set_config_option');assert.equal(calls[0].p.configId,'effortLevel');
  await assert.rejects(a.setSessionOption('s','model','missing'),/未提供/);assert.equal(calls.length,1);
  a.rpc.request=async()=>({configOptions:options('a','low')});await assert.rejects(a.setSessionOption('s','effort','high'),/尚未确认/);
});
test('V3 replay and lifecycle notices cannot duplicate a reply or finish an active prompt',()=>{
  const a=new KiroV3Adapter({command:'kiro-cli'}),events=[];a.sessions.set('s',{busy:true,options:{}});a.on('event',e=>events.push(e));
  a.notification({method:'session/update',params:{sessionId:'s',update:chunk('assistant','old','old answer')}});
  a.notification({method:'session/update',params:{sessionId:'s',update:{sessionUpdate:'TurnEnd'}}});
  assert.equal(events.length,0);assert.equal(a.sessions.get('s').busy,true);
  const live=chunk('assistant','new','new answer');delete live._meta.kiro.replay;a.notification({method:'session/update',params:{sessionId:'s',update:live}});
  assert.equal(events[0].itemId,'new');assert.equal(events[0].text,'new answer');
});
test('V3 transcript joins stable chunks but never imports reasoning or tool output',()=>{
  const result=transcript([chunk('user','u','question'),{sessionUpdate:'agent_thought_chunk',content:{text:'private'}},chunk('assistant','a','part 1'),chunk('assistant','a',' part 2'),{sessionUpdate:'tool_call',content:{text:'tool'}}],'s');
  assert.deepEqual(result.map(m=>m.text),['question','part 1 part 2']);assert.equal(result[1].id,'kiro-v3:s:a');
  const bad=chunk('user','u','text');delete bad._meta.kiro.messageId;assert.throws(()=>transcript([bad],'s'),/稳定/);
  assert.throws(()=>transcript([chunk('user','same','u'),chunk('assistant','same','a')],'s'),/重复/);
});
test('V3 source catalog refuses remote sessions and requires server-advertised capabilities',async()=>{
  const h=new KiroV3History({config:()=>({command:'kiro-cli'}),rpcFactory:()=>({on(){},request:async()=>({agentCapabilities:{}}),close(){}})});
  assert.equal(h.item({sessionId:'s',_meta:{kiro:{source:'remote',executionTarget:{kind:'remote'}}}}),null);
  await assert.rejects(h.connect(),/会话接口/);assert.equal(h.active.size,0);h.close();
});

function writerFixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kiro-sync-')),id=crypto.randomUUID(),source={id:'sess_test',agentId:'kiro-v3',cwd:root};
  const file=contextFile(root,id);fs.mkdirSync(path.dirname(file));let attached=false,connections=0,show=0;const calls=[];
  const history={withSession:async(_s,fn)=>{connections++;return fn({request:async(method,params)=>{calls.push({method,params});assert.notEqual(method,'session/prompt');attached=true;return {success:true};}});},
    context:async()=>{show++;return {success:true,entries:attached?[{path:file,matched:true}]:[],breakdown:{sessionFiles:{items:attached?[{name:file,matched:true,tokens:100}]:[]}}};}};
  const writer=new KiroContextWriter({directory:root,history});t.after(()=>{writer.close();fs.rmSync(root,{recursive:true,force:true});});
  return {root,id,source,file,writer,history,calls,detach:()=>{attached=false;},stats:()=>({connections,show}),batch:{key:'batch-1',messages:[{key:'u',role:'user',text:'new fact'},{key:'a',role:'assistant',text:'received'}]}};
}
test('context registration is verified after reopening and retrying never registers it twice',async t=>{
  const f=writerFixture(t);await f.writer.prepare(f.source,f.id);await f.writer.prepare(f.source,f.id);
  assert.equal(f.calls.length,1);assert.equal(f.stats().connections,4);assert.equal(f.calls[0].params.subcommand,'add');
});
test('passive context delivery survives a lost acknowledgement and retries exactly once without a prompt',async t=>{
  const f=writerFixture(t);await f.writer.prepare(f.source,f.id);const base=f.history.context;let show=0;
  f.history.context=async(...args)=>{if(++show===2)throw Error('lost reply');return base(...args);};
  await assert.rejects(f.writer.deliver(f.source,f.batch,()=>true,f.id),/lost reply/);
  assert.equal(readDocument(f.file,f.source,f.id).batches.length,1);f.history.context=base;
  assert.equal((await f.writer.deliver(f.source,f.batch,()=>true,f.id)).existing,true);assert.equal(readDocument(f.file,f.source,f.id).batches.length,1);
  assert.equal(f.calls.length,1);
});
test('removed context attachment, paused sync and a changed batch never overwrite the existing receipt',async t=>{
  const f=writerFixture(t);await f.writer.prepare(f.source,f.id);const before=fs.readFileSync(f.file,'utf8');
  await assert.rejects(f.writer.deliver(f.source,f.batch,()=>false,f.id),/暂停/);assert.equal(fs.readFileSync(f.file,'utf8'),before);
  f.detach();await assert.rejects(f.writer.deliver(f.source,f.batch,()=>true,f.id),/移除/);assert.equal(fs.readFileSync(f.file,'utf8'),before);
  await f.writer.prepare(f.source,f.id);await f.writer.deliver(f.source,f.batch,()=>true,f.id);
  const received=fs.readFileSync(f.file,'utf8');await assert.rejects(f.writer.deliver(f.source,{...f.batch,messages:[]},()=>true,f.id),/改写/);assert.equal(fs.readFileSync(f.file,'utf8'),received);
});
test('identity mismatch preserves context; long delivery keeps complete archive and a bounded attachment',async t=>{
  const f=writerFixture(t);await f.writer.prepare(f.source,f.id);const before=fs.readFileSync(f.file,'utf8');
  await assert.rejects(f.writer.deliver({...f.source,id:'different'},f.batch,()=>true,f.id),/不匹配/);
  assert.equal(fs.readFileSync(f.file,'utf8'),before);
  const batch={key:'large',messages:[{key:'long',role:'user',text:'必须保留早期约束。'+ '中文🦞'.repeat(60000)}]};
  await f.writer.deliver(f.source,batch,()=>true,f.id);
  assert.equal(readDocument(f.file,f.source,f.id).batches[0].messages[0].text,batch.messages[0].text);
  assert.ok(fs.statSync(f.file).size<55000);
  assert.equal(JSON.parse(fs.readFileSync(f.file,'utf8')).version,2);
  assert.equal((await f.writer.deliver(f.source,batch,()=>true,f.id)).existing,true);
  assert.equal(readDocument(f.file,f.source,f.id).batches.length,1);
});

function creationFixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kiro-new-')),created=[],prepared=[],chats=[],calls=[];
  const v3={create:async cwd=>{created.push(cwd);return {id:'sess_new',agentId:'kiro-v3',cwd,title:'New',messages:[]};},close(){}};
  const v3Sync={prepare:async(s,id)=>prepared.push({s,id}),close(){}};
  const backend=async(route,method,body)=>{
    calls.push({route,method});
    if(route==='/api/agents/management')return [{id:'custom',agent_source:'custom',args:[path.resolve(__dirname,'../../bridge.mjs')]}];
    if(route==='/api/assistants')return [{id:'bare:custom',agent_id:'custom',source:'generated'}];
    if(route.startsWith('/api/conversations?'))return {items:chats,has_more:false};
    if(method==='POST'){assert.equal(prepared.length,1);const c={...body,id:'chat'};chats.push(c);return c;}
    return chats.find(c=>route.endsWith('/'+c.id));
  };
  const h=new History({directory:root,legacyDirectory:root,v3,v3Sync,backend});t.after(()=>{h.close();fs.rmSync(root,{recursive:true,force:true});});return {root,h,v3,created,prepared,chats,calls};
}
function createV3(history,cwd,id,options={}) {return history.createNew(cwd,id,{...options,overrides:{...options.overrides,model:options.overrides?.model||'kiro-v3/a'}});}
test('new V3 conversation prepares the persistent return path before exposing one unified chat',async t=>{
  const f=creationFixture(t),requestId=crypto.randomUUID();const [a,b]=await Promise.all([createV3(f.h,f.root,requestId),createV3(f.h,f.root,requestId)]);
  const c=await createV3(f.h,f.root,requestId);assert.equal(a.id,b.id);assert.equal(c.conversationId,'chat');assert.equal(f.created.length,1);assert.equal(f.chats.length,1);assert.equal(f.h.snapshot(a.id).source.messages.length,0);
});
test('a lost unified creation reply reuses the V3 source and the already created chat',async t=>{
  const f=creationFixture(t),requestId=crypto.randomUUID(),base=f.h.backend;let lost=true;
  f.h.backend=async(...args)=>{const r=await base(...args);if(args[1]==='POST'&&lost){lost=false;throw Error('lost reply');}return r;};
  await assert.rejects(createV3(f.h,f.root,requestId),/lost reply/);const recovered=await createV3(f.h,f.root,requestId);
  assert.equal(recovered.existing,true);assert.equal(f.created.length,1);assert.equal(f.chats.length,1);
});
test('unknown native creation outcome is held visibly instead of silently duplicating the native chat',async t=>{
  const f=creationFixture(t),requestId=crypto.randomUUID();let tries=0;f.v3.create=async()=>{tries++;throw Error('native reply lost');};
  await assert.rejects(createV3(f.h,f.root,requestId),/native reply lost/);await assert.rejects(createV3(f.h,f.root,requestId),/未重复创建/);assert.equal(tries,1);assert.equal(f.chats.length,0);
});
test('ordinary new chat allocates one persistent workspace and keeps selected model, effort and attachments',async t=>{
  const f=creationFixture(t),requestId=crypto.randomUUID(),overrides={model:'kiro-v3/a',thought_level:'high',permission:'default',skill_ids:['read'],mcp_ids:['mcp']};
  const first=await createV3(f.h,'',requestId,{name:'First question',locale:'zh-CN',overrides,extra:{default_files:['D:/note.txt'],selected_mcp_server_ids:['mcp'],workspace:'D:/wrong',workbench_import_id:'wrong'}});
  const again=await createV3(f.h,'',requestId);
  const cwd=path.join(f.root,'workspaces','chat-temp-'+requestId),chat=f.chats[0];
  assert.equal(first.conversationId,again.conversationId);assert.equal(f.created.length,1);assert.equal(f.chats.length,1);
  assert.equal(chat.extra.workspace,cwd);assert.ok(fs.statSync(cwd).isDirectory());assert.equal(f.h.snapshot(first.id).cwd,cwd);
  assert.equal(chat.name,'First question');assert.deepEqual(chat.assistant,{id:'bare:custom',locale:'zh-CN',conversation_overrides:overrides});
  assert.deepEqual(chat.extra.default_files,['D:/note.txt']);assert.deepEqual(chat.extra.selected_mcp_server_ids,['mcp']);assert.equal(chat.extra.workbench_import_id,first.id);
});
test('project new chat retains the selected project and rejects a changed project on the same request',async t=>{
  const f=creationFixture(t),requestId=crypto.randomUUID();await createV3(f.h,f.root,requestId,{name:'Project chat'});
  assert.equal(f.created[0],f.root);assert.equal(f.chats[0].extra.workspace,f.root);assert.equal(fs.existsSync(path.join(f.root,'workspaces')),false);
  await assert.rejects(createV3(f.h,'',requestId),/项目已变化/);assert.equal(f.created.length,1);assert.equal(f.chats.length,1);
});

function terminalHistoryFixture(status) {
  const calls=[];
  const {EventEmitter}=require('node:events');
  const history=new KiroV3History({config:()=>({command:'kiro-cli'}),rpcFactory:()=>{
    const rpc=new EventEmitter();rpc.close=()=>{rpc.closed=true;};
    rpc.request=async(method,params)=>{calls.push({method,params});
      if(method==='initialize')return {agentCapabilities:{loadSession:true,sessionCapabilities:{list:true,close:true}}};
      if(method==='session/list')return {sessions:[{sessionId:'sess_failed',cwd:process.cwd(),_meta:{kiro:{source:'local',executionTarget:{kind:'local'},status}}}]};
      if(method==='session/load'){
        rpc.emit('notification',{method:'session/update',params:{sessionId:'sess_failed',update:chunk('user','retained-user','original question')}});
        return {_meta:{id:'sess_failed',source:'local',workspacePaths:[process.cwd()]}};
      }
      if(method==='session/close')return {};
      throw Error('Unexpected RPC: '+method);
    };return rpc;
  }});
  return {history,calls};
}
test('failed terminal sessions retain readable history without generating another model turn',async()=>{
  const f=terminalHistoryFixture('failed');try{
    const result=await f.history.read('sess_failed');
    assert.deepEqual(result.messages.map(m=>[m.id,m.role,m.text]),[['kiro-v3:sess_failed:retained-user','user','original question']]);
    assert.equal(f.calls.filter(c=>c.method==='session/load').length,1);
    assert.equal(f.calls.filter(c=>c.method==='session/close').length,1);
    assert.equal(f.calls.some(c=>c.method==='session/prompt'),false);
  }finally{f.history.close();}
});
test('active or unknown session states are still refused before loading',async()=>{
  for(const status of ['running','busy',undefined]){
    const f=terminalHistoryFixture(status);try{
      await assert.rejects(f.history.read('sess_failed'),/稍后自动重试/);
      assert.equal(f.calls.some(c=>c.method==='session/load'),false);
      assert.equal(f.calls.some(c=>c.method==='session/prompt'),false);
    }finally{f.history.close();}
  }
});
