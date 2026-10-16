import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// One file and exclusive owner per conversation: AionUi can launch one bridge
// process per chat without sharing mutable in-memory state between chats.
export class SessionStore {
  constructor(root) {
    this.root = path.resolve(root);
    this.owned = new Map();
    fs.mkdirSync(this.root, { recursive: true });
  }
  file(id, suffix = '.json') {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('无效的接续会话编号');
    return path.join(this.root, id + suffix);
  }
  claim(id) {
    if (this.owned.has(id)) return;
    const file = this.file(id, '.lock');
    const token = crypto.randomUUID();
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
      let alive = true;
      try { process.kill(owner.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
      if (alive) throw new Error('这段对话仍由另一个连接使用，请先关闭原连接');
      fs.unlinkSync(file);
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
    }
    this.owned.set(id, token);
  }
  read(id) { return JSON.parse(fs.readFileSync(this.file(id), 'utf8')); }
  save(c) {
    if (!this.owned.has(c.id)) throw new Error('会话尚未取得写入锁');
    const file = this.file(c.id);
    const temp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(c, null, 2));
    fs.renameSync(temp, file);
  }
  release(id) {
    if (!this.owned.has(id)) return;
    const file = this.file(id, '.lock');
    try {
      if (JSON.parse(fs.readFileSync(file, 'utf8')).token === this.owned.get(id)) fs.unlinkSync(file);
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    this.owned.delete(id);
  }
}
