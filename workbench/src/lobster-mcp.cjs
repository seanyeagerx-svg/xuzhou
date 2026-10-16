// Session-local MCP relay; no server credentials or global AI configuration.
const http=require('node:http'),readline=require('node:readline');
const {specs}=require('./lobster-hub.cjs');
const version=require('../package.json').version;
const url=process.env.WORKBENCH_LOBSTER_URL,token=process.env.WORKBENCH_LOBSTER_TOKEN;
const computerEnabled=process.env.WORKBENCH_COMPUTERS==='1';
function write(value){process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');}
function call(name,args){return new Promise((resolve,reject)=>{
 let u;try{u=new URL(url);if(u.hostname!=='127.0.0.1'||u.protocol!=='http:')throw new Error('工作台工具地址无效');}catch(e){reject(e);return;}
 const request=http.request(u,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}},res=>{
  let data='';res.setEncoding('utf8');res.on('data',c=>{data+=c;if(data.length>4*1024*1024){request.destroy();reject(new Error('工具响应过长'));}});res.on('end',()=>{try{const value=JSON.parse(data);value.error?reject(new Error(value.error)):resolve(value.value);}catch(e){reject(e);}});
 });request.setTimeout(12*60*1000,()=>request.destroy(new Error('等待工作台决定超时')));request.on('error',reject);request.end(JSON.stringify({name,arguments:args}));
});}
async function receive(m){if(m.id===undefined)return;
 try{
  let result;
  if(m.method==='initialize')result={protocolVersion:m.params?.protocolVersion||'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'workbench-lobster',version},instructions:'龙虾维修通过独立任务执行。不得把已排队的维护称作完成。服务器密码只在工作台连接页输入，不要请求用户在聊天里提供。'};
  else if(m.method==='ping')result={};
  else if(m.method==='tools/list')result={tools:specs.filter(s=>computerEnabled||!s.name.startsWith('computer_')).map(s=>({...s,annotations:{readOnlyHint:['lobster_status','lobster_history','lobster_job','computer_state'].includes(s.name),destructiveHint:['computer_command','computer_files','computer_screen'].includes(s.name),openWorldHint:false}}))};
  else if(m.method==='tools/call'){try{if(!computerEnabled&&m.params.name?.startsWith('computer_'))throw new Error('Computer tools are unavailable in this host');const value=await call(m.params.name,m.params.arguments||{}),{mcpImage,...metadata}=value||{};result={content:[{type:'text',text:JSON.stringify(mcpImage?metadata:value)},...(mcpImage?[{type:'image',data:mcpImage.data,mimeType:mcpImage.mimeType}]:[])],isError:false};}catch(e){result={content:[{type:'text',text:e.message}],isError:true};}}
  else {write({id:m.id,error:{code:-32601,message:'Unsupported method'}});return;}
  write({id:m.id,result});
 }catch(e){write({id:m.id,error:{code:-32603,message:e.message}});}
}
readline.createInterface({input:process.stdin}).on('line',line=>{try{receive(JSON.parse(line));}catch{}}).on('close',()=>process.exit(0));
