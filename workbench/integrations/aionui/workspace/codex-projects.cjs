const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
// Some desktop builds retain project membership in UI state after migrating
// project names to app-server. Read only these metadata fields; never write it.
function desktopProjects(items,projects,home=process.env.CODEX_HOME||path.join(os.homedir(),'.codex')) {
  const file=path.join(home,'.codex-global-state.json');
  if(!fs.existsSync(file))return {items,projects};
  if(fs.statSync(file).size>8*1024*1024)throw Error('Codex 项目资料过大，暂未补充桌面归属');
  const state=JSON.parse(fs.readFileSync(file,'utf8'));
  const assignments=state['thread-project-assignments']||{},local=state['local-projects']||{};
  const hosts=state['thread-project-membership-host-ids']||{},free=new Set(state['projectless-thread-ids']||[]);
  const mapping=state['app-server-project-id-by-legacy-project-id-by-host']?.['local:'+home]||{};
  const groups=new Map(projects.map(p=>[p.id,p]));
  const result=items.map(item=>{
    if(item.projectId||free.has(item.id)||hosts[item.id]&&hosts[item.id]!=='local')return item;
    const assignment=assignments[item.id],legacy=local[assignment?.projectId];
    if(!legacy||!Array.isArray(legacy.rootPaths)||!legacy.rootPaths.length)return item;
    const id=mapping[assignment.projectId]||'desktop:'+assignment.projectId;
    if(!groups.has(id))groups.set(id,{id,name:legacy.name||legacy.rootPaths[0],roots:legacy.rootPaths.filter(r=>typeof r==='string')});
    return {...item,projectId:id};
  });
  return {items:result,projects:[...groups.values()]};
}
module.exports={desktopProjects};
