// Copyright 2026 Xuzhou contributors. SPDX-License-Identifier: Apache-2.0.
const fs=require('node:fs'),path=require('node:path');
const {CodexAdapter}=require('../../../../src/adapters.cjs');
const {KiroV3Adapter}=require('../../kiro/adapter.cjs');
const {ZcodeAdapter}=require('../../../../src/zcode.cjs');
class ModelCatalog {
  constructor(config,root){this.config=path.resolve(config);this.root=path.resolve(root);this.pending=null;this.cached=null;}
  async read(cwd,refresh=false){
    if(this.cached&&!refresh&&Date.now()-this.cached.checkedAt<300000)return this.cached;
    if(this.pending)return this.pending;
    this.pending=this.discover(cwd).finally(()=>{this.pending=null;});return this.pending;
  }
  async discover(cwd){
    const {readAgents}=await import('../../service.mjs');
    cwd=cwd&&path.isAbsolute(cwd)&&fs.existsSync(cwd)?cwd:this.root;fs.mkdirSync(cwd,{recursive:true});
    const agents=readAgents(this.config).filter(a=>!a.legacy),models=[],errors=[];
    await Promise.all(agents.map(async config=>{
      const a=config.id==='kiro-v3'?new KiroV3Adapter(config):config.id==='zcode'?new ZcodeAdapter(config):new CodexAdapter(config);
      a.on('approval',p=>a.approve(p.requestId,'deny'));
      try{
        await a.connect(cwd);let options;
        if(a.modelCatalog)options=await a.modelCatalog(cwd);
        else {const native=await a.newSession(cwd);options=native.options||a.sessionOptions(native.id);await a.release?.(native.id);}
        for(const m of options.models||[])models.push({id:config.id+'/'+encodeURIComponent(m.id),label:`${m.name||m.id} · ${config.name}`,provider:config.id,description:m.description,efforts:m.efforts||[],defaultEffort:m.defaultEffort||null});
      }catch(e){errors.push({provider:config.id,message:e.message});}finally{a.close();}
    }));
    return this.cached={models,errors,checkedAt:Date.now()};
  }
}
module.exports={ModelCatalog};
