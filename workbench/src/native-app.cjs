const fs=require('node:fs'),path=require('node:path'),{spawn,execFileSync}=require('node:child_process');
function discoverGrok(){
  const candidates=[path.join(process.env.LOCALAPPDATA||'','Programs','Grok Bot','Grok Bot.exe'),path.join(process.env.LOCALAPPDATA||'','Grok Bot','Grok Bot.exe')];
  if(process.platform==='win32')try{
    const script="$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $ws=New-Object -ComObject WScript.Shell; $paths=@((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Grok Bot.lnk'),(Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Grok Bot.lnk')); foreach($p in $paths){if(Test-Path -LiteralPath $p){[Console]::WriteLine($ws.CreateShortcut($p).TargetPath)}}";
    candidates.unshift(...execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:5000}).trim().split(/\r?\n/));
  }catch{}
  return candidates.find(p=>p&&path.isAbsolute(p)&&path.basename(p).toLowerCase()==='grok bot.exe'&&fs.existsSync(p))||null;
}
function validBounds(b){if(!b||!['x','y','width','height'].every(k=>Number.isFinite(b[k]))||b.width<1||b.height<1)throw new Error('Grok Bot 显示区域无效');return {x:Math.max(0,b.x),y:Math.max(0,b.y),width:Math.min(b.width,20000),height:Math.min(b.height,20000)};}
class NativeApp {
  constructor(win,executable,onStatus=()=>{}){this.win=win;this.executable=executable;this.onStatus=onStatus;this.pending=new Map();this.seq=0;this.info={installed:!!executable,attached:false,state:'idle'};}
  startHelper(){
    if(this.helper&&!this.helper.killed)return;
    const script=fs.readFileSync(path.join(__dirname,'native-window.ps1'),'utf8');
    this.helper=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const helper=this.helper;let buffer='';helper.stdout.setEncoding('utf8');helper.stdout.on('data',data=>{buffer+=data;let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);try{const result=JSON.parse(line),p=this.pending.get(result.id);if(p){this.pending.delete(result.id);clearTimeout(p.timer);result.error?p.reject(new Error(result.error)):p.resolve(result.result);}}catch{}}});
    helper.stderr.on('data',()=>{});const fail=()=>{for(const [id,p] of this.pending)if(p.helper===helper){clearTimeout(p.timer);p.reject(new Error('窗口连接已结束，可重新打开 Grok Bot'));this.pending.delete(id);}if(this.helper===helper){this.helper=null;this.update({attached:false,state:'idle'});}};helper.on('error',fail);helper.on('exit',fail);helper.stdin.on('error',fail);
  }
  update(value){this.info={...this.info,...value};this.onStatus(this.info);return this.info;}
  displayBounds(){const zoom=this.win.webContents?.getZoomFactor?.()||1;return Object.fromEntries(Object.entries(this.bounds).map(([k,v])=>[k,v*zoom]));}
  request(action,params={}){this.startHelper();const helper=this.helper;return new Promise((resolve,reject)=>{const id=++this.seq,timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('窗口连接等待超时'));},10000);this.pending.set(id,{resolve,reject,timer,helper});helper.stdin.write(JSON.stringify({id,action,...params})+'\n');});}
  async open(bounds){
    if(this.closing)throw new Error('工作台正在恢复独立窗口');if(this.opening)return this.opening;if(!this.executable)throw new Error('未找到已安装的 Grok Bot，请点击“选择程序”');this.bounds=validBounds(bounds);this.visible=true;this.cancelOpen=false;
    this.opening=(async()=>{this.update({state:'opening'});
      const handle=this.win.getNativeWindowHandle();const parent=(handle.length===8?handle.readBigUInt64LE():BigInt(handle.readUInt32LE())).toString();let lastError;
      // Reuse the running original window before starting another process.
      try{const s=await this.request('attach',{executable:this.executable,parent,bounds:this.displayBounds(),visible:this.visible});return this.update({...s,state:'attached',detail:'Grok Bot 原客户端已放入工作台'});}catch(e){lastError=e;}
      if(this.closing||this.cancelOpen)throw new Error('已停止打开 Grok Bot');
      const child=spawn(this.executable,[],{detached:true,stdio:'ignore',windowsHide:true,cwd:path.dirname(this.executable)});const launched=new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});await launched;child.unref();
      const deadline=Date.now()+30000;
      while(Date.now()<deadline&&!this.closing&&!this.cancelOpen){try{const s=await this.request('attach',{executable:this.executable,parent,bounds:this.displayBounds(),visible:this.visible});return this.update({...s,state:'attached',detail:'Grok Bot 原客户端已放入工作台'});}catch(e){lastError=e;await new Promise(r=>setTimeout(r,400));}}
      throw lastError||new Error('已停止打开 Grok Bot');
    })();try{return await this.opening;}catch(e){this.update({state:this.closing||this.cancelOpen?'idle':'error',detail:e.message});throw e;}finally{this.opening=null;}
  }
  async layout(bounds){this.bounds=validBounds(bounds);if(this.info.attached)return this.update(await this.request('layout',{bounds:this.displayBounds(),visible:this.visible}));}
  async show(bounds){this.visible=true;if(this.info.attached){await this.layout(bounds);return this.info;}return this.open(bounds);}
  async hide(){this.visible=false;if(this.helper)await this.request('hide').catch(()=>{});return this.info;}
  async detach(){this.visible=false;this.cancelOpen=true;if(this.opening)await this.opening.catch(()=>{});if(this.helper){const r=await this.request('detach');return this.update({...r,state:'idle',detail:'已恢复 Grok Bot 独立窗口'});}return this.info;}
  async status(){if(this.helper)this.update(await this.request('status'));return this.info;}
  async close(){this.closing=true;this.visible=false;if(this.opening)await this.opening.catch(()=>{});if(this.helper){try{await this.request('close');}finally{this.helper?.stdin.end();}}}
}
module.exports={NativeApp,discoverGrok,validBounds};
