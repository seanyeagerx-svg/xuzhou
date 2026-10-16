const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const maxFile=64*1024*1024;
const timestamp=value=>typeof value==='number'?(value<1e12?value*1000:value):Date.parse(value)||0;
function limited(text,limit=24000){const s=String(text||'');return s.length>limit?s.slice(0,limit)+'\n[这条执行记录过长，此处仅带入前 '+limit+' 字；完整记录仍在原软件中。]':s;}
function contentText(content,kind='codex'){
 if(typeof content==='string')return content;
 return (content||[]).map(x=>{
  const type=x.type||x.kind;if(['text','input_text','output_text'].includes(type))return x.text??x.data??'';
  if(type==='toolResult')return limited(contentText(x.data?.content,'kiro'));
  if(['image','localImage','image_url','audio','resource','resource_link'].includes(type))return '[附件未带入；需要时请在原软件查看或重新提供。]';
  return '';
 }).filter(Boolean).join('\n');
}
function codexTranscript(thread){
 const messages=[];for(const turn of thread.turns||[])for(const [index,item]of(turn.items||[]).entries()){
  const common={id:'codex:'+thread.id+':'+(item.id||turn.id+':'+index),createdAt:timestamp(turn.startedAt||thread.createdAt),status:turn.status==='inProgress'?'interrupted':'completed'};
  if(item.type==='userMessage'){const text=contentText(item.content);if(text)messages.push({...common,role:'user',text});}
  else if(item.type==='agentMessage'&&item.text)messages.push({...common,role:'assistant',agentId:'codex',agentName:'Codex',text:item.text});
  else if(['commandExecution','fileChange','mcpToolCall','webSearch'].includes(item.type)){
   const detail={type:item.type,command:item.command,status:item.status,exitCode:item.exitCode,output:item.aggregatedOutput,changes:item.changes,tool:item.tool,server:item.server,result:item.result,action:item.action};
   messages.push({...common,role:'status',context:true,text:'历史执行记录（仅供参考）：\n'+limited(JSON.stringify(detail))});
  }
 }
 return messages;
}
function kiroTranscript(rows,sessionId,createdAt){
 const messages=[];for(const [index,row]of rows.entries()){
  const d=row.data||{},common={id:'kiro:'+sessionId+':'+(d.message_id||index),createdAt:timestamp(d.meta?.timestamp||createdAt),status:'completed'};
  if(['Prompt','AssistantMessage'].includes(row.kind)){
   const text=contentText(d.content,'kiro');if(text)messages.push({...common,role:row.kind==='Prompt'?'user':'assistant',...(row.kind==='AssistantMessage'?{agentId:'kiro',agentName:'Kiro'}:{}),text});
  }else if(row.kind==='ToolResults'){
   const text=contentText(d.content,'kiro');if(text)messages.push({...common,role:'status',context:true,text:'历史工具结果（仅供参考）：\n'+limited(text)});
  }
 }
 return messages;
}
class NativeHistory{
 constructor({getAdapter,getConfig}){this.getAdapter=getAdapter;this.getConfig=getConfig;}
 kiroDirectory(){const c=this.getConfig('kiro');return path.join(c.env?.KIRO_HOME||process.env.KIRO_HOME||path.join(process.env.USERPROFILE||process.env.HOME,'.kiro'),'sessions','cli');}
 kiroFile(id,extension){if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(id))throw Error('原对话编号无效');return path.join(this.kiroDirectory(),id+extension);}
 async readFile(file){const stat=await fs.promises.stat(file);if(stat.size>maxFile)throw Error('原对话记录超过 64 MB，请先在原软件整理或导出较短的对话。');return fs.promises.readFile(file,'utf8');}
 async list(agentId,cursor){
  if(agentId==='codex'){
   const a=await this.getAdapter(agentId),r=await a.rpc.request('thread/list',{limit:50,archived:false,...(cursor?{cursor}:{})});
   return {items:r.data.filter(t=>!t.ephemeral&&!t.parentThreadId).map(t=>({id:t.id,agentId,title:t.name||t.preview?.split('\n')[0]?.slice(0,90)||'未命名对话',cwd:t.cwd||'',updatedAt:timestamp(t.updatedAt),model:t.model||null,...('projectId' in t?{projectId:t.projectId}:{})})),nextCursor:r.nextCursor||null,detail:'Codex 本机历史；沿用原项目归属。'};
  }
  if(agentId!=='kiro')throw Error('目前可从 Codex 和 Kiro 带入原生历史。');
  let files;try{files=await fs.promises.readdir(this.kiroDirectory());}catch(e){if(e.code==='ENOENT')return {items:[],nextCursor:null,detail:'没有找到 Kiro CLI / Crew 的本地历史。Kiro IDE、云端或其他版本的历史尚未接入。'};throw e;}
  const items=[];let unreadable=0;
  for(const file of files.filter(f=>f.endsWith('.json'))){try{const j=JSON.parse(await this.readFile(path.join(this.kiroDirectory(),file)));if(!j.session_id||!['v1','v2'].includes(j.session_state?.version))continue;const log=this.kiroFile(j.session_id,'.jsonl');if(!fs.existsSync(log)||!fs.statSync(log).size)continue;items.push({id:j.session_id,agentId,title:j.title||'未命名对话',cwd:j.cwd||'',updatedAt:timestamp(j.updated_at),model:j.session_state?.rts_model_state?.model_info?.model_name||null});}catch{unreadable++;}}
  items.sort((a,b)=>b.updatedAt-a.updatedAt);return {items,nextCursor:null,detail:'读取 Kiro CLI / Crew 的本地 V2 记录；Kiro IDE 和云端历史尚未接入。'+(unreadable?' 有 '+unreadable+' 份记录暂时无法读取。':'')};
 }
 async projects(cursor){
  const a=await this.getAdapter('codex'),r=await a.rpc.request('project/list',{limit:100,...(cursor?{cursor}:{})});
  return {items:r.data.map(p=>({id:p.id,name:p.name,roots:(p.roots||[]).map(r=>r.path).filter(p=>typeof p==='string')})),nextCursor:r.nextCursor||null};
 }
 async read(agentId,id){
  if(typeof id!=='string'||!id||id.length>200)throw Error('原对话编号无效');
  if(agentId==='codex'){
   const a=await this.getAdapter(agentId),{thread}=await a.rpc.request('thread/read',{threadId:id,includeTurns:true});
   return {id:thread.id,agentId,title:thread.name||thread.preview?.split('\n')[0]?.slice(0,90)||'Codex 历史对话',cwd:thread.cwd,updatedAt:timestamp(thread.updatedAt),model:thread.model,messages:codexTranscript(thread)};
  }
  if(agentId!=='kiro')throw Error('目前可从 Codex 和 Kiro 带入原生历史。');
  const meta=JSON.parse(await this.readFile(this.kiroFile(id,'.json')));if(meta.session_id!==id||!['v1','v2'].includes(meta.session_state?.version))throw Error('此版本的 Kiro 历史暂不支持直接读取。');
  const raw=await this.readFile(this.kiroFile(id,'.jsonl')),lines=raw.split(/\r?\n/);const rows=[];
  for(const [index,line]of lines.entries()){if(!line.trim())continue;try{rows.push(JSON.parse(line));}catch{throw Error('原对话记录正在写入或格式不完整，请稍后重新读取（第 '+(index+1)+' 行）。');}}
  return {id,agentId,title:meta.title||'Kiro 历史对话',cwd:meta.cwd,updatedAt:timestamp(meta.updated_at),model:meta.session_state?.rts_model_state?.model_info?.model_name,messages:kiroTranscript(rows,id,meta.created_at)};
 }
}
function originalProjectRoot(cwd){
 if(typeof cwd!=='string'||!cwd)throw Error('原对话没有本地项目路径；请选择带入当前项目。');
 const value=cwd.replace(/^\\\\\?\\/,'');if(!path.isAbsolute(value)||!fs.existsSync(value)||!fs.statSync(value).isDirectory())throw Error('原项目文件夹现在不可用；请选择带入当前项目。');return fs.realpathSync(value);
}
function importedConversation(source,projectId,kind='chat'){
 if(!source.messages.length)throw Error('原对话没有可带入的消息。');
 return {id:crypto.randomUUID(),agentId:source.agentId,originAgentId:source.agentId,projectId,kind,title:source.title,remoteId:null,model:null,status:'idle',messages:source.messages.map(m=>({...m,sourceMessageId:m.id,id:crypto.randomUUID()})),activities:[],createdAt:Date.now(),updatedAt:Date.now(),nativeSource:{agentId:source.agentId,id:source.id,cwd:source.cwd,updatedAt:source.updatedAt,readAt:Date.now()}};
}
function mergeSource(c,source){
 if(c.nativeSource?.agentId!==source.agentId||c.nativeSource?.id!==source.id)throw Error('原对话来源不匹配');
 const existing=new Map(c.messages.filter(m=>m.sourceMessageId).map(m=>[m.sourceMessageId,m]));let added=0,updated=0;
 for(const m of source.messages){const old=existing.get(m.id);if(old){if(old.text!==m.text||old.status!==m.status){old.text=m.text;old.status=m.status;updated++;}}else{c.messages.push({...m,sourceMessageId:m.id,id:crypto.randomUUID()});added++;}}
 if(added||updated){for(const r of Object.values(c.routes||{}))r.contextUncertain=true;c.updatedAt=Date.now();}
 Object.assign(c.nativeSource,{updatedAt:source.updatedAt,readAt:Date.now()});return {added,updated};
}
module.exports={NativeHistory,codexTranscript,kiroTranscript,importedConversation,mergeSource,originalProjectRoot};
