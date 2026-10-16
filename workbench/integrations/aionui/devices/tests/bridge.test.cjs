const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { MobileServer } = require('../mobile/server.cjs');

test('WebSocket upgrades require pairing and same Origin, and revocation closes an established connection', async t => {
  const upstream = http.createServer((_req, res) => res.end('fixture'));
  const owned = new Set();
  upstream.on('connection', s => { owned.add(s); s.on('close', () => owned.delete(s)); });
  upstream.on('upgrade', (_request, socket) => socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'));
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const mobile = new MobileServer({ host: '127.0.0.1', allowLoopback: true, startStatic: async () => ({port: upstream.address().port, stop: async () => {}}), workspace: async () => ({}), lobster: async () => ({}) });
  t.after(async () => { await mobile.close(); for (const s of owned) s.destroy(); await new Promise(resolve => upstream.close(resolve)); });
  const pair = await mobile.pair('chat', true), origin = new URL(pair.url).origin;
  const ticket = new URLSearchParams(new URL(pair.url).hash.slice(1)).get('pair');
  const session = mobile.auth.consume(ticket, 'fixture');
  const upgrade = (cookie, requestOrigin = origin) => new Promise((resolve, reject) => {
    const s = net.connect(new URL(origin).port, '127.0.0.1');
    s.setTimeout(3000, () => s.destroy(Error('upgrade timeout')));
    s.once('error', reject);
    s.once('data', data => { s.setTimeout(0); resolve({socket:s, status:Number(data.toString().split(' ')[1])}); });
    s.once('connect', () => s.write(`GET /ws HTTP/1.1\r\nHost: ${new URL(origin).host}\r\nOrigin: ${requestOrigin}\r\nCookie: ${cookie || ''}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`));
  });
  const rejected = await upgrade(); assert.equal(rejected.status, 403); rejected.socket.destroy();
  const foreign = await upgrade('xuzhou_device=' + session.secret, 'https://foreign.invalid'); assert.equal(foreign.status, 403); foreign.socket.destroy();
  const accepted = await upgrade('xuzhou_device=' + session.secret); assert.equal(accepted.status, 101);
  const closed = new Promise(resolve => accepted.socket.once('close', resolve));
  mobile.auth.revoke(session.id);
  await closed;
});

test('MCP relay hides unavailable device tools and returns screenshots as image content', async t => {
  let calls = 0;
  const upstream = http.createServer((req, res) => { calls++; req.resume(); req.on('end', () => { res.setHeader('content-type','application/json');res.end(JSON.stringify({value:{frameId:'frame',width:2,height:2,mcpImage:{data:'aW1hZ2U=',mimeType:'image/jpeg'}}})); }); });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => upstream.close(resolve)));
  async function run(enabled) {
    const child = spawn(process.execPath, [path.resolve(__dirname, '../../../../src/lobster-mcp.cjs')], {windowsHide:true, env:{...process.env,WORKBENCH_LOBSTER_URL:`http://127.0.0.1:${upstream.address().port}`,WORKBENCH_LOBSTER_TOKEN:'fixture',WORKBENCH_COMPUTERS:enabled?'1':'0'},stdio:['pipe','pipe','pipe']});
    t.after(() => child.kill());
    let id=0; const pending = new Map();
    readline.createInterface({input:child.stdout}).on('line', line => {const r=JSON.parse(line);pending.get(r.id)?.(r.result);pending.delete(r.id);});
    const call = (method,params={}) => new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>reject(Error('relay timeout')),3000);pending.set(key,value=>{clearTimeout(timer);resolve(value);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:key,method,params})+'\n');});
    const tools = await call('tools/list');
    const result = await call('tools/call',{name:'computer_screen',arguments:{operation:'capture'}});
    child.stdin.end();
    return {tools,result};
  }
  const disabled = await run(false); assert.equal(disabled.tools.tools.some(v=>v.name.startsWith('computer_')),false);assert.equal(disabled.result.isError,true);assert.equal(calls,0);
  const enabled = await run(true);assert.equal(enabled.result.content[1].type,'image');assert.equal(JSON.parse(enabled.result.content[0].text).frameId,'frame');assert.equal(enabled.result.content[0].text.includes('aW1hZ2U='),false);
});
