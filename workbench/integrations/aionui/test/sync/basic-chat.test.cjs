// Copyright 2026 Xuzhou contributors. SPDX-License-Identifier: Apache-2.0.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {History}=require('../../workspace/history.cjs');
const {KiroV3Adapter,sessionOptions}=require('../../kiro/adapter.cjs');
const {ensureAssistant}=require('../../distribution/assistant.cjs');

test('existing native connections are re-probed once for the team stdio contract and retain their environment',async()=>{
 const bridge=path.resolve('bridge.mjs'),command=process.execPath;
 let agent={id:'codex-connection',name:'Codex',agent_source:'custom',command,args:[bridge,'--data-dir',process.cwd(),'--config','config.json','--preferred-provider','codex'],env:[{name:'USER_SETTING',value:'retained'}],behavior_policy:{supports_team:true}};
 let updates=0,probes=0;
 const backend=async(route,method,body)=>{
  if(route==='/api/agents/management')return [agent];
  if(method==='PUT'){updates++;agent={...agent,...body,behavior_policy:body.advanced.behavior_policy};return agent;}
  if(route.endsWith('/health-check')){probes++;return {};}
  if(route==='/api/assistants')return [{id:'ai-member',agent_id:agent.id,source:'generated'}];
  throw Error('Unexpected registration request');
 };
 const options={backend,bridge,command,dataDir:process.cwd(),configFile:'config.json',preferredProvider:'codex'};
 assert.equal((await ensureAssistant(options)).id,'ai-member');await ensureAssistant(options);
 assert.equal(updates,1);assert.equal(probes,1);assert.equal(agent.env.find(e=>e.name==='USER_SETTING').value,'retained');
 assert.equal(agent.env.find(e=>e.name==='XUZHOU_BRIDGE_PROTOCOL').value,'team-stdio-v1');
});
test('a default new chat creates Codex without connecting Kiro and keeps one native source after retries',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'xuzhou-basic-'));let sources=0;const chats=[];
 const h=new History({directory:root,legacyDirectory:root,v3:{create(){throw Error('Kiro must remain optional');},close(){}},v3Sync:{close(){}},sourceCreator:async(provider,cwd)=>{sources++;assert.equal(provider,'codex');return {id:'native-codex',agentId:provider,cwd,title:'New',messages:[]};},backend:async(route,method,body)=>{
   if(route.startsWith('/api/conversations?'))return {items:chats,has_more:false};if(method==='POST'){const c={...body,id:'chat'};chats.push(c);return c;}return chats.find(c=>route.endsWith('/'+c.id));
 }});h.assistant=async()=>({id:'unified'});
 t.after(()=>{h.close();if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'xuzhou-basic-'))throw Error('Unsafe fixture');fs.rmSync(root,{recursive:true,force:true});});
 const id=crypto.randomUUID();const first=await h.createNew(root,id);const again=await h.createNew(root,id);
 assert.equal(first.conversationId,again.conversationId);assert.equal(sources,1);assert.equal(h.snapshot(first.id).source.agentId,'codex');
});
test('Kiro keeps model choices when a later update contains only a mode or effort',()=>{
 const previous=sessionOptions({configOptions:[{id:'model',category:'model',currentValue:'a',options:[{value:'a'}]}]});
 const updated=sessionOptions({configOptions:[{id:'mode',category:'mode',currentValue:'vibe',options:[{value:'vibe'}]}]},previous);
 assert.equal(updated.model,'a');assert.equal(updated.models.length,1);
});
test('Kiro buffers a model update arriving before session creation is acknowledged',async()=>{
 const a=new KiroV3Adapter({command:'kiro-cli'});a.ready=true;a.info={agentCapabilities:{sessionCapabilities:{list:true}}};
 a.rpc={request:async()=>{a.notification({method:'session/update',params:{sessionId:'early',update:{sessionUpdate:'config_option_update',configOptions:[{id:'model',category:'model',currentValue:'a',options:[{value:'a'}]}]}}});a.notification({method:'session/update',params:{sessionId:'early',update:{sessionUpdate:'config_option_update',configOptions:[{id:'mode',category:'mode',currentValue:'vibe',options:[{value:'vibe'}]}]}}});return {sessionId:'early',configOptions:[]};}};
 const result=await a.newSession(process.cwd());assert.equal(result.options.model,'a');assert.equal(result.options.models.length,1);
});
