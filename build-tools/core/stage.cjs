const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {createRequire,isBuiltin}=require('node:module');
const base=path.resolve(__dirname,'../..'),root=path.resolve(base,'../..');
const repo=path.join(root,'evidence/aionui-review-2026-10-14/AionUi');
const build=process.argv[2]||path.resolve(__dirname, '../..'),stage=path.join(build,'desktop');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
if(fs.existsSync(stage)&&!process.argv.includes('--resume'))throw Error('Staging directory already exists; use --resume for this owned build staging area');
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:repo,encoding:'utf8'}).split('\0').filter(Boolean);
for(const rel of files){
  if(/(^|\/)(node_modules|out|dist|evidence|profile-local|sessions-local|backup|backups|\.git)(\/|$)|(^|\/)\.env(?:\.|$)|settings\.local\.json$/.test(rel))continue;
  const from=path.join(repo,rel),to=path.join(stage,rel);
  if(!fs.existsSync(from)||!fs.statSync(from).isFile())continue;
  fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);
}
if(!fs.existsSync(path.join(stage,'node_modules')))fs.symlinkSync(path.join(repo,'node_modules'),path.join(stage,'node_modules'),'junction');
const workbench=path.join(stage,'resources/workbench'),integration=path.join(workbench,'integrations/aionui');
function copyCode(dir,dest){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const from=path.join(dir,entry.name),to=path.join(dest,entry.name);
    if(entry.isDirectory())copyCode(from,to);
    else if(/\.(cjs|mjs)$/.test(entry.name)){fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);}
  }
}
for(const folder of ['lobster','workspace','kiro','distribution'])copyCode(path.join(base,folder),path.join(integration,folder));
for(const file of ['bridge.mjs','service.mjs','store.mjs','package.json']){fs.mkdirSync(integration,{recursive:true});fs.copyFileSync(path.join(base,file),path.join(integration,file));}
const ownSource=['adapters.cjs','agent-command.cjs','companion.cjs','conversation-routing.cjs','dpapi.cjs','lobster-hub.cjs','lobster-mcp.cjs','maintenance.cjs','maintenance-worker.py','message-sync.cjs','native-app.cjs','native-history.cjs','native-window.ps1','openclaw.cjs','rpc.cjs','session-options.cjs','store.cjs','zcode.cjs'];
for(const file of ownSource){fs.mkdirSync(path.join(workbench,'src'),{recursive:true});fs.copyFileSync(path.join(root,'src',file),path.join(workbench,'src',file));}
fs.writeFileSync(path.join(workbench,'package.json'),JSON.stringify({name:'xuzhou-workbench-bridge',version:'0.9.0',license:'Apache-2.0',private:true},null,2));
fs.copyFileSync(path.join(repo,'LICENSE'),path.join(workbench,'LICENSE'));
const dependencyRows=[];
function copyPackage(name,from,targetModules,ancestors=new Set()){
  const req=createRequire(path.join(from,'package.json'));
  const location=req.resolve.paths('__lookup__').map(d=>path.join(d,name)).find(d=>fs.existsSync(path.join(d,'package.json')));
  if(!location)throw Error('Required bridge dependency missing: '+name);
  const source=fs.realpathSync(location),p=JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8')),identity=p.name+'@'+p.version;
  if(ancestors.has(identity))return;
  const target=path.join(targetModules,name);
  fs.cpSync(source,target,{recursive:true,dereference:true,filter:from=>!from.slice(source.length).split(path.sep).some(part=>['node_modules','test','tests','examples','.git'].includes(part))});
  dependencyRows.push({name:p.name,version:p.version,license:p.license,manifestSha256:hash(fs.readFileSync(path.join(source,'package.json')))});
  for(const child of Object.keys({...p.dependencies,...p.peerDependencies})){
    if(p.peerDependenciesMeta?.[child]?.optional)continue;
    copyPackage(child,source,path.join(target,'node_modules'),new Set([...ancestors,identity]));
  }
}
for(const [name,from] of [['ssh2',root],['ws',root],['@agentclientprotocol/sdk',base]])copyPackage(name,from,path.join(workbench,'node_modules'));
const config=path.join(stage,'packages/desktop/electron-builder.yml');
fs.appendFileSync(config,'\n# Xuzhou runtime bridge is copied as code only; user profiles are never bundled.\n');
const filesBlock=`files:\n  - out/main/**/*\n  - out/preload/**/*\n  - out/renderer/**/*\n  - package.json\n  - '!**/*.map'\n  - '!**/{profile,profile-local,sessions-local,backup,backups,evidence,.codex,.kiro,.ssh}/**'\n  - '!**/{auth,credentials,secrets}.json'\n  - '!**/*.pem'\n  - from: out/main/static\n    to: static\n\n`;
const yaml=fs.readFileSync(config,'utf8').replace('  app: .\n','  app: release-app\n').replace(/files:\n[\s\S]*?(?=extraResources:\n)/,filesBlock).replace('extraResources:\n','extraResources:\n  - from: resources/workbench\n    to: workbench\n  - from: resources/workbench/node_modules\n    to: workbench/node_modules\n');fs.writeFileSync(config,yaml);
const mainOutput=path.join(stage,'out/main'),releaseDependencies=new Set();
if(fs.existsSync(mainOutput)){
  for(const file of fs.readdirSync(mainOutput).filter(f=>f.endsWith('.js'))){
    const text=fs.readFileSync(path.join(mainOutput,file),'utf8');
    for(const match of text.matchAll(/require\(["']([^"']+)["']\)/g)){
      const name=match[1];if(name.startsWith('.')||name==='electron'||isBuiltin(name))continue;
      releaseDependencies.add(name.startsWith('@')?name.split('/').slice(0,2).join('/'):name.split('/')[0]);
    }
  }
  const pkgFile=path.join(stage,'package.json'),pkg=JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8'));
  const original=pkg.dependencies;pkg.dependencies=Object.fromEntries([...releaseDependencies].sort().map(name=>{if(!original[name])throw Error('Unlisted main-process dependency: '+name);return [name,original[name]];}));
  fs.writeFileSync(pkgFile,JSON.stringify(pkg,null,2)+'\n');
}
fs.mkdirSync(path.join(stage,'resources/hub'),{recursive:true});
const hub=path.join(base,'runtime/resources/hub'),index=JSON.parse(fs.readFileSync(path.join(hub,'index.json'),'utf8'));
const hubRows=[];
for(const ext of Object.values(index.extensions)){
  const filename=path.basename(ext.dist.tarball),bytes=fs.readFileSync(path.join(hub,filename));
  if('sha512-'+crypto.createHash('sha512').update(bytes).digest('base64')!==ext.dist.integrity)throw Error('Hub extension integrity mismatch: '+filename);
  const entries=execFileSync('tar',['-tf',path.join(hub,filename)],{encoding:'utf8'}).trim().split(/\r?\n/);
  if(entries.some(n=>!['aion-extension.json','scripts/','scripts/install.ts'].includes(n)))throw Error('Unexpected executable or asset in Hub extension');
  fs.copyFileSync(path.join(hub,filename),path.join(stage,'resources/hub',filename));
  hubRows.push({name:ext.name,version:ext.version,file:filename,sha256:hash(bytes),sourceCommit:'ebc6a2bc3a84c5bbc4436939abe879cf9c8478c2',license:'Apache-2.0',entries});
}
for(const file of ['index.json','manifest.json'])fs.copyFileSync(path.join(hub,file),path.join(stage,'resources/hub',file));
fs.copyFileSync(path.join(build,'evidence/hub-source-LICENSE.txt'),path.join(stage,'resources/hub/LICENSE'));
fs.writeFileSync(path.join(build,'evidence/desktop-stage.json'),JSON.stringify({stage,sourceRepo:repo,releaseDependencies:[...releaseDependencies],bridgePackages:dependencyRows,hub:hubRows,privateUserDataCopied:false},null,2));
console.log(JSON.stringify({stage,bridgePackages:dependencyRows.length,hubExtensions:hubRows.length,privateUserDataCopied:false}));
