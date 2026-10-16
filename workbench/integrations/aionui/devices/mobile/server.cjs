const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const { Pairing } = require('./auth.cjs');
const { fail } = require('../targets/policy.cjs');

function privateAddress() {
  // Tailnet traffic is encrypted by the existing Tailscale interface. No route or proxy is changed.
  for (const entries of Object.values(os.networkInterfaces())) for (const item of entries || []) {
    const parts = item.address.split('.').map(Number);
    if (item.family === 'IPv4' && !item.internal && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return item.address;
  }
  return null;
}
function landing(locale = 'zh-CN') {
  const zh = /^zh/.test(locale);
  const title = zh ? '在续舟中连接手机' : 'Connect this phone from Xuzhou';
  const hint = zh ? '请在电脑上的同一聊天中打开“手机连接”，扫描新二维码。手机和电脑需要接入同一 Tailscale 私网。' : 'Open Phone connection in the desktop chat and scan a new QR code. Both devices must join the same Tailscale network.';
  const expired = zh ? '连接码无效或已过期，请在电脑中重新生成。' : 'The pairing code is invalid or expired. Generate another on the desktop.';
  // This bootstrap runs before the SPA requests any API. The single-use secret stays in the fragment.
  return `<!doctype html><html lang="${zh ? 'zh-CN' : 'en'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>续舟</title><body><h1>${title}</h1><p id="hint">${hint}</p><script>
  (async()=>{const params=new URLSearchParams(location.hash.slice(1));const token=params.get('pair');history.replaceState(null,'',location.pathname);if(!token)return;try{const r=await fetch('/xuzhou/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,label:/iPhone|iPad/.test(navigator.userAgent)?'iPhone / iPad':'Phone'})});if(!r.ok)throw Error();const v=await r.json();location.replace('/index.html#/conversation/'+encodeURIComponent(v.conversationId));}catch{document.getElementById('hint').textContent=${JSON.stringify(expired)}}})();
  </script></body></html>`;
}

class MobileServer {
  constructor({ startStatic, workspace, lobster, onRevoke = () => {}, host, allowLoopback = false, now }) {
    Object.assign(this, { startStatic, workspace, lobster, onRevoke, host, allowLoopback });
    this.sockets = new Map();
    this.auth = new Pairing({ now, onRevoke: id => { for (const [socket, owner] of this.sockets) if (owner === id) socket.destroy(); this.onRevoke(id); } });
  }
  async start() {
    if (this.starting) return this.starting;
    this.starting = this.open().finally(() => { this.starting = null; });
    return this.starting;
  }
  async open() {
    if (this.server) return;
    const host = this.host || privateAddress();
    if (!host || (host === '127.0.0.1' && !this.allowLoopback)) fail('PHONE_PRIVATE_NETWORK_REQUIRED');
    if (!(host === '127.0.0.1' && this.allowLoopback) && !/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(host)) fail('PHONE_PRIVATE_NETWORK_REQUIRED');
    this.staticHandle = await this.startStatic();
    const server = http.createServer((request, response) => void this.receive(request, response));
    server.headersTimeout = 15000; server.requestTimeout = 30000;
    server.on('connection', socket => { this.sockets.set(socket, null); socket.on('close', () => this.sockets.delete(socket)); });
    server.on('upgrade', (request, socket, head) => this.upgrade(request, socket, head));
    try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, host, resolve); }); }
    catch (error) { await this.staticHandle.stop(); this.staticHandle = null; throw error; }
    this.server = server; this.origin = `http://${host}:${server.address().port}`;
    this.expiryTimer = setInterval(() => this.auth.list(), 30000); this.expiryTimer.unref?.();
  }
  validHost(request) { return request.headers.host === new URL(this.origin).host; }
  sameOrigin(request) { return request.headers.origin === this.origin; }
  async body(request, max = 4 * 1024 ** 2) {
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > max) fail('REQUEST_TOO_LARGE'); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  async receive(request, response) {
    const json = (status, value) => {
      if (!response.writableEnded && !response.destroyed) { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(JSON.stringify(value)); }
    };
    try {
      if (!this.validHost(request)) return json(403, { error: 'XUZHOU_DEVICE_PHONE_UNAUTHORIZED' });
      if (!['GET', 'HEAD'].includes(request.method) && !this.sameOrigin(request)) return json(403, { error: 'XUZHOU_DEVICE_PHONE_UNAUTHORIZED' });
      const session = this.auth.authenticate(request.headers.cookie);
      if (request.method === 'POST' && request.url === '/xuzhou/pair') {
        const data = await this.body(request, 2000);
        const paired = this.auth.consume(data.token, data.label);
        // Lax permits the top-level navigation after scanning a QR in another app.
        // Every mutation and WebSocket still requires this exact Origin.
        response.setHeader('set-cookie', `xuzhou_device=${paired.secret}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`);
        return json(200, { id: paired.id, conversationId: paired.conversationId });
      }
      if (!session) {
        if (request.method === 'GET' && (request.url === '/' || request.url === '/index.html')) {
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
          response.end(landing(request.headers['accept-language'])); return;
        }
        return json(401, { error: 'XUZHOU_DEVICE_PHONE_UNAUTHORIZED' });
      }
      this.sockets.set(request.socket, session.id);
      // The embedded Core uses local identity; its WebUI login endpoint still
      // expects a JWT. Outer pairing is the credential for this listener only.
      if (request.method === 'GET' && request.url === '/api/auth/user') {
        return json(200, { success: true, user: { id: 'system_default_user', username: session.label } });
      }
      if (request.method === 'POST' && request.url === '/logout') {
        response.setHeader('set-cookie', 'xuzhou_device=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
        json(200, { success: true });
        setImmediate(() => this.auth.revoke(session.id));
        return;
      }
      if (request.url === '/login' || request.url.startsWith('/api/auth/')) return json(403, { error: 'XUZHOU_DEVICE_PAIR_REQUIRED' });
      if (request.url === '/xuzhou/workspace' || request.url === '/xuzhou/lobster') {
        if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
        const { action, data } = await this.body(request);
        const handler = request.url.endsWith('workspace') ? this.workspace : this.lobster;
        return json(200, { value: await handler(action, data || {}, { source: 'phone', actor: session.id }) });
      }
      if (request.url.startsWith('/xuzhou/')) return json(404, { error: 'NOT_FOUND' });
      // Reuse AionUi's own static/API routes after outer authentication, including streaming responses.
      const proxy = http.request({ hostname: '127.0.0.1', port: this.staticHandle.port, path: request.url, method: request.method, headers: { ...request.headers, host: `127.0.0.1:${this.staticHandle.port}` } }, upstream => {
        const headers = { ...upstream.headers, 'referrer-policy': 'no-referrer' };
        if (String(upstream.headers['content-type']).includes('text/html') && request.method === 'GET') {
          delete headers['content-length']; delete headers.etag;
          const chunks=[];let size=0;
          upstream.on('data',chunk=>{size+=chunk.length;if(size>2*1024**2){upstream.destroy();json(502,{error:'INDEX_TOO_LARGE'});}else chunks.push(chunk);});
          upstream.on('end',()=>{if(response.writableEnded)return;response.writeHead(upstream.statusCode||200,{...headers,'cache-control':'no-store'});response.end(Buffer.concat(chunks).toString('utf8').replace('<head>','<head><script>window.__xuzhouDeviceBridge=true;</script>'));});
        } else { response.writeHead(upstream.statusCode || 502, headers); upstream.pipe(response); }
      });
      proxy.on('error', () => json(502, { error: 'BACKEND_UNREACHABLE' }));
      response.on('close', () => proxy.destroy()); request.pipe(proxy);
    } catch (error) { json(400, { error: String(error.message).slice(0, 1000) }); }
  }
  upgrade(request, socket, head) {
    const session = this.auth.authenticate(request.headers.cookie);
    if (!this.validHost(request) || !this.sameOrigin(request) || !session || !/^\/(?:ws|api\/stt\/stream)(?:\?|$)/.test(request.url)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    this.sockets.set(socket, session.id);
    const upstream = net.connect(this.staticHandle.port, '127.0.0.1');
    upstream.on('connect', () => {
      const headers = { ...request.headers, host: `127.0.0.1:${this.staticHandle.port}` };
      upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n` + Object.entries(headers).map(([key, value]) => `${key}: ${value}\r\n`).join('') + '\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream); upstream.pipe(socket);
    });
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy()); upstream.on('close', () => socket.destroy());
  }
  async pair(conversationId, ownerConsent = false) {
    // The reused WebUI exposes the owner's full workspace. A redirect to one
    // conversation is not a single-conversation security boundary.
    if (ownerConsent !== true) fail('PHONE_OWNER_CONSENT_REQUIRED');
    if (!/^[-\w]{1,128}$/.test(conversationId || '')) fail('CHAT_INVALID');
    await this.start();
    const ticket = this.auth.ticket(conversationId);
    return { url: this.origin + '/#pair=' + ticket.token, expiresAt: ticket.expiresAt, scope: 'workbench-owner' };
  }
  snapshot() { return { running: !!this.server, origin: this.origin || null, devices: this.auth.list(), privateNetwork: true }; }
  async close() {
    if(this.starting)await this.starting.catch(()=>{});
    clearInterval(this.expiryTimer);
    this.auth.close();
    for (const socket of this.sockets.keys()) socket.destroy(); this.sockets.clear();
    if (this.server) { const server = this.server; this.server = null; await new Promise(resolve => server.close(resolve)); }
    await this.staticHandle?.stop(); this.staticHandle = null; this.origin = null;
  }
}
module.exports = { MobileServer, privateAddress };
