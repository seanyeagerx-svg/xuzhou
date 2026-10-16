const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicJson } = require('../../../src/store.cjs');
const { redact } = require('../../../src/maintenance.cjs');
const { LocalTarget } = require('./targets/local.cjs');
const { RemoteTarget } = require('./targets/remote.cjs');
const { MobileServer } = require('./mobile/server.cjs');
const { capacity, commandRequest, fileRequest, fail, MIN_DISK_BYTES, MIN_MEMORY_BYTES, MAX_FILE_BYTES } = require('./targets/policy.cjs');

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const identifier = value => typeof value === 'string' && /^[-\w]{1,128}$/.test(value) && !['__proto__','constructor','prototype'].includes(value);

/** Routes current-chat operations. A failed remote action is never retried against the local device. */
class Computers {
  constructor({ directory, sessionsDirectory, backend, lobster, native = {}, dispatch, local, remote, now = Date.now }) {
    Object.assign(this, { sessionsDirectory, backend, lobster, native, now });
    this.file = path.join(directory, 'computers.json');
    this.state = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { version: 1, chats: {} };
    if (this.state.version !== 1 || !this.state.chats || Array.isArray(this.state.chats)) fail('STATE_INVALID');
    this.local = local || new LocalTarget(); this.remote = remote || new RemoteTarget(lobster?.maintenance);
    this.busy = new Map(); this.resource = null;
    for (const chat of Object.values(this.state.chats)) for (const job of chat.jobs || []) if (job.state === 'running') { job.state = 'interrupted'; job.finishedAt = now(); }
    this.mobile = new MobileServer({
      startStatic: () => { if (!native.startStatic) fail('PHONE_UNAVAILABLE'); return native.startStatic(); },
      workspace: dispatch,
      lobster: (action, data) => { if (!lobster) fail('CLOUD_DISCONNECTED'); return lobster.call(action, data); },
      onRevoke: actor => {this.native.screen?.revoke?.(actor);for(const operation of this.busy.values())if(operation.actor===actor)operation.abort.abort();},
      ...(native.mobileTestOptions || {}),
    });
    if (lobster) lobster.computers = this;
  }
  save() { atomicJson(this.file, this.state); }
  connectionKey() {
    const profile = this.lobster?.maintenance?.profile;
    return profile ? `${profile.host}:${profile.port}:${profile.username}` : '';
  }
  async source(id) {
    if (!identifier(id)) fail('CHAT_INVALID');
    const chat = await this.backend('/api/conversations/' + encodeURIComponent(id), 'GET', undefined, true);
    if (!chat || chat.archived || !path.isAbsolute(chat.extra?.workspace || '') || !fs.statSync(chat.extra.workspace).isDirectory()) fail('CHAT_UNAVAILABLE');
    const entry = this.state.chats[id] ||= { deviceId: 'local', revision: 0, workspaceId: crypto.randomUUID(), jobs: [] };
    let canonicalId = uuid(chat.extra.acp_session_id) ? chat.extra.acp_session_id : null;
    if (!canonicalId && uuid(chat.extra.workbench_import_id) && fs.existsSync(this.sessionsDirectory)) {
      const candidates = fs.readdirSync(this.sessionsDirectory).filter(name => /^[a-f0-9-]{36}\.json$/i.test(name)).map(name => JSON.parse(fs.readFileSync(path.join(this.sessionsDirectory, name), 'utf8'))).filter(c => c.importId === chat.extra.workbench_import_id);
      if (candidates.length > 1) fail('CHAT_AMBIGUOUS');
      canonicalId = candidates[0]?.id || null;
    }
    entry.canonicalId = canonicalId; entry.localRoot = fs.realpathSync(chat.extra.workspace);
    return { id, entry, title: chat.name || id };
  }
  async forCanonical(canonicalId) {
    for (const id of Object.keys(this.state.chats)) {
      try { const source = await this.source(id); if (source.entry.canonicalId === canonicalId) return source; }
      catch (error) { if (String(error.message).includes('AMBIGUOUS')) throw error; }
    }
    fail('CHAT_NOT_BOUND');
  }
  screenState(id) { return this.native.screen?.status(id) || { available: false, mode: 'off' }; }
  snapshot(source) {
    const connected = this.lobster?.maintenance?.ready === true;
    const resource = connected && this.resource?.connectionKey === this.connectionKey() && this.resource.generation === this.lobster.maintenance.generation ? this.resource : null;
    const usable = connected && !!resource && capacity(resource).usable;
    return {
      available: true, conversationId: source.id, canonicalReady: !!source.entry.canonicalId,
      deviceId: source.entry.deviceId, localRoot: source.entry.localRoot, remoteRoot: source.entry.remoteRoot || null,
      cloud: { connected, usable, resource, reason: connected ? (resource ? capacity(resource).reason : 'CAPACITY_UNKNOWN') : 'CLOUD_DISCONNECTED' },
      limits: { minimumDiskBytes: MIN_DISK_BYTES, minimumMemoryBytes: MIN_MEMORY_BYTES, maxFileBytes: MAX_FILE_BYTES },
      screen: this.screenState(source.id), mobile: this.mobile.snapshot(), jobs: source.entry.jobs.slice(-12),
      busy: this.busy.has(source.id),
      approvals: (this.lobster?.snapshot().approvals || []).filter(d => this.lobster.decisions.get(d.id)?.context.sessionId === source.entry.canonicalId),
    };
  }
  async probe() {
    const generation = this.lobster?.maintenance?.generation, key = this.connectionKey();
    const result = await this.remote.probe();
    if (generation !== this.lobster?.maintenance?.generation || key !== this.connectionKey()) fail('CONNECTION_CHANGED');
    this.resource = { ...result, checkedAt: this.now(), connectionKey: key, generation };
    return { ...this.resource, ...capacity(this.resource) };
  }
  async select(source, deviceId) {
    if (!['local', 'cloud'].includes(deviceId)) fail('DEVICE_INVALID');
    if (this.busy.has(source.id) || this.lobster?.state.conversations.some(c => c.id === source.entry.canonicalId && c.status === 'running')) fail('BUSY');
    if (deviceId === 'cloud') {
      const resources = await this.probe();
      if (!resources.usable) fail(resources.reason);
      const prepared = await this.remote.run({ operation: 'prepare', sessionId: source.entry.workspaceId });
      if (typeof prepared.root !== 'string' || !prepared.root.startsWith('/')) fail('PATH_INVALID');
      source.entry.remoteRoot = prepared.root; source.entry.connectionKey = this.connectionKey();
    }
    if (source.entry.deviceId !== deviceId) this.native.screen?.pause(source.id);
    source.entry.deviceId = deviceId; source.entry.revision++; this.save();
    return this.snapshot(source);
  }
  async target(source) {
    const entry = source.entry;
    if (entry.deviceId === 'local') return { transport: this.local, root: entry.localRoot, deviceId: 'local' };
    if (!this.lobster?.maintenance?.ready) fail('CLOUD_DISCONNECTED');
    if (entry.connectionKey !== this.connectionKey()) fail('CONNECTION_CHANGED');
    const resources = await this.probe();
    if (!resources.usable) fail(resources.reason);
    if (!entry.remoteRoot) fail('PATH_INVALID');
    return { transport: this.remote, root: entry.remoteRoot, deviceId: 'cloud' };
  }
  async operation(source, kind, request, context, actor='desktop') {
    if (this.closed) fail('CLOSED');
    if (this.busy.has(source.id)) fail('BUSY');
    const revision = source.entry.revision, connection = this.connectionKey(), generation = this.lobster?.maintenance?.generation;
    const abort = new AbortController(), token = { abort, id: crypto.randomUUID(), toolSession:context?.sessionId,actor };
    this.busy.set(source.id, token);
    const job = { id: token.id, kind, deviceId: source.entry.deviceId, state: 'running', startedAt: this.now(), summary: kind === 'command' ? redact(request.command).slice(0, 1000) : `${request.operation}: ${request.path}` };
    source.entry.jobs.push(job); source.entry.jobs = source.entry.jobs.slice(-20); this.save();
    try {
      const target = await this.target(source);
      if (context) {
        await this.lobster.decision(context, kind === 'command' ? '执行设备命令' : '修改设备文件', { device: target.deviceId, workingDirectory: target.root, ...request, ...(request.base64 ? { base64: '[file content omitted]' } : {}) });
        this.lobster.active(context);
      }
      if (this.closed || abort.signal.aborted) fail('CANCELLED');
      if (source.entry.revision !== revision || (target.deviceId === 'cloud' && (connection !== this.connectionKey() || generation !== this.lobster?.maintenance?.generation))) fail('CONNECTION_CHANGED');
      const result = kind === 'command' ? await target.transport.command(target.root, request, abort.signal) : await target.transport.files(target.root, request);
      if (target.deviceId === 'cloud' && (connection !== this.connectionKey() || generation !== this.lobster?.maintenance?.generation)) fail('CONNECTION_CHANGED');
      job.state = result.stopped ? 'interrupted' : result.exitCode && result.exitCode !== 0 ? 'failed' : 'completed';
      job.exitCode = result.exitCode; job.stopped = result.stopped;
      job.output = result.output === undefined ? undefined : redact(result.output).slice(-16000);
      job.result = result.path ? { path: result.path, size: result.size, sha256: result.sha256 } : undefined;
      return { ...result, deviceId: target.deviceId, workingDirectory: target.root, jobId: job.id };
    } catch (error) { job.state = 'failed'; job.error = redact(error.message); throw error; }
    finally { job.finishedAt = this.now(); if (this.busy.get(source.id) === token) this.busy.delete(source.id); this.save(); }
  }
  async call(action, data = {}, caller = { source: 'desktop', actor: 'desktop' }) {
    if (this.closed) fail('CLOSED');
    const source = await this.source(data.conversationId);
    if (action === 'computer-state') return this.snapshot(source);
    if (action === 'computer-probe') { await this.probe(); return this.snapshot(source); }
    if (action === 'computer-select') return this.select(source, data.deviceId);
    if (action === 'computer-command') return this.operation(source, 'command', commandRequest(data),undefined,caller.actor);
    if (action === 'computer-cancel') { this.busy.get(source.id)?.abort.abort(); this.native.screen?.pause(source.id); return this.snapshot(source); }
    if (action === 'computer-files') {
      const request = fileRequest(data);
      if (['write', 'mkdir'].includes(request.operation)) return this.operation(source, 'files', request,undefined,caller.actor);
      const target = await this.target(source); return { ...await target.transport.files(target.root, request), deviceId: target.deviceId };
    }
    if (action === 'computer-decision') {
      const decision = this.lobster?.decisions.get(data.id);
      if (decision?.context.sessionId !== source.entry.canonicalId) fail('CHAT_INVALID');
      return this.lobster.call('decision', { id: data.id, allow: data.allow === true });
    }
    if (action === 'computer-screen') {
      if (!this.native.screen) fail('SCREEN_UNAVAILABLE');
      if (source.entry.deviceId !== 'local') fail('SCREEN_LOCAL_ONLY');
      if (data.operation === 'start') {
        if (caller.source !== 'desktop') fail('SCREEN_OWNER_REQUIRED');
        return this.native.screen.start(source.id, data.mode === 'ai' ? 'ai' : 'human', data.displayId, caller.actor);
      }
      if (data.operation === 'pause' || data.operation === 'stop') return this.native.screen.pause(source.id);
      if (data.operation === 'claim') return this.native.screen.claim(source.id, caller.actor);
      if (data.operation === 'frame') return this.native.screen.capture(source.id);
      if (data.operation === 'input') return this.native.screen.input(source.id, data.input, caller.actor);
      fail('SCREEN_OPERATION_INVALID');
    }
    if (['computer-pair', 'computer-unpair', 'computer-phone-stop'].includes(action)) {
      if (caller.source !== 'desktop') fail('PHONE_OWNER_REQUIRED');
      if (action === 'computer-pair') return this.mobile.pair(source.id, data.ownerConsent === true);
      if (action === 'computer-unpair') this.mobile.auth.revoke(data.id);
      if (action === 'computer-phone-stop') await this.mobile.close();
      return this.snapshot(source);
    }
    fail('ACTION_INVALID');
  }
  async context(canonicalId) {
    try {
      const source = await this.forCanonical(canonicalId), state = this.snapshot(source);
      return { deviceId: state.deviceId, workingDirectory: state.deviceId === 'cloud' ? state.remoteRoot : state.localRoot, usable: state.deviceId === 'local' || state.cloud.usable, reason: state.deviceId === 'cloud' ? state.cloud.reason : null, recentOperations: state.jobs.slice(-5), screen: state.screen };
    } catch (error) { if (String(error.message).includes('CHAT_NOT_BOUND')) return { deviceId: 'local', configured: false }; throw error; }
  }
  endTurn(canonicalId) {
    for(const [id,entry] of Object.entries(this.state.chats))if(entry.canonicalId===canonicalId){
      if(this.screenState(id).mode==='ai')this.native.screen?.pause(id);
      const operation=this.busy.get(id);if(operation?.toolSession===canonicalId)operation.abort.abort();
    }
  }
  async tool(name, args, context) {
    const source = await this.forCanonical(context.sessionId);
    this.lobster.active(context);
    if (name === 'computer_state') return this.context(context.sessionId);
    if (name === 'computer_command') return this.operation(source, 'command', commandRequest(args), context);
    if (name === 'computer_files') {
      const request = fileRequest({ ...args, ...(args.operation === 'write' ? { base64: Buffer.from(args.text, 'utf8').toString('base64') } : {}) });
      if (['write', 'mkdir'].includes(request.operation)) return this.operation(source, 'files', request, context);
      const target = await this.target(source);
      this.lobster.active(context);
      const result = await target.transport.files(target.root, request);
      if (request.operation === 'read') {
        if (result.size > 256 * 1024) fail('FILE_TOO_LARGE');
        return { path: result.path, size: result.size, sha256: result.sha256, text: Buffer.from(result.base64, 'base64').toString('utf8'), deviceId: target.deviceId };
      }
      return { ...result, deviceId: target.deviceId };
    }
    if (name === 'computer_screen') {
      if (source.entry.deviceId !== 'local') fail('SCREEN_LOCAL_ONLY');
      if (!this.native.screen) fail('SCREEN_UNAVAILABLE');
      if (args.operation === 'capture') {
        const frame = await this.native.screen.capture(source.id);
        return { ...frame, mcpImage: { data: frame.base64, mimeType: 'image/jpeg' }, base64: undefined };
      }
      if (args.operation === 'input') return this.native.screen.input(source.id, args.input, 'ai');
      if (args.operation === 'pause') return this.native.screen.pause(source.id);
    }
    fail('ACTION_INVALID');
  }
  async close() {
    this.closed = true; for (const job of this.busy.values()) job.abort.abort();
    this.native.screen?.close(); await this.mobile.close();
    if (this.lobster?.computers === this) delete this.lobster.computers;
  }
}
module.exports = { Computers };
