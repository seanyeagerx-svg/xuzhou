const path = require('node:path');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const name='Codex / Kiro / ZCode · 同一对话';
async function ensureAssistant({backend,bridge,dataDir,configFile,command,endpoint,preferredProvider}) {
  const displayName=preferredProvider?({'codex':'Codex','kiro-v3':'Kiro V3',zcode:'ZCode'}[preferredProvider]):name;
  if(!displayName)throw Error('Unknown software provider');
  const catalog=await backend('/api/agents/management');
  if(!Array.isArray(catalog))throw Error('Invalid agent catalog');
  const original=catalog.find(a=>a.agent_source==='custom'&&((a.args?.includes('--preferred-provider')?a.args[a.args.indexOf('--preferred-provider')+1]:undefined)===preferredProvider)&&(
    a.args?.some(arg=>same(arg,bridge))||
    ([name,'Codex / Kiro · 同一对话'].includes(a.name)&&a.args?.some(arg=>typeof arg==='string'&&/[\\/]integrations[\\/]aionui[\\/]bridge\.mjs$/.test(arg)))
  ));
  const args=[bridge,'--data-dir',dataDir,'--config',configFile,...(preferredProvider?['--preferred-provider',preferredProvider]:[])];
  // AionCore CustomAgentUpsertRequest uses Vec<AgentEnvEntry>, not a string map.
  const env=(original?.env||[]).map(entry=>({...entry}));
  // Re-probe existing registrations once when the bridge transport contract changes.
  const protocol=env.find(entry=>entry.name==='XUZHOU_BRIDGE_PROTOCOL');
  if(protocol)protocol.value='team-stdio-v1';else env.push({name:'XUZHOU_BRIDGE_PROTOCOL',value:'team-stdio-v1'});
  if(endpoint){const entry=env.find(entry=>entry.name==='AIONUI_WORKBENCH_ENDPOINT');if(entry)entry.value=endpoint;else env.push({name:'AIONUI_WORKBENCH_ENDPOINT',value:endpoint});}
  const changed=!original||original.name!==displayName||!same(original.command,command)||JSON.stringify(original.args)!==JSON.stringify(args)||JSON.stringify(original.env||[])!==JSON.stringify(env)||(preferredProvider&&original.behavior_policy?.supports_team!==true);
  const advanced=Object.fromEntries(['yolo_id','native_skills_dirs','behavior_policy'].filter(key=>original?.[key]!==undefined).map(key=>[key,original[key]]));
  const body={name:displayName,command,args,env,...(original?.icon?{icon:original.icon}:{}),advanced:{...advanced,...(preferredProvider?{behavior_policy:{...original?.behavior_policy,supports_team:true}}:{}),description:'在同一段对话中切换 Codex、Kiro V3、ZCode 的原生模型，保留可见对话上下文。'}};
  const agent=changed?await backend(original?'/api/agents/custom/'+encodeURIComponent(original.id):'/api/agents/custom',original?'PUT':'POST',body):original;
  if(!agent?.id)throw Error('Agent registration did not return its identity');
  if(changed)await backend('/api/agents/'+encodeURIComponent(agent.id)+'/health-check','POST');
  const assistants=await backend('/api/assistants');
  const assistant=assistants.find(a=>a.agent_id===agent.id&&a.source==='generated');
  if(!assistant)throw Error('Unified conversation assistant is not ready');
  return assistant;
}
module.exports={ensureAssistant};
