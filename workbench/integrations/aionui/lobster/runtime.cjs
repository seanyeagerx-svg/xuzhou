const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { atomicJson, Vault } = require('../../../src/store.cjs');
const { MessageSync, safeText } = require('../../../src/message-sync.cjs');
const { OpenClawAdapter } = require('../../../src/openclaw.cjs');
const { Maintenance, validateProfile, validateOperation } = require('../../../src/maintenance.cjs');
const { LobsterHub } = require('../../../src/lobster-hub.cjs');
const { Delivery } = require('./delivery.cjs');
const { Control } = require('./control.cjs');
const uuid = value => typeof value === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value);
const read = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
const sameRoot = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const targetMatches = (job, profile) => profile && job.host === profile.host && job.username === profile.username && job.port === profile.port;
function applyJobReport(job, report) {
  if (!['running', 'completed', 'failed'].includes(report?.state)) throw new Error('服务器维修报告状态无效');
  if (report.state === 'completed' && (report.verification?.readiness?.ready !== true || report.verification?.service?.ActiveState !== 'active' || report.verification?.service?.SubState !== 'running')) throw new Error('维修报告缺少服务运行与就绪验证');
  for (const key of ['state', 'phase', 'finishedAt', 'error', 'backup', 'steps', 'verification', 'reclaimedBytes']) if (report[key] !== undefined) job[key] = report[key];
}

class LobsterRuntime extends EventEmitter {
  constructor({ directory, legacyDirectory, safeStorage, gatewayFactory, maintenanceFactory, autoConnect = true }) {
    super(); this.directory = directory; this.autoConnect = autoConnect; this.file = path.join(directory, 'workspace.json');
    fs.mkdirSync(directory, { recursive: true });
    if (!fs.existsSync(this.file)) this.importLegacy(legacyDirectory);
    this.state = read(this.file);
    if (!this.state || !Array.isArray(this.state.projects) || !Array.isArray(this.state.conversations) || !Array.isArray(this.state.tasks)) throw new Error('龙虾资料格式损坏，已保留原文件');
    // Profiles created before ZCode integration need the same executor identity
    // used by scoped tools. Do not import credentials or rewrite legacy config.
    if (!this.state.agents.some(a => a.id === 'zcode')) this.state.agents.push({id:'zcode',name:'ZCode',type:'zcode',role:'executor'});
    const encrypted = read(path.join(directory, 'credentials.json'), {});
    if (!encrypted || Array.isArray(encrypted) || Object.values(encrypted).some(x => typeof x !== 'string')) throw new Error('加密连接资料格式损坏，已保留原文件');
    this.vault = new Vault(directory, safeStorage);
    this.clients = new Map(); this.decisions = new Map(); this.gatewayStatus = { state: 'disconnected', detail: '尚未连接龙虾' };
    this.gateway = gatewayFactory ? gatewayFactory(this.gatewayConfig(), this.vault) : new OpenClawAdapter(this.gatewayConfig(), this.vault);
    this.maintenance = maintenanceFactory ? maintenanceFactory(() => this.state.maintenanceProfile, this.vault) : new Maintenance(() => this.state.maintenanceProfile, this.vault);
    this.delivery = new Delivery(this);
    this.sync = new MessageSync({ directory, getState: () => this.state, deliver: batch => this.delivery.deliver(batch), onChange: () => this.changed() });
    this.hub = new LobsterHub({ call: (name, args, context) => this.tool(name, args, context) });
    this.controlServer = new Control(this);
    this.gateway.on('status', s => { this.gatewayStatus = s; this.changed(); });
    this.gateway.on('event', e => this.delivery.event(e));
    // Automatic reports never authorize cloud-side execution.
    this.gateway.on('approval', request => { void this.gateway.approve(request.requestId, 'deny').catch(() => {}); });
    this.maintenance.on('status', () => this.changed());
    this.maintenance.on('host-key', () => this.changed());
    for (const c of this.state.conversations.filter(x => x.agentId !== 'openclaw' && x.status === 'running')) {
      const t = this.state.tasks.find(x => x.id === c.activeTaskId);
      if (t) { t.status = 'interrupted'; this.sync.capture(c, t, 'interrupted'); }
      c.status = 'idle'; delete c.activeTaskId;
    }
    this.save();
  }
  importLegacy(directory) {
    const old = read(path.join(directory, 'workspace.json'), {});
    const gateway = old.agents?.find(x => x.type === 'openclaw');
    const state = { version: 1, importedAt: Date.now(), projects: old.projects || [], agents: (old.agents || []).filter(x => ['openclaw', 'codex', 'kiro', 'zcode'].includes(x.id)),
      conversations: (old.conversations || []).filter(x => x.agentId === 'openclaw').map(x => ({ ...x, gateway: gateway?.url, status: 'idle' })),
      tasks: [], maintenanceJobs: old.maintenanceJobs || [], maintenanceProfile: old.maintenanceProfile || {}, diagnosis: null };
    if (!gateway) state.agents.push({ id: 'openclaw', type: 'openclaw', name: '龙虾', role: 'assistant', url: '' });
    const credentials = read(path.join(directory, 'credentials.json'), {});
    const allowed = Object.fromEntries(Object.entries(credentials).filter(([key]) => /^openclaw-(device|device-token|token)$/.test(key) || key.startsWith('maintenance-host:')));
    // Copy encrypted values only. Existing workbench data is never mutated.
    atomicJson(path.join(this.directory, 'credentials.json'), allowed);
    const queue = read(path.join(directory, 'message-sync.json'), null);
    if (queue) atomicJson(path.join(this.directory, 'message-sync.json'), queue);
    atomicJson(this.file, state);
  }
  gatewayConfig() { return this.state.agents.find(x => x.type === 'openclaw'); }
  project(id) { const p = this.state.projects.find(x => x.id === id); if (!p) throw new Error('项目不存在'); return p; }
  projectFor(cwd) {
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error('项目文件夹无效');
    const root = fs.realpathSync(cwd);
    let p = this.state.projects.find(x => sameRoot(x.root, root));
    if (!p) { p = { id: crypto.randomUUID(), name: path.basename(root) || root, root, createdAt: Date.now() }; this.state.projects.push(p); this.save(); }
    return p;
  }
  save() { atomicJson(this.file, this.state); this.changed(); }
  changed() { if (!this.closed) this.emit('change'); }
  async start() {
    await this.hub.start(); this.endpointFile = await this.controlServer.start();
    this.timer = setInterval(() => { this.expireClients(); void this.sync.flush(); void this.pollJobs(); void this.delivery.reconcile(); }, 3000);
    this.timer.unref?.();
    if (this.autoConnect && this.gatewayConfig().url) void this.connectGateway().catch(() => {});
    return this;
  }
  async connectGateway() {
    if (this.connecting) return this.connecting;
    this.connecting = this.gateway.connect().then(() => { void this.sync.retry(); return { state: 'connected' }; }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
  snapshot(projectId) {
    const trust = this.maintenance.pendingTrust;
    return { available: true, importedAt: this.state.importedAt, projects: this.state.projects,
      gateway: { ...this.gatewayStatus, url: this.gatewayConfig().url, pairing: this.gateway.pairing || null },
      maintenance: { ...this.maintenance.status, ready: this.maintenance.ready, generation: this.maintenance.generation, profile: this.state.maintenanceProfile, hostKey: trust ? { host: trust.host, port: trust.port, fingerprint: trust.fingerprint } : null },
      sync: this.sync.snapshot(projectId), diagnosis: this.state.diagnosis,
      jobs: this.state.maintenanceJobs.filter(x => !projectId || x.projectId === projectId).slice(0, 30), tasks: this.state.tasks.filter(x => !projectId || x.projectId === projectId).slice(-30).reverse(),
      conversations: this.state.conversations.filter(x => x.agentId === 'openclaw' && (!projectId || x.projectId === projectId)).map(c => ({ id: c.id, projectId: c.projectId, title: c.title, gateway: c.gateway, status: c.status, messages: c.messages.slice(-80) })),
      activities: this.state.conversations.filter(c => !projectId || c.projectId === projectId).flatMap(c => (c.activities || []).map(a => ({ ...a, projectId: c.projectId, conversationId: c.id }))).sort((a,b) => b.time-a.time).slice(0,100),
      approvals: [...this.decisions.values()].map(({ id, projectId, agentId, title, details, createdAt }) => ({ id, projectId, agentId, title, details, createdAt })) };
  }
  active(context) {
    const client = this.clients.get(context.clientId);
    const c = this.state.conversations.find(x => x.id === context.sessionId);
    if (!client || Date.now() - client.seenAt > 90000 || c?.status !== 'running' || c.agentId !== context.agentId || c.clientId !== context.clientId || (context.taskId && c.activeTaskId !== context.taskId)) throw new Error('操作未获授权或任务已结束');
    return c;
  }
  attach(data) {
    if (!uuid(data?.clientId) || !uuid(data.sessionId) || !Number.isSafeInteger(data.pid) || data.pid < 1) throw new Error('接续会话无效');
    const project = this.projectFor(data.cwd), old = this.clients.get(data.clientId);
    if (old && (old.sessionId !== data.sessionId || old.projectId !== project.id)) throw new Error('接续范围不能改变');
    let c = this.state.conversations.find(x => x.id === data.sessionId);
    if (c && c.projectId !== project.id) throw new Error('接续项目与原会话不一致');
    if (!c) { c = { id: data.sessionId, projectId: project.id, kind: 'task', agentId: 'codex', status: 'idle', messages: [], activities: [] }; this.state.conversations.push(c); }
    const client = old || { clientId: data.clientId, sessionId: data.sessionId, projectId: project.id, pid: data.pid, links: {} };
    for (const agentId of ['codex', 'kiro', 'zcode']) client.links[agentId] ||= this.hub.issue({ clientId: data.clientId, sessionId: data.sessionId, agentId });
    for(const link of Object.values(client.links))link.computers=!!this.computers;
    client.seenAt = Date.now(); this.clients.set(data.clientId, client); this.save();
    return { projectId: project.id, links: client.links, features:{computers:!!this.computers} };
  }
  async control(method, data) {
    if (method === 'attach') return this.attach(data);
    if (method === 'event') return this.ingest(data);
    const client = this.clients.get(data?.clientId);
    if (method === 'heartbeat') { if (client) client.seenAt = Date.now(); return { attached: !!client }; }
    if (method === 'device-context') {
      if (!client || Date.now()-client.seenAt>90000) throw new Error('接续连接已结束');
      return this.computers?.context(client.sessionId) || {deviceId:'local',configured:false};
    }
    if (method === 'detach') { this.detach(data?.clientId); return {}; }
  }
  ingest(event) {
    if (!uuid(event?.id) || !uuid(event.taskId) || !uuid(event.sessionId) || !uuid(event.clientId) || !['codex', 'kiro', 'zcode'].includes(event.agentId) || !['started', 'awaiting-review', 'error', 'cancelled', 'interrupted', 'waiting'].includes(event.phase)) throw new Error('同步事件无效');
    const project = this.projectFor(event.cwd);
    let c = this.state.conversations.find(x => x.id === event.sessionId);
    if (c && c.projectId !== project.id) throw new Error('事件项目与原会话不一致');
    if (!c) { c = { id: event.sessionId, projectId: project.id, kind: 'task', messages: [], activities: [], status: 'idle' }; this.state.conversations.push(c); }
    let task = this.state.tasks.find(x => x.id === event.taskId);
    if (task && (task.conversationId !== c.id || task.agentId !== event.agentId || task.projectId !== project.id)) throw new Error('同步任务范围不一致');
    if (task?.eventIds?.includes(event.id)) return { state: 'saved' };
    if (task && !['running', 'waiting'].includes(task.status) && ['started', 'waiting'].includes(event.phase)) return { state: 'saved' };
    if (!task) { task = { id: event.taskId, conversationId: c.id, projectId: project.id, agentId: event.agentId, title: safeText(event.goal).replace(/\s+/g, ' ').slice(0, 100), createdAt: event.at || Date.now(), eventIds: [] }; this.state.tasks.push(task); }
    const goal = safeText(event.goal, 16000), result = safeText(event.result, 22000);
    task.status = event.phase === 'started' ? 'running' : event.phase; task.error = safeText(event.error || '');
    c.agentId = event.agentId; c.clientId = event.clientId;
    c.messages = c.messages.filter(x => x.taskId !== task.id);
    c.messages.push({ id: task.id + ':user', role: 'user', text: goal, taskId: task.id, createdAt: task.createdAt }, { id: task.id + ':reply', role: 'assistant', text: result, taskId: task.id, createdAt: Date.now() });
    if (['started', 'waiting'].includes(event.phase)) { c.status = 'running'; c.activeTaskId = task.id; }
    else { c.status = 'idle'; delete c.activeTaskId; this.rejectDecisions(d => d.context.sessionId === c.id); }
    if (!['started','waiting'].includes(event.phase)) this.computers?.endTurn(event.sessionId);
    // Queue first, acknowledge only after both durable writes. Retries dedupe by task/phase.
    this.sync.capture(c, task, event.phase);
    task.eventIds.push(event.id); this.save();
    return { state: 'saved' };
  }
  detach(clientId) {
    const client = this.clients.get(clientId); if (!client) return;
    for (const link of Object.values(client.links)) this.hub.revoke(link.token);
    this.clients.delete(clientId); this.rejectDecisions(d => d.context.clientId === clientId);
    const c = this.state.conversations.find(x => x.id === client.sessionId && x.clientId === clientId);
    if (c?.status === 'running') {
      const task = this.state.tasks.find(x => x.id === c.activeTaskId);
      if (task) { task.status = 'interrupted'; this.sync.capture(c, task, 'interrupted'); }
      c.status = 'idle'; delete c.activeTaskId; this.save();
    }
  }
  expireClients() {
    for (const [id, client] of this.clients) {
      let alive = true; try { process.kill(client.pid, 0); } catch { alive = false; }
      if (!alive || Date.now() - client.seenAt > 90000) this.detach(id);
    }
  }
  rejectDecisions(predicate) { for (const d of this.decisions.values()) if (predicate(d)) d.resolve(false); }
  decision(context, title, details) {
    const c = this.active(context), scoped = { ...context, taskId: c.activeTaskId };
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID(), timer = setTimeout(() => done(false), 10 * 60000);
      const done = allow => {
        clearTimeout(timer); this.decisions.delete(id); this.changed();
        try { this.active(scoped); if (!allow) throw new Error('操作未获授权或任务已结束'); resolve(); } catch (e) { reject(e); }
      };
      this.decisions.set(id, { id, context: scoped, projectId: c.projectId, agentId: c.agentId, title, details, createdAt: Date.now(), resolve: done }); this.changed();
    });
  }
  async tool(name, args, context) {
    const c = this.active(context);
    const activity = { id: crypto.randomUUID(), time: Date.now(), agentId: c.agentId, title: name,
      status: 'running', input: safeText(JSON.stringify(args),20000), details: { tool: name } };
    c.activities ||= []; c.activities.push(activity); this.save();
    try {
      const result = await this.executeTool(name,args,context);
      activity.status = 'completed'; activity.output = safeText(JSON.stringify(result),20000); activity.finishedAt=Date.now(); this.save();
      return result;
    } catch(error) {
      activity.status = 'error'; activity.error = safeText(error.message); activity.finishedAt=Date.now(); this.save(); throw error;
    }
  }
  async executeTool(name, args, context) {
    const c = this.active(context), task = this.state.tasks.find(x => x.id === c.activeTaskId);
    if (name.startsWith('computer_')) {
      if (!this.computers) throw new Error('XUZHOU_DEVICE_UNAVAILABLE');
      return this.computers.tool(name,args,context);
    }
    if (name === 'lobster_status') return { gateway: this.gatewayStatus, maintenance: this.maintenance.status, sync: this.sync.snapshot().projects[c.projectId] || { pending: 0, delivered: 0 } };
    if (name === 'workbench_report') return this.sync.report(c, task, args.message, args.phase);
    if (name === 'lobster_history') {
      const conversations = this.snapshot().conversations.filter(x => x.projectId === c.projectId);
      if (args.conversationId) { const found = conversations.find(x => x.id === args.conversationId); if (!found) throw new Error('只能读取当前项目的龙虾对话'); return found; }
      return { conversations };
    }
    if (name === 'lobster_message') { await this.decision(context, '发送给龙虾', { message: args.message }); return this.delivery.send(c.projectId, args.message, true, { agentId:c.agentId,sourceConversationId:c.id,taskId:c.activeTaskId }); }
    if (name === 'lobster_maintenance') {
      validateOperation(args); const generation = this.maintenance.generation;
      if (args.action !== 'diagnose') {
        if (!this.maintenance.ready) throw new Error('请先在龙虾面板登录独立维修通道');
        await this.decision(context, args.action === 'start' ? '启动并检查龙虾' : '维护并恢复龙虾', { ...args, ...this.maintenance.profile });
        if (!this.maintenance.ready || generation !== this.maintenance.generation) throw new Error('维修连接已变化，请重新核对');
      }
      return this.runMaintenance(args, c.projectId, c.agentId);
    }
    if (name === 'lobster_job') return this.readJob(args.jobId, c.projectId);
    throw new Error('未知龙虾工具');
  }
  async runMaintenance(args, projectId, agentId = 'user') {
    this.project(projectId); const operation = validateOperation(args);
    if (!this.maintenance.ready) throw new Error('请先登录独立维修通道');
    if (operation.action === 'diagnose') {
      const profile = { ...this.maintenance.profile }, generation = this.maintenance.generation;
      const result = await this.maintenance.diagnose();
      if (generation !== this.maintenance.generation) throw new Error('维修连接已变化，检查结果未应用');
      this.state.diagnosis = { projectId, at: Date.now(), profile, result }; this.save(); return this.state.diagnosis;
    }
    const target = this.maintenance.profile;
    if (this.state.maintenanceJobs.some(j => j.state === 'running' && targetMatches(j, target))) throw new Error('已有维修任务在运行，请先核对结果');
    const job = { id: crypto.randomUUID(), ...operation, state: 'running', phase: 'dispatching', host: target.host, username: target.username, port: target.port, startedAt: Date.now() / 1000, projectId, agentId };
    this.state.maintenanceJobs.unshift(job); this.save();
    try { applyJobReport(job, await this.maintenance.launch(operation, job.id)); }
    catch (e) { job.connectionError = safeText(e.message); this.save(); throw new Error('启动结果未确认，任务编号已保存，请重连后核对：' + job.id); }
    this.save(); return job;
  }
  async readJob(id, projectId) {
    const job = this.state.maintenanceJobs.find(x => x.id === id && x.projectId === projectId);
    if (!job) throw new Error('当前项目没有这个维修任务');
    if (!targetMatches(job, this.maintenance.profile)) throw new Error('请连接任务原来的服务器');
    const generation = this.maintenance.generation, report = await this.maintenance.job(id);
    if (generation !== this.maintenance.generation) throw new Error('维修连接已变化');
    applyJobReport(job, report); delete job.connectionError;
    if (job.state !== 'running') this.sync.maintenance(job);
    this.save(); return job;
  }
  async pollJobs() {
    if (this.polling || !this.maintenance.ready) return; this.polling = true;
    try {
      for (const job of this.state.maintenanceJobs.filter(j => j.state === 'running' && targetMatches(j, this.maintenance.profile))) {
        try { await this.readJob(job.id, job.projectId); }
        catch (e) { job.connectionError = safeText(e.message); if (e.message.includes('服务器没有这个维护任务')) { job.state = 'failed'; job.error = '服务器未创建此任务，请重新执行'; this.sync.maintenance(job); } this.save(); }
      }
    } finally { this.polling = false; }
  }
  async call(action, data = {}) {
    if (action === 'state') return this.snapshot(data.projectId);
    if (action === 'gateway-connect') return this.connectGateway();
    if (action === 'gateway-disconnect') { this.gateway.close(); this.gatewayStatus = { state: 'disconnected', detail: '已断开龙虾' }; this.changed(); return {}; }
    if (action === 'gateway-save') {
      const u = new URL(data.url);
      if (u.protocol !== 'wss:' && !(u.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))) throw new Error('远程龙虾需要加密地址');
      if (u.username || u.password || u.search || u.hash) throw new Error('网关地址不能包含凭据');
      if (this.connecting || this.sync.busy || [...this.gateway.sessions.values()].some(x => x.busy)) throw new Error('连接或发送正在进行，请稍后修改');
      this.gateway.close(); this.rejectDecisions(() => true);
      const sameGateway = this.gatewayConfig().url && new URL(this.gatewayConfig().url).href === u.href;
      if (!sameGateway) {
        delete this.vault.data['openclaw-token']; delete this.vault.data['openclaw-device-token'];
        atomicJson(this.vault.file, this.vault.data);
        this.gatewayConfig().url = u.href;
      }
      this.gateway.config = this.gatewayConfig();
      if (data.token) this.vault.set('openclaw-token', data.token);
      this.gatewayStatus = { state: 'disconnected', detail: '连接配置已保存' }; this.save(); return {};
    }
    if (action === 'sync-settings') { this.sync.settings(data.enabled); return {}; }
    if (action === 'sync-retry') { await this.sync.retry(); return {}; }
    if (action === 'history-refresh') return this.delivery.refresh(data.projectId);
    if (action === 'message') return this.delivery.send(data.projectId, data.message);
    if (action === 'accept') {
      const task = this.state.tasks.find(x => x.id === data.taskId && x.projectId === data.projectId);
      if (!task || task.status !== 'awaiting-review') throw new Error('任务尚未等待用户验收');
      task.status = 'accepted'; task.acceptedAt = Date.now();
      this.sync.capture(this.state.conversations.find(x => x.id === task.conversationId), task, 'accepted'); this.save(); return {};
    }
    if (action === 'ssh-connect') {
      const profile = validateProfile(data.profile); this.rejectDecisions(() => true);
      this.maintenance.close(); this.state.maintenanceProfile = profile; this.save();
      await this.maintenance.connect({ password: data.password, passphrase: data.passphrase }); await this.pollJobs(); return {};
    }
    if (action === 'ssh-disconnect') { this.maintenance.close(); this.rejectDecisions(() => true); this.changed(); return {}; }
    if (action === 'ssh-trust') { if (data.fingerprint !== this.maintenance.pendingTrust?.fingerprint) throw new Error('服务器身份核对请求已变化'); this.maintenance.trust(data.allow === true); this.changed(); return {}; }
    if (action === 'maintenance') { if (data.action !== 'diagnose' && data.generation !== this.maintenance.generation) throw new Error('维修连接已变化，请重新确认'); return this.runMaintenance(data, data.projectId); }
    if (action === 'job') return this.readJob(data.jobId, data.projectId);
    if (action === 'decision') { const d = this.decisions.get(data.id); if (!d) throw new Error('确认请求已经结束'); d.resolve(data.allow === true); return {}; }
    throw new Error('未知龙虾面板操作');
  }
  close() {
    this.closed = true; clearInterval(this.timer); this.sync.stop();
    for (const id of [...this.clients.keys()]) this.detach(id);
    this.rejectDecisions(() => true); this.controlServer.close(); this.hub.close(); this.gateway.close(); this.maintenance.close();
  }
}
async function createRuntime(options) { return new LobsterRuntime(options).start(); }
module.exports = { createRuntime, LobsterRuntime, targetMatches, createNativeInput:()=>new (require('../devices/native/input.cjs').NativeInput)(), ...require('../workspace/runtime.cjs'), ...require('../distribution/runtime.cjs') };
