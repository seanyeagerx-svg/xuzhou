// Copyright 2026 Xuzhou contributors. SPDX-License-Identifier: Apache-2.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { SessionStore } from '../../store.mjs';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'xuzhou-storage-'));
  const store=new SessionStore(root),id=crypto.randomUUID(),file=store.file(id);
  store.claim(id);store.save({id,messages:[{role:'user',text:'preserve old record'}]});
  const before=fs.readFileSync(file,'utf8'),rename=fs.renameSync;
  t.after(()=>{fs.renameSync=rename;store.release(id);fs.rmSync(root,{recursive:true,force:true});});
  return {root,store,id,file,before,rename};
}

test('a temporary Windows rename lock retries without removing the previous chat',t=>{
  const f=fixture(t);let attempts=0;
  fs.renameSync=(from,to)=>{
    if(to===f.file&&++attempts<3){assert.equal(fs.readFileSync(f.file,'utf8'),f.before);throw Object.assign(Error('sharing violation'),{code:'EPERM'});}
    return f.rename(from,to);
  };
  f.store.save({id:f.id,messages:[{role:'user',text:'preserve old record'},{role:'assistant',text:'new reply'}]});
  assert.equal(attempts,3);assert.equal(f.store.read(f.id).messages.length,2);
  assert.deepEqual(fs.readdirSync(f.root).filter(n=>n.endsWith('.tmp')),[]);
});

test('a non-transient storage failure preserves the old chat and never acknowledges a new record',t=>{
  const f=fixture(t);let attempts=0;
  fs.renameSync=(_from,to)=>{assert.equal(to,f.file);attempts++;throw Object.assign(Error('disk unavailable'),{code:'EIO'});};
  assert.throws(()=>f.store.save({id:f.id,messages:[]}),/disk unavailable/);
  assert.equal(attempts,1);assert.equal(fs.readFileSync(f.file,'utf8'),f.before);
  assert.deepEqual(fs.readdirSync(f.root).filter(n=>n.endsWith('.tmp')),[]);
});
