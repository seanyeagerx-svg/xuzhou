const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { atomicJson } = require('../../../src/store.cjs');

// This endpoint is only for the local ACP bridge. SSH credentials and UI actions
// never pass through it; each AI gets a separate project-scoped MCP capability.
class Control {
  constructor(runtime) { this.r = runtime; this.token = crypto.randomBytes(32).toString('hex'); }
  async start() {
    this.server = http.createServer(async (req, res) => {
      const done = (status, value) => { if (!res.writableEnded) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); } };
      if (req.method !== 'POST' || req.url !== '/bridge' || req.headers.origin || req.headers.authorization !== 'Bearer ' + this.token) return done(403, { error: '访问未授权' });
      try {
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 1000000) return done(413, { error: '请求过长' }); }
        const { method, data } = JSON.parse(body);
        if (!['attach', 'event', 'heartbeat', 'detach', 'device-context'].includes(method)) throw new Error('未知接续操作');
        done(200, { value: await this.r.control(method, data) });
      } catch (e) { done(400, { error: String(e.message).slice(0, 2000) }); }
    });
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); });
    this.file = path.join(this.r.directory, 'control.json');
    atomicJson(this.file, { url: `http://127.0.0.1:${this.server.address().port}/bridge`, token: this.token, pid: process.pid });
    return this.file;
  }
  close() {
    this.server?.close(); this.server?.closeAllConnections();
    try { if (JSON.parse(fs.readFileSync(this.file, 'utf8')).token === this.token) fs.unlinkSync(this.file); } catch { /* Another launch may own the endpoint. */ }
  }
}
module.exports = { Control };
