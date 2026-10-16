// Xuzhou distribution: code lives in resources, mutable state lives in the selected user profile.
const fs = require('node:fs');
const path = require('node:path');
const {atomicJson} = require('../../../src/store.cjs');
const {resolveCodexCommand} = require('../../../src/agent-command.cjs');
function resolveBundledNode(resourcesDirectory,platform=process.platform,arch=process.arch) {
  const managed=path.join(resourcesDirectory,'bundled-aioncore',platform+'-'+arch,'managed-resources');
  const manifest=JSON.parse(fs.readFileSync(path.join(managed,'manifest.json'),'utf8'));
  const valid=part=>typeof part==='string'&&part.length>0&&!path.isAbsolute(part)&&!part.includes('\\')&&part.split('/').every(x=>x&&x!=='.'&&x!=='..');
  if(manifest.schemaVersion!==2||!valid(manifest.node?.root)||!valid(manifest.node?.executable))throw Error('Bundled Node resource contract is invalid');
  const command=path.join(managed,manifest.node.root,manifest.node.executable);
  if(!fs.statSync(command).isFile())throw Error('Bundled Node executable is missing');
  return command;
}
function preparePackagedRuntime({directory, legacyDirectory, sessionsDirectory, nodeCommand, localAppData=process.env.LOCALAPPDATA}) {
  const sessions = sessionsDirectory || path.join(directory, 'sessions-local');
  if (!path.isAbsolute(sessions) || !path.isAbsolute(directory)) throw Error('Absolute profile and session directories are required');
  fs.mkdirSync(sessions,{recursive:true});
  let configDirectory=legacyDirectory;
  const legacyFile=path.join(legacyDirectory,'workspace.json');
  if(fs.existsSync(legacyFile)) {
    const original=JSON.parse(fs.readFileSync(legacyFile,'utf8'));
    if(!Array.isArray(original.agents))throw Error('Existing integration configuration is invalid; it was not overwritten');
  } else {
    configDirectory=path.join(directory,'workbench');
    const file=path.join(configDirectory,'workspace.json');
    if(!fs.existsSync(file)) {
      const installedKiro=localAppData&&path.join(localAppData,'Kiro-Cli','kiro-cli.exe');
      atomicJson(file,{version:1,agents:[
        {id:'openclaw',name:'龙虾',role:'assistant',type:'openclaw',url:''},
        {id:'codex',name:'Codex',role:'executor',type:'codex',command:resolveCodexCommand('codex',localAppData)},
        {id:'kiro',name:'Kiro',role:'executor',type:'acp',command:installedKiro&&fs.existsSync(installedKiro)?installedKiro:'kiro-cli',args:['acp']},
      ],projects:[],conversations:[],tasks:[],maintenanceJobs:[],maintenanceProfile:{}});
    }
  }
  if(!nodeCommand || !path.isAbsolute(nodeCommand) || !fs.existsSync(nodeCommand))throw Error('Bundled Node runtime is missing');
  return {legacyDirectory:configDirectory,sessionsDirectory:sessions,nodeCommand,configFile:path.join(configDirectory,'workspace.json')};
}
module.exports={preparePackagedRuntime,resolveBundledNode};
