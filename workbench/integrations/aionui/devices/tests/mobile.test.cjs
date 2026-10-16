const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Pairing } = require('../mobile/auth.cjs');
const { MobileServer } = require('../mobile/server.cjs');

test('pairing codes are single use, expire, and disclose no session secrets in the device list', () => {
  let now = 0; const auth = new Pairing({ now: () => now });
  const ticket = auth.ticket('chat-1'), session = auth.consume(ticket.token, 'Owner phone');
  assert.throws(() => auth.consume(ticket.token), /PAIR_EXPIRED/);
  assert.equal(auth.authenticate('xuzhou_device=' + session.secret).id, session.id);
  assert.equal(JSON.stringify(auth.list()).includes(session.secret), false);
  const expired = auth.ticket('chat-1'); now = 120000;
  assert.throws(() => auth.consume(expired.token), /PAIR_EXPIRED/);
  auth.revoke(session.id); assert.equal(auth.authenticate('xuzhou_device=' + session.secret), null);
});
test('mobile gateway protects APIs, rejects cross-origin pairing and exposes only a paired WebUI', async t => {
  const upstream = http.createServer((req, res) => {
    if (req.url === '/api/private') { res.setHeader('content-type', 'application/json'); res.end('{"actual":true}'); }
    else { res.setHeader('content-type', 'text/html'); res.end('<html><head></head><body>REAL_SHARED_UI</body></html>'); }
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const mobile = new MobileServer({ host: '127.0.0.1', allowLoopback: true, startStatic: async () => ({ port: upstream.address().port, stop: async () => {} }), workspace: async (_action, data, caller) => ({ ...data, source: caller.source }), lobster: async () => ({}) });
  t.after(async () => { await mobile.close(); await new Promise(resolve => upstream.close(resolve)); });
  await assert.rejects(mobile.pair('chat-1'), /PHONE_OWNER_CONSENT_REQUIRED/);
  const pair = await mobile.pair('chat-1', true), origin = new URL(pair.url).origin, token = new URLSearchParams(new URL(pair.url).hash.slice(1)).get('pair');
  assert.equal(pair.scope, 'workbench-owner');
  assert.equal((await fetch(origin + '/api/private')).status, 401);
  t.diagnostic('Unauthenticated API denied');
  const wrong = await fetch(origin + '/xuzhou/pair', { method: 'POST', headers: { origin: 'https://attacker.invalid', 'content-type': 'application/json' }, body: JSON.stringify({ token }) }); assert.equal(wrong.status, 403);
  const paired = await fetch(origin + '/xuzhou/pair', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
  const cookie = paired.headers.get('set-cookie'); assert.match(cookie, /HttpOnly; SameSite=Lax/);
  t.diagnostic('Single-use pairing completed');
  const value = await paired.json(); assert.equal(value.conversationId, 'chat-1');
  const identity = await (await fetch(origin + '/api/auth/user', { headers: { cookie } })).json();
  assert.equal(identity.success, true); assert.equal(identity.user.id, 'system_default_user');
  assert.equal((await fetch(origin + '/api/private', { headers: { cookie } })).status, 200);
  const html = await (await fetch(origin, { headers: { cookie } })).text(); assert.match(html, /__xuzhouDeviceBridge=true/); assert.match(html, /REAL_SHARED_UI/);
  t.diagnostic('Shared frontend and authenticated API reached');
  const call = await fetch(origin + '/xuzhou/workspace', { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'computer-state', data: { conversationId: 'chat-1' } }) }); assert.equal((await call.json()).value.source, 'phone');
  mobile.auth.revoke(value.id);
  // Revocation deliberately closes existing sockets. Verify the old cookie on a fresh transport.
  const rejected = await new Promise((resolve,reject)=>{const request=http.get(origin+'/api/private',{headers:{cookie},agent:false},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);});
  assert.equal(rejected, 401);
});
test('mobile entry refuses a public listener and requires the existing private network', async () => {
  const server = new MobileServer({ host: '0.0.0.0', startStatic: async () => { throw Error('must not start'); }, workspace: async () => ({}), lobster: async () => ({}) });
  await assert.rejects(server.pair('chat', true), /PHONE_PRIVATE_NETWORK_REQUIRED/);
});
