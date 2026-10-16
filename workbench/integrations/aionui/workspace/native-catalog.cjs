const {desktopProjects}=require('./codex-projects.cjs');
// Metadata only: catalog reads never create a session, import history or prompt a model.
class NativeCatalog {
  constructor({history,now=Date.now,ttl=30000,enrich=desktopProjects}) {
    this.history=history;this.now=now;this.ttl=ttl;this.enrich=enrich;this.cached=null;this.partial=null;this.pending=null;
  }
  async pages(read,onPage) {
    const result=new Map(),seen=new Set();let cursor;
    for(let page=0;page<1000;page++) {
      const next=await read(cursor);
      if(!Array.isArray(next.items))throw Error('Codex 列表格式不完整');
      for(const item of next.items)result.set(item.id,item);
      onPage?.([...result.values()]);
      if(!next.nextCursor)return [...result.values()];
      if(seen.has(next.nextCursor))throw Error('Codex 列表分页重复，保留上次列表');
      seen.add(next.nextCursor);cursor=next.nextCursor;
    }
    throw Error('Codex 列表未读取完整，保留上次列表');
  }
  async refresh() {
    let projects=[],projectWarning;
    try{projects=await this.pages(cursor=>this.history.reader.projects(cursor));}
    catch(e){
      // Older Codex versions can still expose threads without project/list.
      if(/method not found|unknown (method|variant)|-32601/i.test(e.message))projectWarning='此 Codex 版本不提供项目名称，暂按聊天文件夹显示';
      else throw e;
    }
    const view=items=>{
      let data={items,projects},warning=projectWarning;
      try{data=this.enrich(items,projects);}catch{warning='暂未读到 Codex 桌面的项目归属，列表将自动重试';}
      return {...data,updatedAt:this.now(),projectWarning:warning};
    };
    const items=await this.pages(cursor=>this.history.list('codex',cursor),items=>{
      this.partial=view(items);this.firstReady?.();
    });
    this.cached=view(items);this.partial=null;this.error=undefined;return this.cached;
  }
  async list() {
    if(!this.pending&&(!this.cached||this.now()-this.cached.updatedAt>=this.ttl)) {
      this.firstPage=new Promise(resolve=>{this.firstReady=resolve;});
      this.pending=this.refresh().catch(e=>{this.error=e.message;}).finally(()=>{this.pending=null;this.firstReady?.();});
    }
    if(!this.cached&&!this.partial)await this.firstPage;
    const catalog=this.cached||this.partial;
    if(!catalog)throw Error(this.error||'Codex 列表尚未就绪');
    const bindings=Object.fromEntries([...this.history.nativeEntries()].filter(([,e])=>e.conversationId).map(([id,e])=>[id,e.conversationId]));
    const mirrors=this.history.nativeMirrors(catalog.items);
    return {...catalog,items:catalog.items.filter(item=>!mirrors.has(item.id)),bindings,loading:!this.cached&&!!this.pending,catalogWarning:this.error};
  }
}
module.exports={NativeCatalog};
