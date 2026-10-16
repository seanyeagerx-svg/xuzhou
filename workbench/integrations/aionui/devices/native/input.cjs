const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

class NativeInput {
  constructor() { this.pending = new Map(); this.sequence = 0; }
  start() {
    if (this.helper) return;
    const script = fs.readFileSync(path.join(__dirname, 'input.ps1'), 'utf8');
    const helper = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.helper = helper; let buffer = '';
    const fail = () => { if (this.helper === helper) this.helper = null; for (const [id, pending] of this.pending) if (pending.helper === helper) { clearTimeout(pending.timer); pending.reject(Error('XUZHOU_DEVICE_INPUT_FAILED')); this.pending.delete(id); } };
    helper.stdout.setEncoding('utf8'); helper.stdout.on('data', data => {
      buffer += data;
      if (buffer.length > 100000) { helper.kill(); return; }
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try { const reply = JSON.parse(line), pending = this.pending.get(reply.id); if (pending) { clearTimeout(pending.timer); this.pending.delete(reply.id); reply.error ? pending.reject(Error('XUZHOU_DEVICE_INPUT_FAILED')) : pending.resolve(reply.result); } } catch { /* Compiler diagnostics are not protocol messages. */ }
      }
    });
    helper.stderr.on('data', () => {}); helper.on('error', fail); helper.on('exit', fail); helper.stdin.on('error', fail);
  }
  send(input) {
    if (process.platform !== 'win32') return Promise.reject(Error('XUZHOU_DEVICE_SCREEN_UNAVAILABLE'));
    if (this.pending.size) return Promise.reject(Error('XUZHOU_DEVICE_BUSY'));
    this.start(); const helper = this.helper;
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); helper.kill(); reject(Error('XUZHOU_DEVICE_INPUT_FAILED')); }, 12000);
      this.pending.set(id, { resolve, reject, timer, helper });
      helper.stdin.write(JSON.stringify({ id, ...input }) + '\n');
    });
  }
  cancel() {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(Error('XUZHOU_DEVICE_CANCELLED')); }
    this.pending.clear(); this.helper?.kill(); this.helper = null;
  }
}
module.exports = { NativeInput };
