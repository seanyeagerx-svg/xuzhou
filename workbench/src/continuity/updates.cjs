// Xuzhou update manifest verification; never executes an installer or uses upstream feeds.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');const {atomicJson}=require('../store.cjs');
function verifyManifest(manifest,publicKey,current='2.3.0'){
  const {payload,signature}=manifest||{};if(!payload||typeof signature!=='string'||!crypto.verify(null,Buffer.from(JSON.stringify(payload)),publicKey,Buffer.from(signature,'base64')))throw Error('UPDATE_SIGNATURE_INVALID');
  if(payload.platform!=='win32-x64'||!/^\d+\.\d+\.\d+$/.test(payload.version)||!/^[a-f0-9]{64}$/.test(payload.sha256)||!Number.isSafeInteger(payload.bytes)||payload.bytes<1||payload.bytes>1024**3)throw Error('UPDATE_MANIFEST_INVALID');
  const url=new URL(payload.url);if(url.protocol!=='https:'||url.username||url.password)throw Error('UPDATE_URL_INVALID');
  const a=payload.version.split('.').map(Number),b=current.split('.').map(Number);let newer=false;for(let i=0;i<3;i++){if(a[i]!==b[i]){newer=a[i]>b[i];break;}}
  return {...payload,available:newer};
}
class Updates{
  constructor(directory){this.file=path.join(directory,'update-channel.json');this.config=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file)):{};this.state={state:'not-configured',signedInstaller:false};}
  snapshot(){return {config:this.config,status:this.state};}
  configure(data){const url=new URL(data.url);if(url.protocol!=='https:'||url.username||url.password)throw Error('UPDATE_URL_INVALID');const key=crypto.createPublicKey(data.publicKey);if(key.asymmetricKeyType!=='ed25519')throw Error('UPDATE_KEY_INVALID');this.config={url:url.href,publicKey:key.export({type:'spki',format:'pem'})};atomicJson(this.file,this.config);return this.snapshot();}
  async check(){if(!this.config.url)throw Error('UPDATE_CHANNEL_NOT_CONFIGURED');const response=await fetch(this.config.url,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('UPDATE_HTTP_'+response.status);const reader=response.body.getReader(),chunks=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;if((size+=value.length)>65536){await reader.cancel();throw Error('UPDATE_MANIFEST_TOO_LARGE');}chunks.push(Buffer.from(value));}const text=Buffer.concat(chunks).toString('utf8');const next=verifyManifest(JSON.parse(text),this.config.publicKey);this.state={state:next.available?'available':'current',checkedAt:Date.now(),release:next,signedInstaller:false};return this.snapshot();}
}
module.exports={Updates,verifyManifest};
