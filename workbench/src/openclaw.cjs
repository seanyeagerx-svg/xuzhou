const WebSocket=require('ws');
const crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const version=require('../package.json').version;
function makeIdentity() {
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  const raw=publicKey.export({type:'spki',format:'der'}).subarray(-32);
  return {id:crypto.createHash('sha256').update(raw).digest('hex'),publicKey:raw.toString('base64url'),privateKey:privateKey.export({type:'pkcs8',format:'pem'})};
}
class OpenClawAdapter extends EventEmitter {
  constructor(config,secrets) {super();this.config=config;this.secrets=secrets;this.ready=false;this.seq=0;this.pending=new Map();this.sessions=new Map();this.approvals=new Map();}
  status(state,detail='') {this.ready=state==='connected';this.emit('status',{id:this.config.id,state,detail});}
  emitEvent(sessionId,event){this.emit('event',{agentId:this.config.id,sessionId,...event});}
  async connect() {
    if(this.ready)return;this.close();this.status('connecting','正在连接云端龙虾');
    const url=new URL(this.config.url);
    if(url.protocol!=='wss:' && !(url.protocol==='ws:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('远程龙虾必须使用加密连接');
    if(url.username || url.password || url.search || url.hash)throw new Error('网关地址不能携带凭据，请单独填写连接令牌');
    // Node ws has no global proxy mutation. Tailnet traffic uses its existing direct route.
    const ws=this.ws=new WebSocket(url.href,{origin:url.href.replace(/^ws/,'http'),handshakeTimeout:15000,maxPayload:32*1024*1024});
    let identity=this.secrets.get('openclaw-device');if(!identity){identity=makeIdentity();this.secrets.set('openclaw-device',identity);}
    const token=this.secrets.get('openclaw-token') || this.secrets.get('openclaw-device-token') || '';
    return new Promise((resolve,reject)=>{
      let finished=false;
      const fail=e=>{if(!finished){finished=true;clearTimeout(timer);if(this.ws===ws)this.status('error',e.message);reject(e);}};
      const timer=setTimeout(()=>{fail(new Error('龙虾连接超时，请检查云端入口和 Tailscale'));ws.terminate();},45000);
      this.cancelConnect=()=>fail(new Error('龙虾连接已取消'));
      ws.on('error',fail);
      ws.on('close',()=>{
        fail(new Error('云端龙虾连接已断开'));
        if(this.ws!==ws)return;
        for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('云端连接已断开'));}this.pending.clear();
        for(const [id,s] of this.sessions)if(s.busy){s.busy=false;this.emitEvent(id,{type:'error',text:'云端连接已断开，任务状态需要重新核对'});}
        if(this.ready)this.status('disconnected','云端连接已断开，可重新连接');
      });
      ws.on('message',async data=>{
        if(this.ws!==ws)return;
        let m;try{m=JSON.parse(data);}catch{return;}
        if(m.type==='event' && m.event==='connect.challenge') {
          try {
            const nonce=m.payload?.nonce, signedAt=m.payload?.ts;
            if(!nonce || !Number.isSafeInteger(signedAt))throw new Error('网关身份挑战无效');
            const scopes=['operator.read','operator.write','operator.approvals'];
            const payload=['v2',identity.id,'cli','cli','operator',scopes.join(','),String(signedAt),token,nonce].join('|');
            const signature=crypto.sign(null,Buffer.from(payload),identity.privateKey).toString('base64url');
            const hello=await this.request('connect',{minProtocol:3,maxProtocol:4,client:{id:'cli',displayName:'协作工作台',version,platform:'win32',mode:'cli'},role:'operator',scopes,caps:[],auth:token?{token}:{},device:{id:identity.id,publicKey:identity.publicKey,signature,signedAt,nonce},locale:'zh-CN'},40000);
            if(this.ws!==ws)return;
            if(hello.auth?.deviceToken)this.secrets.set('openclaw-device-token',hello.auth.deviceToken);
            this.hello={version:hello.server?.version,protocol:hello.protocol,methods:hello.features?.methods || [],scopes:hello.auth?.scopes || []};
            finished=true;clearTimeout(timer);this.status('connected','已连接 · 云端龙虾');resolve(this.hello);
          }catch(e){
            if(e.details?.code==='PAIRING_REQUIRED'){
              this.pairing={requestId:e.details.requestId,deviceId:identity.id};
              e.message=`龙虾等待设备批准 · 申请 ${e.details.requestId || identity.id.slice(0,12)}。请在原龙虾控制台的设备配对申请中批准「协作工作台」，然后重新连接。`;
              this.emit('pairing',this.pairing);
            }
            fail(e);ws.close();
          }
        }else if(m.type==='res') {
          const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);clearTimeout(p.timer);
          if(m.ok)p.resolve(m.payload);else {const e=new Error(m.error?.message || '龙虾请求失败');e.details=m.error?.details;p.reject(e);}
        }else if(m.type==='event')this.event(m);
      });
    });
  }
  request(method,params={},timeout=30000) {
    const id='wb-'+(++this.seq);
    return new Promise((resolve,reject)=>{
      if(this.ws?.readyState!==WebSocket.OPEN)return reject(new Error('龙虾尚未连接'));
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`${method} 等待超时`));},timeout);
      this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({type:'req',id,method,params}));
    });
  }
  async newSession(cwd,model,remoteId) {
    if(!this.ready)await this.connect();
    const id=remoteId || `agent:main:workbench-${crypto.randomUUID()}`;
    this.sessions.set(id,{busy:false,cwd});return {id};
  }
  async prompt(id,text) {
    const s=this.sessions.get(id);if(!s)throw new Error('会话尚未加载');if(s.busy)throw new Error('当前任务仍在执行');
    s.busy=true;this.emitEvent(id,{type:'started'});
    const policy=`协作工作台：用户是判断层，OpenClaw 是助理，Codex、Kiro 是执行层。你负责整理信息、提出建议和任务草案，分派及验收由用户决定。不要声称已替本工作台调用 Codex/Kiro；通过工作台交接才会实际分派。当前项目在用户本机 ${s.cwd}，你在云端，不直接访问该目录，只依据传入的资料整理建议。禁止改 VPN、代理、TUN、DNS、路由、hosts、证书和其他 AI 登录配置。`;
    try {const r=await this.request('chat.send',{sessionKey:id,message:policy+'\n\n'+text,idempotencyKey:crypto.randomUUID()},60000);s.runId=r.runId;return r;}
    catch(e){s.busy=false;this.emitEvent(id,{type:'error',text:e.message});throw e;}
  }
  history(id,deliveryId){return this.request('chat.history',{sessionKey:id,limit:100,maxChars:100000,...(deliveryId?{inputRunIds:[deliveryId]}:{})},30000);}
  async report(id,text,deliveryId){
    const s=this.sessions.get(id);if(!s)throw new Error('助理对话尚未加载');if(s.busy)throw new Error('助理正在处理另一项消息');
    s.busy=true;s.runId=deliveryId;
    try{const r=await this.request('chat.send',{sessionKey:id,message:text,idempotencyKey:deliveryId},60000);s.runId=r.runId||deliveryId;if(['ok','completed'].includes(r.status))s.busy=false;return r;}
    catch(e){s.busy=false;throw e;}
  }
  event(m) {
    const p=m.payload || {}; const id=p.sessionKey || [...this.sessions].find(([,s])=>s.runId===p.runId)?.[0];
    if(m.event==='chat' && id && this.sessions.has(id)) {
      const s=this.sessions.get(id);if(!s.busy)return;
      if(p.runId?.startsWith('inject-'))return;
      const content=p.message?.content;
      const text=(Array.isArray(content)?content.filter(c=>c.type==='text').map(c=>c.text).join(''):typeof content==='string'?content:'') || p.message?.text || '';
      if(p.state==='delta')this.emitEvent(id,{type:'replace',text});
      if(p.state==='final'){if(text)this.emitEvent(id,{type:'replace',text});s.busy=false;this.emitEvent(id,{type:'completed'});}
      if(['error','aborted'].includes(p.state)){s.busy=false;this.emitEvent(id,{type:p.state==='aborted'?'cancelled':'error',text:p.errorMessage || '龙虾任务中止'});}
    }
    if(m.event==='exec.approval.requested') {
      const key=p.id || p.requestId;if(!key)return;this.approvals.set(key,p);this.emit('approval',{agentId:this.config.id,requestId:key,method:'exec.approval',params:p});
    }
  }
  async approve(key,choice){await this.request('exec.approval.resolve',{id:key,decision:choice==='allow'?'allow-once':'deny'});this.approvals.delete(key);}
  async cancel(id){const s=this.sessions.get(id);await this.request('chat.abort',{sessionKey:id,...(s?.runId?{runId:s.runId}:{})});}
  close(){this.cancelConnect?.();this.cancelConnect=null;const ws=this.ws;this.ws=null;this.ready=false;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('龙虾连接已结束'));}this.pending.clear();for(const [id,s] of this.sessions)if(s.busy)this.emitEvent(id,{type:'error',text:'龙虾连接已结束，任务状态需要重新核对'});this.sessions.clear();this.approvals.clear();ws?.close();}
}
module.exports={OpenClawAdapter,makeIdentity};
