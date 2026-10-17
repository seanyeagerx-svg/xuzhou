// Copyright 2026 Xuzhou contributors. SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { WorkbenchAgent } from '../../service.mjs';
import adapters from '../../../../src/adapters.cjs';
import crypto from 'node:crypto';
import permissions from '../../workspace/context/permissions.cjs';
import openclaw from '../../../../src/openclaw.cjs';
import delivery from '../../lobster/delivery.cjs';

test('Codex fieldless MCP confirmations use the host permission result without fabricating form data', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'xuzhou-mcp-confirm-'));
  const request={id:'confirm-1',method:'mcpServer/elicitation/request',params:{mode:'form',serverName:'aionui-team',message:'Allow the aionui-team MCP server to run tool "team_members"?',requestedSchema:{type:'object',properties:{}}}};
  assert.equal(adapters.isConfirmationElicitation(request),true);
  for(const schema of [{type:'object',properties:{answer:{type:'string'}}},{type:'object',properties:{},required:['answer']},{type:'object',properties:{},allOf:[{required:['answer']}]},{type:'object',properties:[]},{type:'object',properties:{},additionalProperties:{type:'string'}}])assert.equal(adapters.isConfirmationElicitation({...request,params:{...request.params,requestedSchema:schema}}),false);
  assert.equal(adapters.isConfirmationElicitation({...request,params:{...request.params,mode:'url'}}),false);
  const native=new adapters.Adapter({id:'codex'}),responses=[];native.rpc={respond:(id,result)=>responses.push({id,result})};
  let allowed=true,shown=0;
  const bridge=new WorkbenchAgent({requestPermission:async value=>{shown++;assert.equal(value.toolCall.title,request.params.message);return {outcome:{outcome:'selected',optionId:allowed?'allow':'deny'}};}},{agents:[],dataDir:root});
  t.after(()=>{bridge.close();fs.rmSync(root,{recursive:true,force:true});});
  const session={c:{id:'synthetic-confirmation'},permissions:new Map(),turn:{a:native,reply:{text:''}}};
  for(const choice of [true,false]){allowed=choice;native.handleRequest(request);await bridge.permission(session,native,{requestId:String(request.id),method:request.method,params:request.params});assert.deepEqual(responses.at(-1).result,{action:choice?'accept':'decline',content:choice?{}:null});assert.equal(session.permissions.size,0);}
  assert.equal(shown,2);
  const form={...request,id:'form-2',params:{...request.params,requestedSchema:{type:'object',properties:{answer:{type:'string'}}}}};native.handleRequest(form);native.approve('form-2','allow');assert.deepEqual(responses.at(-1).result,{action:'decline',content:null});
});

test('remembered MCP access is bound to a chat, provider, tool and attached server, and can be revoked', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'xuzhou-tool-memory-'));
  const adapter=new adapters.Adapter({id:'codex'}), responses=[];
  const server={name:'aionui-team',command:'synthetic-team-server',args:['project-a'],env:[]};
  adapter.sessionMcpServers=()=>[server];adapter.rpc={respond:(id,result)=>responses.push({id,result})};
  let shown=0,choice='xuzhou_remember_tool';
  const host=new WorkbenchAgent({sessionUpdate:async()=>{},requestPermission:async p=>{shown++;assert.ok(p.options.some(x=>x.optionId==='xuzhou_remember_tool'));return {outcome:{outcome:'selected',optionId:choice}};}},{agents:[],dataDir:root});
  const c={id:crypto.randomUUID(),cwd:root,agentId:'codex',model:'test',routes:{}};
  host.store.claim(c.id);host.store.save(c);const session=host.runtime(c);host.sessions.set(c.id,session);
  const turn=()=>({a:adapter,reply:{text:''}});session.turn=turn();
  t.after(()=>{session.turn=null;host.close();fs.rmSync(root,{recursive:true,force:true});});
  const request=(id,tool='team_members')=>({id,method:'mcpServer/elicitation/request',params:{mode:'form',serverName:'aionui-team',message:`Allow the aionui-team MCP server to run tool "${tool}"?`,requestedSchema:{type:'object',properties:{}}}});
  const ask=async message=>{adapter.handleRequest(message);await host.permission(session,adapter,{requestId:message.id,method:message.method,params:message.params});};
  await ask(request('one'));await ask(request('two'));assert.equal(shown,1);assert.equal(responses.at(-1).result.action,'accept');
  session.c=host.store.read(c.id);await ask(request('reloaded'));assert.equal(shown,1);
  choice='deny';await ask(request('other-tool','team_send_message'));assert.equal(shown,2);assert.equal(responses.at(-1).result.action,'decline');
  const memory=permissions.scope(session,adapter,request('scope'));
  assert.equal(permissions.has({...session.c,toolPermissions:[]},memory),false);
  assert.equal(permissions.has({...session.c,id:crypto.randomUUID()},permissions.scope({...session,c:{...session.c,id:crypto.randomUUID()}},adapter,request('other-chat'))),false);
  const otherAdapter=new adapters.Adapter({id:'kiro-v3'});otherAdapter.sessionMcpServers=()=>[server];
  assert.equal(permissions.has(session.c,permissions.scope(session,otherAdapter,request('other-ai'))),false);
  server.args=['project-b'];await ask(request('changed-server'));assert.equal(shown,3);
  server.args=['project-a'];session.turn=null;await host.setSessionConfigOption({sessionId:c.id,configId:'tool_permissions',value:'ask'});session.turn=turn();
  await ask(request('revoked'));assert.equal(shown,4);
  assert.equal(host.modelState(session).configOptions.find(x=>x.id==='tool_permissions').currentValue,'ask');
  assert.equal(permissions.scope(session,adapter,{method:'item/commandExecution/requestApproval',params:{command:'example'}}),null);
  assert.equal(permissions.scope(session,adapter,{...request('form'),params:{...request('form').params,requestedSchema:{type:'object',properties:{answer:{type:'string'}}}}}),null);
});

test('native ACP always choices stay revocable by forwarding one approval at a time', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'xuzhou-native-memory-'));
  const native=new adapters.Adapter({id:'kiro-v3'}),responses=[];
  native.sessionMcpServers=()=>[{name:'team',command:'synthetic-team',args:[],env:[]}];native.rpc={respond:(id,result)=>responses.push({id,result})};
  let shown=0;const host=new WorkbenchAgent({sessionUpdate:async()=>{},requestPermission:async()=>{shown++;return {outcome:{outcome:'selected',optionId:'native-always'}};}},{agents:[],dataDir:root});
  const c={id:crypto.randomUUID(),cwd:root,agentId:'kiro-v3',model:'test',routes:{}};host.store.claim(c.id);host.store.save(c);const session=host.runtime(c);host.sessions.set(c.id,session);session.turn={a:native,reply:{text:''}};
  t.after(()=>{session.turn=null;host.close();fs.rmSync(root,{recursive:true,force:true});});
  const ask=async id=>{const request={id,method:'session/request_permission',params:{toolCall:{toolCallId:id,title:'@team/team_members'},options:[{optionId:'native-once',kind:'allow_once',name:'Once'},{optionId:'native-always',kind:'allow_always',name:'Always'}]}};native.handleRequest(request);await host.permission(session,native,{requestId:id,method:request.method,params:request.params});};
  await ask('first');await ask('second');assert.equal(shown,1);
  assert.deepEqual(responses.map(value=>value.result.outcome.optionId),['native-once','native-once']);
  session.turn=null;await host.setSessionConfigOption({sessionId:c.id,configId:'tool_permissions',value:'ask'});session.turn={a:native,reply:{text:''}};
  await ask('revoked');assert.equal(shown,2);assert.equal(responses.at(-1).result.outcome.optionId,'native-once');
});

test('Lobster tool streams keep project inputs, partial results and terminal results without treating updates as completion', () => {
  const adapter=new openclaw.OpenClawAdapter({id:'openclaw'},{get:()=>null,set:()=>{}});
  const conversation={id:'inbox',projectId:'p-one',agentId:'openclaw',remoteId:'session-one',gateway:'local',messages:[],activities:[]};
  const runtime={state:{conversations:[conversation]},gatewayConfig:()=>({url:'local'}),save:()=>{}};
  const inbox=new delivery.Delivery(runtime);adapter.on('event',event=>inbox.event(event));
  adapter.sessions.set('session-one',{busy:true,runId:'run-one'});
  const event=(seq,phase,data={},sessionKey='session-one')=>adapter.event({event:'agent',payload:{sessionKey,runId:'run-one',seq,stream:'tool',data:{toolCallId:'tool-one',name:'read',phase,...data}}});
  event(1,'start',{args:{path:'BRIEF.txt',password:'synthetic-secret'}});event(2,'update',{partialResult:{text:'PARTIAL'}});
  assert.equal(conversation.activities[0].status,'running');assert.match(conversation.activities[0].output,/PARTIAL/);
  assert.doesNotMatch(conversation.activities[0].input,/synthetic-secret/);
  event(3,'result',{result:{text:'FINAL'},isError:false});event(2,'start',{args:{path:'WRONG.txt'}});
  assert.equal(conversation.activities.length,1);assert.equal(conversation.activities[0].status,'completed');assert.match(conversation.activities[0].output,/FINAL/);
  event(4,'start',{},'other-session');assert.equal(conversation.activities.length,1);
  adapter.sessions.get('session-one').busy=false;event(5,'start');assert.equal(conversation.activities[0].status,'completed');
});

test('ACP conversations use Xuzhou handoffs across Codex, Kiro V3 and ZCode and survive restart', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xuzhou-service-')), prompts = [], adapters = new Map();
  const agents = ['codex', 'kiro-v3', 'zcode'].map(id => ({ id, name: id, type: id === 'zcode' ? 'zcode' : id === 'codex' ? 'codex' : 'acp' }));
  class Adapter extends EventEmitter {
    constructor(config) { super(); this.config = config; this.sessions = new Map(); }
    async connect() { this.ready = true; }
    sessionOptions() { return { model: 'test', models: [{ id: 'test', name: 'Test', efforts: [{ id: 'high', name: 'High' }] }], effort: 'high' }; }
    async newSession(_cwd, _model, resume) { const id = resume || this.config.id + '-native'; this.sessions.set(id, {}); return { id, options: this.sessionOptions() }; }
    async setSessionOption() { return this.sessionOptions(); }
    async prompt(sessionId, text) {
      prompts.push({ provider: this.config.id, text, tools: this.sessionMcpServers() });
      this.emit('event', { type: 'delta', agentId: this.config.id, sessionId, text: this.config.id + ' replied' });
      this.emit('event', { type: 'completed', agentId: this.config.id, sessionId });
    }
    close() { this.ready = false; }
  }
  const options = { agents, dataDir: root, adapterFactory: config => { const adapter = new Adapter(config); adapters.set(config.id, adapter); return adapter; } };
  const connection = { sessionUpdate: async () => {}, requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }) };
  let agent = new WorkbenchAgent(connection, options);
  t.after(() => { agent.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const capabilities=(await agent.initialize()).agentCapabilities;
  assert.equal(capabilities._meta.xuzhou_stdio_mcp,true);
  assert.deepEqual(capabilities.mcpCapabilities,{http:false,sse:false});
  const teamServers=[{name:'team-coordination',command:process.execPath,args:['team-fixture.cjs'],env:[]}];
  const created = await agent.newSession({ cwd: root, mcpServers: teamServers });
  await agent.setSessionMode({sessionId:created.sessionId,modeId:'default'});
  await assert.rejects(agent.setSessionMode({sessionId:created.sessionId,modeId:'unrestricted'}),/默认权限/);
  const say = text => agent.prompt({ sessionId: created.sessionId, prompt: [{ type: 'text', text }] });
  await say('项目代号 S-739，保留 Codex 和 v2rayN 配置。');
  await agent.unstable_setSessionModel({ sessionId: created.sessionId, modelId: 'kiro-v3/test' });
  await say('接着做');
  assert.match(prompts[1].text, /S-739/); assert.match(prompts[1].text, /v2rayN/);
  await agent.unstable_setSessionModel({ sessionId: created.sessionId, modelId: 'zcode/test' }); await say('复核');
  assert.match(prompts[2].text, /kiro-v3 replied/);
  await agent.unstable_setSessionModel({ sessionId: created.sessionId, modelId: 'codex/test' }); await say('继续');
  assert.match(prompts[3].text, /zcode replied/); assert.doesNotMatch(prompts[3].text, /S-739/);
  const before = agent.store.read(created.sessionId);
  assert.equal(before.continuity.handoffs.length, 4); assert.ok(before.continuity.handoffs.every(r => r.status === 'completed'));
  assert.ok(prompts.every(p => p.tools.some(tool => tool.name === 'workbench_history')));
  assert.ok(prompts.every(p => p.tools.some(tool => tool.name === 'team-coordination')));
  agent.close(); agent = new WorkbenchAgent(connection, options);
  await agent.loadSession({ sessionId: created.sessionId, cwd: root, mcpServers: teamServers });
  await say('恢复后继续');
  const after = agent.store.read(created.sessionId);
  assert.deepEqual(after.messages.slice(0, before.messages.length), before.messages);
  assert.equal(after.continuity.handoffs.length, 5);
});

test('late events from a different provider never become the current response', async () => {
  // This boundary uses the same event ownership check as the runtime bridge.
  const { acceptsTurnEvent } = await import('../../../../src/continuity/session.cjs');
  const c = { status: 'running', agentId: 'kiro-v3', remoteId: 'kiro-native', activeTurn: { agentId: 'kiro-v3', remoteId: 'kiro-native' } };
  assert.equal(acceptsTurnEvent(c, { agentId: 'codex', sessionId: 'old-native' }), false);
});

for(const provider of ['zcode','codex'])test(`a missing unsent ${provider} session is recreated after restart with the complete visible transcript`, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xuzhou-zcode-restart-'));
  const prompts = [], attempts = [];
  const origin=provider==='codex'?'kiro-v3':'codex';
  const missing=provider==='codex'?'no rollout found for thread id codex-native':'Session not found: zcode-native';
  let restarted = false, failure = missing;
  class Adapter extends EventEmitter {
    constructor(config) { super(); this.config = config; this.sessions = new Map(); }
    async connect() { this.ready = true; }
    sessionOptions() { return { model: 'test', models: [{ id: 'test', name: 'Test' }] }; }
    async newSession(_cwd, _model, resume) {
      attempts.push({ provider: this.config.id, resume, restarted });
      if (restarted && this.config.id === provider && resume) throw Error(failure);
      const id = resume || this.config.id + (restarted ? '-recreated' : '-native');
      this.sessions.set(id, {}); return { id, options: this.sessionOptions() };
    }
    async prompt(sessionId, text) {
      prompts.push(text);
      this.emit('event', { type: 'delta', agentId: this.config.id, sessionId, text: 'received' });
      this.emit('event', { type: 'completed', agentId: this.config.id, sessionId });
    }
    close() { this.ready = false; }
  }
  const options = { agents: [origin, provider].map(id => ({ id, name: id, type: id })), dataDir: root, adapterFactory: config => new Adapter(config) };
  const connection = { sessionUpdate: async () => {} };
  let agent = new WorkbenchAgent(connection, options);
  t.after(() => { agent.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const { sessionId } = await agent.newSession({ cwd: root, mcpServers: [] });
  await agent.prompt({ sessionId, prompt: [{ type: 'text', text: '保留代号 RESTORE-739' }] });
  const before = agent.store.read(sessionId).messages;
  agent.close(); restarted = true; agent = new WorkbenchAgent(connection, options);
  await agent.loadSession({ sessionId, cwd: root, mcpServers: [] });
  failure = 'Network unavailable';
  await assert.rejects(agent.unstable_setSessionModel({ sessionId, modelId: provider+'/test' }), /Network unavailable/);
  assert.equal(agent.get(sessionId).c.agentId, origin);
  assert.ok(!attempts.some(x => x.provider === provider && x.restarted && x.resume === null));
  failure = missing;
  await agent.unstable_setSessionModel({ sessionId, modelId: provider+'/test' });
  await agent.prompt({ sessionId, prompt: [{ type: 'text', text: '继续复核' }] });
  const after = agent.store.read(sessionId);
  assert.deepEqual(after.messages.slice(0, before.length), before);
  assert.match(prompts.at(-1), /RESTORE-739/);
  assert.equal(after.routes[provider].cursor, after.messages.length);
  assert.deepEqual(after.routes[provider].previousSessionIds, [provider+'-native']);
});
