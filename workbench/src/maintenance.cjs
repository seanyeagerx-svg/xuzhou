const {Client}=require('ssh2');
const {EventEmitter}=require('node:events');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const dns=require('node:dns').promises;
const {execFileSync}=require('node:child_process');
function redact(value){return String(value).replace(/Bearer\s+[A-Za-z0-9._~+/=-]+|\bsk-[A-Za-z0-9_-]{12,}\b/gi,'[REDACTED]').replace(/((?:password|passwd|token|api[_-]?key|secret|authorization)["']?\s*[:=]\s*)[^\s,;]+/gi,'$1[REDACTED]');}
function scrub(value){if(typeof value==='string')return redact(value);if(Array.isArray(value))return value.map(scrub);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,scrub(v)]));return value;}
function validateProfile(data){
  const host=String(data.host||'').trim(),username=String(data.username||'').trim();
  if(!host || host.length>253 || !/^[a-zA-Z0-9.:_-]+$/.test(host))throw new Error('请填写服务器域名或 IP');
  if(!/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(username))throw new Error('请填写现有服务器登录用户名');
  const port=Number(data.port||22),httpPort=Number(data.httpPort||18789);
  if(!Number.isInteger(port)||port<1||port>65535||!Number.isInteger(httpPort)||httpPort<1||httpPort>65535)throw new Error('端口需要在 1 至 65535 之间');
  if(data.keyFile){try{if(!path.isAbsolute(data.keyFile)||!fs.statSync(data.keyFile).isFile())throw new Error();}catch{throw new Error('请选择现有 SSH 密钥文件');}}
  return {host,username,port,httpPort,scope:data.scope==='system'?'system':'user',keyFile:data.keyFile||''};
}
function hostEntryMatches(pattern,aliases){
  if(pattern.startsWith('|1|')){const [, ,salt,hash]=pattern.split('|');return aliases.some(a=>crypto.createHmac('sha1',Buffer.from(salt,'base64')).update(a).digest('base64')===hash);}
  return aliases.includes(pattern);
}
async function trustedKeys(profile,knownHosts=path.join(os.homedir(),'.ssh','known_hosts')){
  let aliases=[profile.host];try{aliases.push(...(await dns.lookup(profile.host,{all:true})).map(x=>x.address));}catch{}
  // The tailnet name and public SSH alias refer to the same registered peer.
  try{const status=JSON.parse(execFileSync('C:\\Program Files\\Tailscale\\tailscale.exe',['status','--json'],{encoding:'utf8',windowsHide:true,timeout:4000}));
    const peer=Object.values(status.Peer||{}).find(p=>p.DNSName?.replace(/\.$/,'')===profile.host || p.TailscaleIPs?.includes(profile.host));
    if(peer?.CurAddr){const address=peer.CurAddr.replace(/:\d+$/,'').replace(/^\[|\]$/g,'');aliases.push(address);}
  }catch{}
  aliases=aliases.flatMap(a=>profile.port===22?[a,'['+a+']:22']:['['+a+']:'+profile.port]);
  let text='';try{text=fs.readFileSync(knownHosts,'utf8');}catch{}
  const keys=[],revoked=[];
  for(const line of text.split(/\r?\n/)){let parts=line.trim().split(/\s+/);if(parts[0]?.startsWith('#')||parts.length<3)continue;
    const marker=parts[0].startsWith('@')?parts.shift():null;
    if(!parts[0].split(',').some(p=>hostEntryMatches(p,aliases)))continue;
    if(marker==='@revoked')revoked.push(parts[2]);else if(!marker)keys.push(parts[2]);
  }
  return {keys,revoked};
}
function validateOperation(args){
  if(!args || !['diagnose','start','recover'].includes(args.action))throw new Error('未知维护操作');
  if(args.heapMiB!==undefined && args.heapMiB!==null && (!Number.isInteger(args.heapMiB)||args.heapMiB<128||args.heapMiB>16384))throw new Error('内存堆上限不在可维护范围');
  if(args.action!=='recover' && (args.compactDatabase || args.heapMiB!=null))throw new Error('配置或压缩只适用于维护并恢复');
  return {action:args.action,compactDatabase:args.compactDatabase===true,heapMiB:args.heapMiB??null};
}
class Maintenance extends EventEmitter {
  constructor(getProfile,vault,options={}){super();this.getProfile=getProfile;this.vault=vault;this.Client=options.Client||Client;this.knownHosts=options.knownHosts;this.ready=false;this.generation=0;this.status={state:'disconnected',detail:'独立维修通道尚未连接'};}
  update(state,detail){this.ready=state==='connected';this.status={state,detail,host:this.getProfile()?.host||''};this.emit('status',this.status);}
  async connect(data={}){
    this.close();const profile=validateProfile(this.getProfile()||{}),generation=this.generation;
    const existing=await trustedKeys(profile,this.knownHosts),pinKey='maintenance-host:'+profile.host+':'+profile.port;
    if(generation!==this.generation)throw new Error('连接请求已取消');
    const pinned=this.vault.get(pinKey),conn=new this.Client();this.client=conn;this.profile=profile;
    this.update('connecting','正在连接独立维修通道');
    return new Promise((resolve,reject)=>{
      let settled=false;
      const fail=e=>{if(generation!==this.generation || (settled && this.status.state==='error'))return;if(!settled){settled=true;reject(new Error(redact(e.message)));}this.update('error',redact(e.message));};
      conn.on('error',fail);conn.on('close',()=>{if(generation===this.generation){if(!settled){settled=true;reject(new Error('服务器连接已结束'));}this.update('disconnected','独立维修通道已断开');}});
      conn.on('ready',()=>{if(generation!==this.generation){conn.end();return;}settled=true;this.update('connected','独立维修已连接 · '+profile.host);resolve(this.status);});
      const auth={host:profile.host,username:profile.username,port:profile.port,readyTimeout:90000,keepaliveInterval:30000,keepaliveCountMax:3,
        hostVerifier:(key,callback)=>{
          const encoded=key.toString('base64'),fingerprint='SHA256:'+crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/,'');
          if(existing.revoked.includes(encoded) || (pinned && pinned!==encoded)){fail(new Error('服务器身份发生变化，已停止连接；请核对服务器后再处理'));callback(false);return;}
          if(pinned===encoded || existing.keys.includes(encoded)){callback(true);return;}
          const timer=setTimeout(()=>{this.pendingTrust=null;callback(false);},60000);
          this.pendingTrust={fingerprint,host:profile.host,port:profile.port,resolve:allow=>{clearTimeout(timer);this.pendingTrust=null;try{if(allow)this.vault.set(pinKey,encoded);callback(!!allow);}catch(e){fail(e);callback(false);}}};
          this.emit('host-key',{host:profile.host,port:profile.port,fingerprint});
        }};
      if(profile.keyFile){auth.privateKey=fs.readFileSync(profile.keyFile);if(data.passphrase)auth.passphrase=data.passphrase;}
      else if(data.password)auth.password=data.password;
      else {reject(new Error('请填写本次登录密码，或选择现有 SSH 密钥'));this.update('disconnected','等待服务器登录');return;}
      try{conn.connect(auth);}catch(e){fail(e);conn.end();}
    });
  }
  trust(allow){if(!this.pendingTrust)throw new Error('身份核对请求已结束');this.pendingTrust.resolve(allow);}
  exec(command,timeout=30000){
    if(!this.ready)return Promise.reject(new Error('请先在 AI 与连接中登录独立维修通道'));
    const current=this.client;
    return new Promise((resolve,reject)=>{current.exec(command,(err,stream)=>{
      if(err)return reject(new Error(redact(err.message)));let out='',error='',done=false;
      const timer=setTimeout(()=>{done=true;stream.close();reject(new Error('服务器操作等待超时'));},timeout);
      const append=(chunk,isError)=>{if(done)return;if(out.length+error.length+chunk.length>4*1024*1024){done=true;clearTimeout(timer);stream.close();reject(new Error('服务器输出过长，已停止读取'));return;}if(isError)error+=chunk;else out+=chunk;};
      stream.on('data',d=>append(d.toString('utf8'),false));stream.stderr.on('data',d=>append(d.toString('utf8'),true));
      stream.on('error',e=>{if(done)return;done=true;clearTimeout(timer);reject(new Error(redact(e.message)));});
      stream.on('close',code=>{if(done)return;done=true;clearTimeout(timer);if(code!==0)return reject(new Error(redact(error||out||'服务器操作失败').slice(-4000)));resolve(out);});
    });});
  }
  python(source,timeout){const b64=Buffer.from(source).toString('base64');return this.exec("python3 -c 'import base64;exec(base64.b64decode("+JSON.stringify(b64)+"))'",timeout);}
  async diagnose(){
    const profile=validateProfile(this.profile||this.getProfile()||{});
    const source=`import subprocess,json,re
ctl=['systemctl']+(${JSON.stringify(profile.scope)}=='user' and ['--user'] or [])
def run(a,t=20):
 try:
  r=subprocess.run(a,capture_output=True,text=True,timeout=t);s=r.stdout+r.stderr
  s=re.sub(r'(?i)Bearer\\s+[A-Za-z0-9._~+/=-]+|\\bsk-[A-Za-z0-9_-]{12,}\\b','[REDACTED]',s)
  s=re.sub(r'(?i)((?:password|token|secret|api[_-]?key|authorization)["\\x27]?\\s*[:=]\\s*)[^\\s,;]+',r'\\1[REDACTED]',s)
  return {'exit':r.returncode,'output':s[-18000:]}
 except Exception as e:return {'error':str(e)}
jctl=['journalctl']+(${JSON.stringify(profile.scope)}=='user' and ['--user'] or [])
print(json.dumps({'service':run(ctl+['show','openclaw-gateway.service','-p','LoadState','-p','ActiveState','-p','SubState','-p','MainPID','-p','NRestarts']), 'logs':run(jctl+['-u','openclaw-gateway.service','-n','60','--no-pager']), 'disk':run(['df','-h',str(__import__('pathlib').Path.home())]), 'memory':run(['free','-m']), 'ready':run(['curl','--noproxy','*','--silent','--max-time','5','http://127.0.0.1:${profile.httpPort}/readyz'])},ensure_ascii=True))`;
    return scrub(JSON.parse(await this.python(source,90000)));
  }
  async launch(args,jobId=crypto.randomUUID()){
    const op=validateOperation(args);if(op.action==='diagnose')return this.diagnose();
    const profile=validateProfile(this.profile||this.getProfile()||{});
    if(!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(jobId))throw new Error('维护任务编号无效');
    const id=jobId,worker=fs.readFileSync(path.join(__dirname,'maintenance-worker.py')).toString('base64');
    const request=Buffer.from(JSON.stringify({id,...op,scope:profile.scope,httpPort:profile.httpPort})).toString('base64');
    const source=`import os,json,base64,subprocess,pathlib
root=pathlib.Path.home()/'.openclaw'/'workbench-maintenance'
root.mkdir(parents=True,exist_ok=True,mode=0o700)
p=root/${JSON.stringify(id)}
p.mkdir(mode=0o700)
(p/'worker.py').write_bytes(base64.b64decode(${JSON.stringify(worker)}))
(p/'request.json').write_bytes(base64.b64decode(${JSON.stringify(request)}))
os.chmod(p/'worker.py',0o600);os.chmod(p/'request.json',0o600)
env=os.environ.copy()
if ${JSON.stringify(profile.scope)}=='user':env.setdefault('XDG_RUNTIME_DIR','/run/user/'+str(os.getuid()))
cmd=['systemd-run']+(${JSON.stringify(profile.scope)}=='user' and ['--user'] or [])+['--quiet','--collect','--unit=workbench-recovery-${id}',__import__('sys').executable,str(p/'worker.py'),str(p)]
r=subprocess.run(cmd,capture_output=True,text=True,env=env)
if r.returncode:raise RuntimeError(r.stderr.strip())
print(json.dumps({'id':${JSON.stringify(id)},'action':${JSON.stringify(op.action)},'state':'running','phase':'queued','host':${JSON.stringify(profile.host)},'username':${JSON.stringify(profile.username)},'port':${profile.port},'startedAt':__import__('time').time()},ensure_ascii=True))`;
    return JSON.parse(await this.python(source,30000));
  }
  async job(id){
    if(!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id))throw new Error('维护任务编号无效');
    const source=`import pathlib,json,subprocess,time
folder=pathlib.Path.home()/'.openclaw'/'workbench-maintenance'/${JSON.stringify(id)}
if not (folder/'request.json').is_file():raise RuntimeError('服务器没有这个维护任务')
p=folder/'report.json'
r=json.loads(p.read_text()) if p.exists() else {'id':${JSON.stringify(id)},'state':'running','phase':'queued'}
if r.get('state')=='running':
 ctl=['systemctl']+(${JSON.stringify(this.profile.scope)}=='user' and ['--user'] or [])
 unit=subprocess.run(ctl+['show','workbench-recovery-${id}.service','-p','ActiveState','--value'],capture_output=True,text=True,timeout=10)
 if unit.stdout.strip() not in ('active','activating','deactivating'):
  r.update(state='failed',phase='interrupted',error='独立维修进程已结束，未取得恢复成功报告；请检查服务和保留的备份。',finishedAt=time.time())
print(json.dumps(r))`;
    const report=scrub(JSON.parse(await this.python(source,20000)));
    if(report.state==='completed' && (report.verification?.readiness?.ready!==true || report.verification?.service?.ActiveState!=='active' || report.verification?.service?.SubState!=='running'))throw new Error('维修报告缺少服务运行与就绪验证，尚不能确认恢复完成');
    return report;
  }
  close(){this.generation++;if(this.pendingTrust){this.pendingTrust.resolve(false);this.pendingTrust=null;}this.client?.end();this.client=null;this.ready=false;this.status={state:'disconnected',detail:'独立维修通道尚未连接'};}
}
module.exports={Maintenance,validateProfile,validateOperation,trustedKeys,redact};
