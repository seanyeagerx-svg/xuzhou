// Xuzhou encrypted, external-device-only backup. No cleanup or internal payload staging.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');const {atomicJson}=require('../store.cjs');
function volumes(){
  if(process.platform!=='win32')return [];
  const script="$ErrorActionPreference='Stop'; @(Get-Partition | Where-Object DriveLetter | ForEach-Object { $p=$_; $d=Get-Disk -Number $p.DiskNumber; if($d.BusType -eq 'USB'){ $v=Get-Volume -DriveLetter $p.DriveLetter; [pscustomobject]@{id=([string]$d.SerialNumber).Trim()+'|'+$v.UniqueId; root=([string]$p.DriveLetter)+':\\'; free=$v.SizeRemaining; label=$v.FileSystemLabel; usb=$true}}}) | ConvertTo-Json -Compress";
  const text=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:12000}).trim();const parsed=text?JSON.parse(text):[];return Array.isArray(parsed)?parsed:[parsed];
}
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
class Backup {
  constructor({directory,discover=volumes,now=Date.now}){this.file=path.join(directory,'backup-settings.json');this.discover=discover;this.now=now;this.config=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file)):{};this.status={state:this.config.enabled?'waiting':'disabled',reason:this.config.enabled?'BACKUP_RECOVERY_KEY_REQUIRED':undefined,quark:'not-connected'};this.timer=setInterval(()=>{if(this.config.enabled&&(!this.status.nextAt||this.status.nextAt<=now()))void this.run().catch(()=>{});},60000);this.timer.unref?.();}
  snapshot(){return {config:this.config,status:this.status,keyLoaded:!!this.key,volumes:this.discover(),quark:{connected:false,reason:'QUARK_DRIVER_NOT_CONFIGURED'}};}
  configure(data){
    if(data.enabled===false&&this.config.version===1){this.config.enabled=false;atomicJson(this.file,this.config);return this.snapshot();}
    if(!Array.isArray(data.sources)||!data.sources.length||data.sources.length>20)throw Error('BACKUP_SOURCES_REQUIRED');
    const sources=data.sources.map(p=>{if(typeof p!=='string'||!path.isAbsolute(p)||!fs.statSync(p).isDirectory())throw Error('BACKUP_SOURCE_INVALID');return fs.realpathSync(p);});
    if(!Number.isSafeInteger(data.intervalMinutes)||data.intervalMinutes<15||data.intervalMinutes>10080)throw Error('BACKUP_INTERVAL_INVALID');
    const device=this.discover().find(d=>d.usb===true&&d.id===data.deviceId);if(!device)throw Error('BACKUP_EXTERNAL_DEVICE_MISSING');
    if(typeof data.key!=='string'||!/^\w{64}$/.test(data.key)||!/^[0-9a-f]{64}$/i.test(data.key))throw Error('BACKUP_RECOVERY_KEY_REQUIRED');
    const destination=path.join(fs.realpathSync(device.root),'.xuzhou-backups');
    const inside=(a,b)=>{const rel=path.relative(a,b);return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));};
    if(sources.some(p=>inside(p,destination)||inside(destination,p)))throw Error('BACKUP_TARGET_OVERLAPS_SOURCE');
    this.key=Buffer.from(data.key,'hex');this.config={version:1,enabled:data.enabled===true,sources,deviceId:device.id,intervalMinutes:data.intervalMinutes};atomicJson(this.file,this.config);this.status={state:this.config.enabled?'pending':'disabled',quark:'not-connected'};return this.snapshot();
  }
  async run(){
    if(this.running)throw Error('BACKUP_BUSY');if(!this.config.enabled)throw Error('BACKUP_DISABLED');this.running=true;
    const startedAt=this.now();let batch;
    try{
      const devices=this.discover().filter(d=>d.usb&&d.id===this.config.deviceId);if(devices.length!==1)throw Error('BACKUP_EXTERNAL_DEVICE_MISSING');
      if(!this.key)throw Error('BACKUP_RECOVERY_KEY_REQUIRED');const device=devices[0];
      if(device.free<256*1024**2)throw Error('BACKUP_EXTERNAL_SPACE_LOW');
      const target=fs.realpathSync(device.root);batch=path.join(target,'.xuzhou-backups',new Date(startedAt).toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID());
      fs.mkdirSync(batch,{recursive:true});this.status={state:'running',startedAt,quark:'not-connected'};
      const entries=[],skipped=[],seen=new Set();let total=0;
      const sameDevice=()=>{if(!this.discover().some(d=>d.usb&&d.id===device.id&&fs.realpathSync(d.root)===target))throw Error('BACKUP_DEVICE_CHANGED');};
      const visit=async(file,logical)=>{
        if(this.closed||!this.config.enabled)throw Error('BACKUP_CANCELLED');const real=fs.realpathSync(file),stat=fs.statSync(real);
        if(seen.has(real.toLowerCase()))return;seen.add(real.toLowerCase());
        if(/(^|[\\/])(?:\.ssh|\.aws|\.gnupg)([\\/]|$)|(^|[\\/])(?:auth|credentials|secrets)\.json$|xuzhou-recovery-key\.txt$|\.(?:pem|key)$|(?:-wal|-shm|-journal)$/i.test(real)){skipped.push({path:logical,reason:'credential-or-sqlite-sidecar-excluded'});return;}
        if(stat.isDirectory()){for(const name of fs.readdirSync(real))await visit(path.join(real,name),logical+'/'+name);return;}
        if(!stat.isFile())return;if(stat.size>256*1024**2)throw Error('BACKUP_FILE_TOO_LARGE');if((total+=stat.size)>device.free-128*1024**2)throw Error('BACKUP_EXTERNAL_SPACE_LOW');sameDevice();
        let bytes;
        if(/\.(?:db|sqlite3?)$/i.test(real)){
          const {DatabaseSync,backup}=require('node:sqlite');const snapshot=path.join(batch,'sqlite-'+entries.length+'.snapshot');const db=new DatabaseSync(real,{readOnly:true});try{await backup(db,snapshot);}finally{db.close();}bytes=fs.readFileSync(snapshot);fs.unlinkSync(snapshot);
        }else{bytes=fs.readFileSync(real);const after=fs.statSync(real);if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw Error('BACKUP_SOURCE_CHANGED');}
        if([this.key,Buffer.from(this.key.toString('hex')),Buffer.from(this.key.toString('hex').toUpperCase()),Buffer.from(this.key.toString('base64'))].some(marker=>bytes.includes(marker))){skipped.push({path:logical,reason:'recovery-key-excluded'});return;}
        const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.key,nonce),id=String(entries.length)+'.xzb';
        const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);fs.writeFileSync(path.join(batch,id),Buffer.concat([Buffer.from('XZB1'),nonce,cipher.getAuthTag(),encrypted]),{flag:'wx'});
        entries.push({path:logical,file:id,bytes:bytes.length,sha256:hash(bytes)});
      };
      for(const [index,source]of this.config.sources.entries())await visit(source,'source-'+index);
      sameDevice();const manifest={version:1,algorithm:'AES-256-GCM',createdAt:startedAt,entries,skipped};
      // Encrypt names and logical paths too. The recovery key never appears in the archive or settings.
      const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.key,nonce),body=Buffer.concat([cipher.update(JSON.stringify(manifest)),cipher.final()]);
      fs.writeFileSync(path.join(batch,'manifest.xzb'),Buffer.concat([Buffer.from('XZB1'),nonce,cipher.getAuthTag(),body]),{flag:'wx'});
      if(entries.length){const sample=entries[0],value=decrypt(fs.readFileSync(path.join(batch,sample.file)),this.key);if(hash(value)!==sample.sha256)throw Error('BACKUP_RESTORE_CHECK_FAILED');const restored=path.join(batch,'restore-check');fs.mkdirSync(restored);fs.writeFileSync(path.join(restored,'sample.xzb'),fs.readFileSync(path.join(batch,sample.file)),{flag:'wx'});}
      fs.writeFileSync(path.join(batch,'COMPLETE.json'),JSON.stringify({version:1,files:entries.length,encrypted:true,restoreSampleVerified:entries.length>0}));
      this.status={state:'completed',startedAt,finishedAt:this.now(),files:entries.length,skipped:skipped.length,restoreSampleVerified:entries.length>0,quark:'not-connected',nextAt:this.now()+this.config.intervalMinutes*60000};
    }catch(error){this.status={state:'waiting',reason:error.message,startedAt,nextAt:this.now()+60000,quark:'not-connected',partialExternalBatch:!!batch};throw error;}finally{this.running=false;}
    return this.snapshot();
  }
  close(){this.closed=true;clearInterval(this.timer);this.key?.fill(0);this.key=null;}
}
function decrypt(bytes,key){if(bytes.subarray(0,4).toString()!=='XZB1')throw Error('BACKUP_ARCHIVE_INVALID');const d=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(4,16));d.setAuthTag(bytes.subarray(16,32));return Buffer.concat([d.update(bytes.subarray(32)),d.final()]);}
module.exports={Backup,volumes,decrypt};
