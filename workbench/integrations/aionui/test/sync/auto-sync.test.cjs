const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {History}=require('../../workspace/history.cjs');
const {AutoSync}=require('../../workspace/auto-sync.cjs');
const {applyUpdates}=require('../../workspace/updates.cjs');
async function setup(t,provider='codex') {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'auto-sync-')),id=crypto.randomUUID(),cid=crypto.randomUUID();let time=1000;
  const source={id:'native',agentId:provider,cwd:root,messages:[{id:'u',role:'user',text:'old'},{id:'a',role:'assistant',text:'known',status:'completed'}]};
  const h=new History({directory:root,legacyDirectory:root,reader:{read:async()=>structuredClone(source)},backend:async()=>({id:'chat',extra:{workbench_import_id:id,workspace:root}})});
  fs.writeFileSync(path.join(root,'imports',id+'.json'),JSON.stringify({id,cwd:root,source,createdAt:1}));
  fs.writeFileSync(h.indexFile,JSON.stringify({key:{id,conversationId:'chat'}}));
  const c={id:cid,importId:id,cwd:root,status:'idle',nativeSource:{id:'native',agentId:provider,cwd:root},messages:source.messages.map(m=>({...m,sourceMessageId:m.id})),routes:{codex:{cursor:2}}};
  const save=()=>fs.writeFileSync(path.join(root,cid+'.json'),JSON.stringify(c));save();
  const deliveries=[],writer={deliver:async(_s,b)=>{deliveries.push(b);},close(){}};
  const sync=new AutoSync({history:h,writer,interval:10,now:()=>time});sync.schedule=()=>{};
  t.after(async()=>{await sync.close();h.close();fs.rmSync(root,{recursive:true,force:true});});
  return {root,id,c,h,source,sync,writer,deliveries,save,advance:()=>{time+=100;},addLocal:()=>{c.messages.push({id:crypto.randomUUID(),role:'user',text:'local ORCHID'},{id:crypto.randomUUID(),role:'assistant',text:'remember ORCHID',status:'completed',agentId:'kiro'});save();}};
}
test('automatic incoming waits for a stable completed reply and appends once at the next turn boundary',async t=>{
  const f=await setup(t),file=path.join(f.root,'imports',f.id+'.json'),base=fs.readFileSync(file,'utf8');
  f.source.messages.push({id:'u2',role:'user',text:'new CEDAR'});await f.sync.tick();f.advance();await f.sync.tick();
  assert.equal(f.h.snapshot(f.id).revision,0);
  f.source.messages.push({id:'a2',role:'assistant',text:'received',status:'completed'});await f.sync.tick();f.advance();await f.sync.tick();
  assert.equal(f.h.snapshot(f.id).revision,1);assert.equal(applyUpdates(f.c,f.root),2);assert.equal(applyUpdates(f.c,f.root),0);
  assert.equal(fs.readFileSync(file,'utf8'),base);assert.equal(f.c.routes.codex.cursor,2);
});
test('completed local pairs return once; imported messages and partial turns are never echoed',async t=>{
  const f=await setup(t);f.addLocal();f.c.messages.push({id:'waiting',role:'user',text:'unanswered'},{id:'partial',role:'assistant',text:'unfinished',status:'interrupted'});f.save();
  await f.sync.tick();await f.sync.tick();
  assert.equal(f.deliveries.length,1);assert.equal(f.deliveries[0].messages.length,2);assert.doesNotMatch(f.deliveries[0].text,/old|unfinished|unanswered/);
});
test('lost acknowledgements retain the same batch across restart and later messages',async t=>{
  const f=await setup(t);f.addLocal();let key;
  f.writer.deliver=async(_s,b)=>{key=b.key;throw Error('connection lost after append');};await f.sync.tick();await f.sync.close();
  f.addLocal();f.advance();const attempts=[];
  const next=new AutoSync({history:f.h,writer:{deliver:async(_s,b)=>{attempts.push(b.key);},close(){}},interval:10,now:()=>5000});t.after(()=>next.close());
  await next.tick();assert.equal(attempts[0],key);await next.tick();assert.equal(attempts.length,2);assert.notEqual(attempts[1],key);
});
test('native writer contention is queued and retried without losing local messages',async t=>{
  const f=await setup(t);f.addLocal();let fail=true;
  f.writer.deliver=async(_s,b)=>{if(fail)throw Error('thread already has an active writer');f.deliveries.push(b);};
  await f.sync.tick();assert.equal(f.sync.status(f.id).outbound.state,'waiting');assert.equal(f.deliveries.length,0);
  fail=false;f.advance();await f.sync.tick();assert.equal(f.deliveries.length,1);assert.equal(f.sync.status(f.id).outbound.records,2);
});
test('a pause during a slow read prevents an automatic import and persists across restart',async t=>{
  const f=await setup(t);f.source.messages.push({id:'x',role:'assistant',text:'next',status:'completed'});await f.sync.tick();f.advance();
  let resolve;f.h.reader.read=()=>new Promise(done=>{resolve=done;});const tick=f.sync.tick();
  f.sync.setEnabled(f.id,false);resolve(structuredClone(f.source));await tick;
  assert.equal(f.h.snapshot(f.id).revision,0);await f.sync.close();
  const next=new AutoSync({history:f.h,writer:f.writer});t.after(()=>next.close());assert.equal(next.status(f.id).enabled,false);
});
test('source rewrites stop both directions and never overwrite either transcript',async t=>{
  const f=await setup(t);f.addLocal();f.source.messages[0].text='rewritten';await f.sync.tick();
  assert.equal(f.sync.status(f.id).inbound.state,'conflict');assert.equal(f.sync.status(f.id).outbound.state,'conflict');assert.equal(f.deliveries.length,0);assert.equal(f.h.snapshot(f.id).source.messages[0].text,'old');
});
test('Kiro imports automatically but clearly reports its unsupported return path',async t=>{
  const f=await setup(t,'kiro');f.addLocal();await f.sync.tick();
  assert.equal(f.sync.status(f.id).inbound.state,'ready');assert.equal(f.sync.status(f.id).outbound.state,'unsupported');assert.equal(f.deliveries.length,0);
});

test('Kiro V3 automatically exchanges completed turns and never echoes imported source messages',async t=>{
  const f=await setup(t,'kiro-v3');f.addLocal();f.source.messages.push({id:'u2',role:'user',text:'native IRIS'},{id:'a2',role:'assistant',text:'received IRIS',status:'completed'});
  await f.sync.tick();f.advance();await f.sync.tick();assert.equal(applyUpdates(f.c,f.root),2);f.save();await f.sync.tick();
  assert.equal(f.sync.status(f.id).inbound.state,'ready');assert.equal(f.sync.status(f.id).outbound.state,'ready');assert.equal(f.deliveries.length,1);assert.doesNotMatch(f.deliveries[0].text,/IRIS|known/);
});
test('an active unified reply does not export a partial pair',async t=>{
  const f=await setup(t);f.addLocal();f.c.status='running';f.save();await f.sync.tick();assert.equal(f.deliveries.length,0);
  f.c.status='idle';f.save();await f.sync.tick();assert.equal(f.deliveries.length,1);
});
test('two windows cannot own the same synchronization loop',async t=>{
  const f=await setup(t);await f.sync.tick();
  const second=new AutoSync({history:f.h,writer:f.writer});t.after(()=>second.close());await second.tick();
  assert.match(second.status(f.id).error,/另一个窗口/);assert.throws(()=>second.setEnabled(f.id,false),/另一个窗口/);
});
test('a modified pending message is held rather than overwriting native history',async t=>{
  const f=await setup(t);f.addLocal();f.writer.deliver=async()=>{throw Error('offline');};await f.sync.tick();
  f.c.messages.at(-1).text='rewritten';f.save();f.advance();await f.sync.tick();assert.equal(f.sync.status(f.id).outbound.state,'conflict');
});

test('a stable failed V3 turn imports its submitted user message without inventing a reply',async t=>{
  const f=await setup(t,'kiro-v3');f.source.nativeStatus='failed';
  f.source.messages.push({id:'failed-user',role:'user',text:'native quota-stopped question',status:'completed'});
  await f.sync.tick();assert.equal(f.h.snapshot(f.id).revision,0);
  f.advance();await f.sync.tick();assert.equal(f.sync.status(f.id).inbound.state,'ready');
  assert.equal(applyUpdates(f.c,f.root),1);assert.equal(f.c.messages.at(-1).role,'user');
  assert.equal(f.c.messages.at(-1).text,'native quota-stopped question');f.save();
  f.addLocal();await f.sync.tick();assert.equal(f.deliveries.length,1);
  assert.doesNotMatch(f.deliveries[0].text,/quota-stopped/);
});
test('user-only tails stay pending for active, idle, unknown and legacy source states',async t=>{
  for(const [provider,status]of [['kiro-v3','running'],['kiro-v3','idle'],['kiro-v3',undefined],['kiro','failed'],['codex','failed']]){
    const f=await setup(t,provider);f.source.nativeStatus=status;
    f.source.messages.push({id:'waiting-user',role:'user',text:'unanswered',status:'completed'});
    await f.sync.tick();f.advance();await f.sync.tick();
    assert.equal(f.h.snapshot(f.id).revision,0);assert.equal(f.sync.status(f.id).inbound.state,'settling');
  }
});
