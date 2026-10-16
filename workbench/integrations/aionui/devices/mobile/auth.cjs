const crypto = require('node:crypto');
const { hash, fail } = require('../targets/policy.cjs');

/** Ephemeral owner pairing. Secrets never enter a URL query, persisted profile, or AI context. */
class Pairing {
  constructor({ now = Date.now, onRevoke = () => {} } = {}) {
    this.now = now; this.onRevoke = onRevoke; this.tickets = new Map(); this.sessions = new Map();
  }
  ticket(conversationId) {
    const token = crypto.randomBytes(32).toString('hex'), expiresAt = this.now() + 2 * 60000;
    this.tickets.clear();
    this.tickets.set(hash(token), { expiresAt, conversationId, scope: 'workbench-owner' });
    return { token, expiresAt };
  }
  consume(token, label) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) fail('PAIR_INVALID');
    const key = hash(token), ticket = this.tickets.get(key);
    this.tickets.delete(key);
    if (!ticket || ticket.expiresAt <= this.now()) fail('PAIR_EXPIRED');
    const secret = crypto.randomBytes(32).toString('hex'), id = crypto.randomUUID();
    this.sessions.set(hash(secret), { id, label: String(label || 'Phone').slice(0, 80), createdAt: this.now(), expiresAt: this.now() + 12 * 60 * 60000, conversationId: ticket.conversationId, scope: ticket.scope });
    return { secret, id, conversationId: ticket.conversationId };
  }
  authenticate(cookie) {
    const token = String(cookie || '').split(';').map(p => p.trim()).find(p => p.startsWith('xuzhou_device='))?.slice(14);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const key = hash(token), session = this.sessions.get(key);
    if (!session) return null;
    if (session.expiresAt <= this.now()) { this.sessions.delete(key); this.onRevoke(session.id); return null; }
    return session;
  }
  list() {
    for (const [key, session] of this.sessions) if (session.expiresAt <= this.now()) { this.sessions.delete(key); this.onRevoke(session.id); }
    return [...this.sessions.values()].map(({ id, label, createdAt, expiresAt }) => ({ id, label, createdAt, expiresAt }));
  }
  revoke(id) {
    for (const [key, session] of this.sessions) if (session.id === id) { this.sessions.delete(key); this.onRevoke(id); }
  }
  close() { for (const session of this.sessions.values()) this.onRevoke(session.id); this.sessions.clear(); this.tickets.clear(); }
}
module.exports = { Pairing };
