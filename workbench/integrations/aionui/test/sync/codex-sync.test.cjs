const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {CodexHistoryWriter}=require('../../workspace/codex-sync.cjs');
function setup(t) {
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'codex-sync-')),source={id:'native',cwd},file=path.join(cwd,'rollout-native.jsonl');
  fs.writeFileSync(file,JSON.stringify({type:'session_meta',payload:{id:source.id,cwd}})+'\n');
  const calls=[],thread={id:source.id,cwd,path:file,turns:[]};let busy=false;
  const adapter=new EventEmitter();adapter.connect=async()=>{};adapter.close=()=>{};
  adapter.rpc={request:async(method,params)=>{calls.push(method);
    if(method==='thread/resume'&&busy)throw Error('already has an active writer');
    if(method==='thread/inject_items')fs.appendFileSync(file,JSON.stringify({type:'response_item',payload:params.items[0]})+'\n');
    return {thread};
  }};
  fs.mkdirSync(path.join(cwd,'imports'));
  const writer=new CodexHistoryWriter({directory:cwd,config:()=>({}),adapterFactory:()=>adapter});t.after(()=>{writer.close();fs.rmSync(cwd,{recursive:true,force:true});});
  return {writer,calls,source,thread,file,adapter,busy:()=>{busy=true;},batch:{text:'[AionUi synchronized history] test',key:'test'}};
}
test('returning history uses passive injection and verifies persistence without starting a turn',async t=>{
  const f=setup(t);await f.writer.deliver(f.source,f.batch);assert.equal(f.calls.filter(m=>m==='thread/inject_items').length,1);assert.ok(!f.calls.some(m=>m==='turn/start'));
});
test('a durable receipt resolves a lost reply without taking the native writer or duplicating a message',async t=>{
  const f=setup(t);await f.writer.deliver(f.source,f.batch);f.calls.length=0;f.busy();assert.equal((await f.writer.deliver(f.source,f.batch)).existing,true);assert.deepEqual(f.calls,['thread/read']);
});
test('another client ownership is respected',async t=>{
  const f=setup(t);f.busy();await assert.rejects(f.writer.deliver(f.source,f.batch),/active writer/);assert.ok(!f.calls.includes('thread/inject_items'));
});
test('a changed source identity prevents all writes',async t=>{
  const f=setup(t);f.thread.cwd=path.dirname(f.source.cwd);await assert.rejects(f.writer.deliver(f.source,f.batch),/项目已变化/);assert.ok(!f.calls.includes('thread/inject_items'));
});
test('a pause before acquiring ownership cannot inject',async t=>{
  const f=setup(t);await assert.rejects(f.writer.deliver(f.source,f.batch,()=>false),/暂停/);assert.equal(f.calls.length,0);
});

test('large passive returns archive every character and retry uses the same receipt even if native history advances',async t=>{
  const f=setup(t),messages=[{key:'large',role:'assistant',text:'中文🦞'.repeat(60000)}],batch={key:'long-batch',text:JSON.stringify(messages),messages};
  await f.writer.deliver(f.source,batch);
  const directory=path.join(f.source.cwd,'imports'),files=fs.readdirSync(directory);
  assert.equal(files.length,1);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,files[0]),'utf8')).messages,messages);
  const receipt=JSON.parse(fs.readFileSync(f.file,'utf8').trim().split('\n').at(-1));assert.ok(Buffer.byteLength(receipt.payload.content[0].text)<55000);
  assert.equal((await f.writer.deliver({...f.source,messages:[{text:'new native turn'}]},batch)).existing,true);
  assert.equal(f.calls.filter(m=>m==='thread/inject_items').length,1);assert.equal(fs.readdirSync(directory).length,1);
});
