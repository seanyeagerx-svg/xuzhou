const path = require('node:path');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const name='Codex / Kiro / ZCode · 同一对话';
async function ensureAssistant({backend,bridge,dataDir,configFile,command,endpoint}) {
  const catalog=await backend('/api/agents/management');
  if(!Array.isArray(catalog))throw Error('Invalid agent catalog');
  const original=catalog.find(a=>a.agent_source==='custom'&&(
    a.args?.some(arg=>same(arg,bridge))||
    ([name,'Codex / Kiro · 同一对话'].includes(a.name)&&a.args?.some(arg=>typeof arg==='string'&&/[\\/]integrations[\\/]aionui[\\/]bridge\.mjs$/.test(arg)))
  ));
  const args=[bridge,'--data-dir',dataDir,'--config',configFile];
  // AionCore CustomAgentUpsertRequest uses Vec<AgentEnvEntry>, not a string map.
  const env=(original?.env||[]).map(entry=>({...entry}));
  if(endpoint){const entry=env.find(entry=>entry.name==='AIONUI_WORKBENCH_ENDPOINT');if(entry)entry.value=endpoint;else env.push({name:'AIONUI_WORKBENCH_ENDPOINT',value:endpoint});}
  const changed=!original||original.name!==name||!same(original.command,command)||JSON.stringify(original.args)!==JSON.stringify(args)||JSON.stringify(original.env||[])!==JSON.stringify(env);
  const advanced=Object.fromEntries(['yolo_id','native_skills_dirs','behavior_policy'].filter(key=>original?.[key]!==undefined).map(key=>[key,original[key]]));
  const body={name,command,args,env,...(original?.icon?{icon:original.icon}:{}),advanced:{...advanced,description:'在同一段对话中切换 Codex、Kiro V3、ZCode 的原生模型，保留可见对话上下文。'}};
  const agent=changed?await backend(original?'/api/agents/custom/'+encodeURIComponent(original.id):'/api/agents/custom',original?'PUT':'POST',body):original;
  if(!agent?.id)throw Error('Agent registration did not return its identity');
  if(changed)await backend('/api/agents/'+encodeURIComponent(agent.id)+'/health-check','POST');
  const assistants=await backend('/api/assistants');
  const assistant=assistants.find(a=>a.agent_id===agent.id&&a.source==='generated');
  if(!assistant)throw Error('Unified conversation assistant is not ready');
  return assistant;
}
module.exports={ensureAssistant};
