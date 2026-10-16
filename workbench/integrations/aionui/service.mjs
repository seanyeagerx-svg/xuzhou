import media from '../../src/continuity/media.cjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { RequestError } from '@agentclientprotocol/sdk';
import { SessionStore } from './store.mjs';

const require = createRequire(import.meta.url);
const { CodexAdapter, AcpAdapter } = require('../../src/adapters.cjs');
const { ZcodeAdapter, discoverZcode } = require('../../src/zcode.cjs');
const { KiroV3Adapter, v3Config } = require('./kiro/adapter.cjs');
const routing = require('../../src/conversation-routing.cjs');
const { applyImport } = require('./workspace/seed.cjs');
const { applyUpdates } = require('./workspace/updates.cjs');
const longContext = require('./workspace/context/continuation.cjs');
const modelKey = (agent, model) => `${agent}/${encodeURIComponent(model)}`;
// ACP reserves -32000 for authentication; ordinary runtime failures must not
// turn into misleading login prompts in the host.
const error = message => new RequestError(-32603, message);

export function readAgents(configFile, discover = discoverZcode) {
  const data = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const agents = data.agents.filter(a => ({codex:'codex',kiro:'acp',zcode:'zcode'})[a.id] && ({codex:'codex',kiro:'acp',zcode:'zcode'})[a.id] === a.type);
  const savedZcode = agents.find(a => a.id === 'zcode');
  if (!savedZcode?.command) {
    const zcode = discover();
    if (zcode) {
      if (savedZcode) Object.assign(savedZcode, {...zcode, ...savedZcode, command:zcode.command});
      else agents.push(zcode);
    }
  }
  if (!agents.length) throw new Error('配置中没有可用的执行 AI 连接');
  const kiro = agents.find(a => a.id === 'kiro');
  return kiro ? [...agents.map(a => a.id === 'kiro' ? {...a, legacy: true} : a), v3Config(kiro)] : agents;
}

export class WorkbenchAgent {
  constructor(connection, { agents, dataDir, adapterFactory, lobster = null, turnTimeout = 15 * 60_000, cancelGrace = 3000 }) {
    this.connection = connection;
    this.agents = agents;
    this.store = new SessionStore(dataDir);
    this.sessions = new Map();
    this.makeAdapter = adapterFactory || (config => config.id === 'kiro-v3' ? new KiroV3Adapter(config) : config.type === 'zcode' ? new ZcodeAdapter(config) : config.type === 'codex' ? new CodexAdapter(config) : new AcpAdapter(config));
    this.turnTimeout = turnTimeout;
    this.cancelGrace = cancelGrace;
    this.lobster = lobster;
  }
  async initialize() {
    return {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, mcpCapabilities: { http: false, sse: false }, promptCapabilities: { image: true, audio: false, embeddedContext: false } },
      agentInfo: { name: 'workbench-continuity', title: '续舟 · 软件与模型接续', version: '0.3.0' },
      authMethods: [],
    };
  }
  async authenticate() { return {}; }
  checkedCwd(cwd) {
    if (!path.isAbsolute(cwd) || !fs.statSync(cwd).isDirectory()) throw error('请选择存在的项目文件夹');
    return fs.realpathSync(cwd);
  }
  runtime(c) {
    return { c, mcpServers: [], adapters: new Map(), operation: null, turn: null, output: Promise.resolve(), permissions: new Map() };
  }
  get(id) {
    const s = this.sessions.get(id);
    if (!s) throw error('请先创建或恢复这段对话');
    return s;
  }
  idle(s) {
    if (s.turn || s.operation) throw error('当前回复或模型切换尚未结束');
  }
  send(s, update) {
    s.output = s.output.then(() => this.connection.sessionUpdate({ sessionId: s.c.id, update }));
    // A terminal connection error is handled by the entry point's close path.
    s.output.catch(() => {});
    return s.output;
  }
  modelState(s) {
    const c = s.c;
    const models = this.agents.flatMap(a => (c.routes?.[a.id]?.sessionOptions?.models || []).map(m => ({
      modelId: modelKey(a.id, m.id), name: `${m.name || m.id} · ${a.name}`, description: m.description || `使用 ${a.name} 原有登录和能力`,
    })));
    const currentModelId = modelKey(c.agentId, c.model);
    const current = c.routes?.[c.agentId]?.sessionOptions;
    const efforts = current?.models?.find(m => m.id === c.model)?.efforts || [];
    const configOptions = [{ id: 'model', name: '模型', category: 'model', type: 'select', currentValue: currentModelId,
      options: models.map(m => ({ value: m.modelId, name: m.name, description: m.description })) }];
    // AionCore merges catalogs by id. An empty choice list explicitly clears
    // the preceding provider's capability when switching to Kiro.
    configOptions.push({ id: 'reasoning_effort', name: '思考强度', category: 'thought_level', type: 'select', currentValue: efforts.length ? c.effort || '' : '',
      options: efforts.map(e => ({value:e.id,name:e.name || e.id,description:e.description})) });
    return {
      models: { currentModelId, availableModels: models },
      configOptions,
    };
  }
  async adapter(s, agentId) {
    const config = this.agents.find(a => a.id === agentId);
    if (!config) throw error('未知的软件来源');
    let a = s.adapters.get(agentId);
    if (!a) {
      const lobsterLinks = await this.lobster?.attach(s.c);
      a = this.makeAdapter(config);
      a.runtimeInstructions = '你通过续舟接续助手处理用户指定项目，用户负责判断和验收。使用当前软件自身的登录和工具。切换软件时传递的是可见对话，不是对方的内部思考、登录凭据或未呈现的工具状态；按当前文件核实结果。禁止修改系统代理、VPN、TUN、DNS、路由、hosts、证书以及其他软件的登录或网络配置。不要外发消息或发布，除非用户明确授权。' + (lobsterLinks ? '工作台自动将开始、结果和用户验收状态汇报给本项目龙虾助理。重要中间进展可用 workbench_report 补充；排队不代表已送达。使用 lobster_status、lobster_history 查看本项目资料；独立维修用 lobster_maintenance，先检查，改变服务前由用户确认。维修任务只有 completed 且服务和就绪验证通过才算恢复完成。不要索取密码或自行运行 SSH 绕过面板。' : '龙虾工具通道暂不可用，不要声称已同步或修复。请在龙虾面板检查连接。');
      a.runtimeInstructions += longContext.instructions;
      a.sessionMcpServers = () => [...s.mcpServers, longContext.server(this.store, s.c)];
      if (lobsterLinks) a.lobsterBridge = () => lobsterLinks[agentId === 'kiro-v3' ? 'kiro' : agentId];
      a.on('event', event => this.event(s, a, event));
      a.on('approval', approval => void this.permission(s, a, approval));
      s.adapters.set(agentId, a);
    }
    if (!a.ready) await a.connect(s.c.cwd);
    return a;
  }
  async ensureRoute(s, agentId) {
    const a = await this.adapter(s, agentId);
    const r = routing.routeFor(s.c, agentId);
    if (!r.remoteId || !a.sessions.has(r.remoteId) || r.contextUncertain) {
      const preferredEffort = r.effort;
      let native;
      try { native = await a.newSession(s.c.cwd, r.model, r.contextUncertain ? null : r.remoteId, s.c.id); }
      catch (e) {
        if (!r.remoteId || r.contextUncertain || !/already has an active writer/.test(e.message)) throw e;
        // Do not steal another client's native thread. The canonical visible
        // transcript remains authoritative, and bindSession retains the old ID.
        native = await a.newSession(s.c.cwd, r.model, null, s.c.id);
        s.resumeNotice = '原软件会话被其他连接占用；已保留原会话，并使用本聊天完整的可见前文接续。';
      }
      routing.bindSession(s.c, agentId, native.id);
      let options = native.options || a.sessionOptions(native.id);
      if (preferredEffort && options.models?.find(m => m.id === options.model)?.efforts?.some(e => e.id === preferredEffort)) {
        options = await a.setSessionOption(native.id, 'effort', preferredEffort);
      }
      routing.saveOptions(s.c, options, agentId);
    }
    return a;
  }
  async newSession(params) {
    this.checkSessionParams(params);
    const c = { id: crypto.randomUUID(), cwd: this.checkedCwd(params.cwd), agentId: this.agents[0].id,
      kind: 'chat', status: 'idle', messages: [], routes: {}, createdAt: Date.now() };
    const s = this.runtime(c);
    s.mcpServers = params.mcpServers || [];
    this.store.claim(c.id);
    this.sessions.set(c.id, s);
    // Independent native sessions supply their real model lists. No API keys,
    // provider cookies or private native histories are copied into this store.
    const candidates = this.agents.filter(a => !a.legacy);
    const discovered = await Promise.allSettled(candidates.map(a => this.ensureRoute(s, a.id)));
    const first = candidates.find((_, i) => discovered[i].status === 'fulfilled');
    if (!first) {
      this.closeSession(s);
      throw error(discovered.map(x => x.reason?.message).filter(Boolean).join('；'));
    }
    routing.activateRoute(c, first.id);
    this.store.save(c);
    return { sessionId: c.id, ...this.modelState(s) };
  }
  async loadSession(params) {
    this.checkSessionParams(params);
    if (this.sessions.has(params.sessionId)) {
      const s = this.get(params.sessionId);
      this.idle(s);
      if (s.c.cwd !== this.checkedCwd(params.cwd)) throw error('恢复时的项目文件夹与原对话不一致');
      if (JSON.stringify(s.mcpServers) !== JSON.stringify(params.mcpServers || [])) throw error('MCP 配置已改变，请断开后重新恢复这段对话');
      return this.modelState(s);
    }
    const c = this.store.read(params.sessionId);
    if (c.cwd !== this.checkedCwd(params.cwd)) throw error('恢复时的项目文件夹与原对话不一致');
    this.store.claim(c.id);
    if (c.status === 'running') {
      const partial = c.messages.at(-1);
      if (partial?.role === 'assistant') partial.status = 'interrupted';
      routing.finishTurn(c, 'interrupted');
      c.status = 'idle';
    }
    const s = this.runtime(c);
    s.mcpServers = params.mcpServers || [];
    this.sessions.set(c.id, s);
    // Existing chats discover newly installed providers without changing their
    // active model, transcript, or native session. Unavailable providers stay optional.
    await Promise.allSettled(this.agents.filter(a => !a.legacy && !c.routes?.[a.id]?.sessionOptions?.models?.length).map(a => this.ensureRoute(s, a.id)));
    this.store.save(c);
    // ACP load replays visible history. AionUi suppresses replay notifications
    // while restoring an already persisted conversation.
    for (const m of c.messages) {
      if (m.text && ['user', 'assistant'].includes(m.role)) await this.send(s, {
        sessionUpdate: m.role === 'user' ? 'user_message_chunk' : 'agent_message_chunk',
        content: { type: 'text', text: m.text },
      });
    }
    return this.modelState(s);
  }
  checkSessionParams(params) {
    if (params.additionalDirectories?.length) throw error('此接续样机暂只支持一个项目文件夹');
    if (params.mcpServers?.some(s => s.type === 'http' || s.type === 'sse')) throw error('此接续样机暂只支持本地 stdio MCP 服务');
  }
  async unstable_setSessionModel({ sessionId, modelId }) {
    const s = this.get(sessionId);
    this.idle(s);
    const choice = this.modelState(s).models.availableModels.find(m => m.modelId === modelId);
    if (!choice) throw error('所选模型不在实际可用列表中');
    const split = modelId.indexOf('/');
    s.operation = 'model';
    try {
      await routing.selectModel(s.c, modelId.slice(0, split), decodeURIComponent(modelId.slice(split + 1)),
        (_, id) => this.ensureRoute(s, id));
      this.store.save(s.c);
      await this.send(s, { sessionUpdate: 'config_option_update', configOptions: this.modelState(s).configOptions });
      return {};
    } catch (e) { throw error(e.message); }
    finally { s.operation = null; }
  }
  async setSessionConfigOption({ sessionId, configId, value }) {
    if (configId === 'model') await this.unstable_setSessionModel({ sessionId, modelId: value });
    else if (configId === 'reasoning_effort') {
      const s = this.get(sessionId); this.idle(s);
      if (!this.modelState(s).configOptions.find(o => o.id === 'reasoning_effort')?.options.length) throw error('当前软件没有提供可独立切换的思考强度');
      s.operation = 'effort';
      try {
        const a = await this.ensureRoute(s, s.c.agentId);
        const options = await a.setSessionOption(s.c.remoteId, 'effort', value);
        if (options.effort !== value) throw error('思考强度尚未确认，当前选择保持不变');
        routing.saveOptions(s.c, options); this.store.save(s.c);
        await this.send(s, { sessionUpdate: 'config_option_update', configOptions: this.modelState(s).configOptions });
      } catch (e) { throw error(e.message); }
      finally { s.operation = null; }
    } else throw error('暂不支持这个配置选项');
    return { configOptions: this.modelState(this.get(sessionId)).configOptions };
  }
  async prompt({ sessionId, prompt }) {
    const s = this.get(sessionId);
    this.idle(s);
    const images = media.validate(prompt);
    let attachments = [], imageInput = [];
    const text = applyImport(s.c, prompt.filter(p => p.type === 'text').map(p => p.text).join('\n') || (images.length ? '请参考随附图片。' : ''), this.store.root);
    if (!text.trim() || text.length > 160000) throw error('消息为空或超过传递上限，尚未发送');
    applyUpdates(s.c, this.store.root);
    const preparation = { kind: 'prepare', cancelled: false };
    s.operation = preparation;
    let a, carried;
    try {
      a = await this.ensureRoute(s, s.c.agentId);
      if (preparation.cancelled || s.closed) return { stopReason: 'cancelled' };
      const hasPendingImages = images.length || s.c.messages.slice(s.c.routes?.[s.c.agentId]?.contextUncertain ? 0 : (s.c.routes?.[s.c.agentId]?.cursor || 0)).some(m => m.attachments?.length);
      if (hasPendingImages && !media.supportsImages(a)) throw error('此软件尚未确认图片能力，请切换到支持图片的软件后发送；图片不会被静默丢弃。');
      attachments = media.stage(this.store.root, images); imageInput = media.pending(this.store.root, s.c, attachments);
      carried = longContext.continuation(s.c, text, id => this.agents.find(a => a.id === id)?.name || id);
    } catch (e) { throw error(e.message); }
    finally { s.operation = null; }
    const c = s.c;
    const taskId = crypto.randomUUID();
    c.messages.push({ id: crypto.randomUUID(), role: 'user', text, ...(attachments.length ? { attachments } : {}) });
    const reply = { id: crypto.randomUUID(), role: 'assistant', text: '', agentId: c.agentId,
      agentName: this.agents.find(a => a.id === c.agentId).name, settings: { model: c.model, effort: c.effort }, status: 'running' };
    c.messages.push(reply);
    c.activeTurn = { agentId: c.agentId, remoteId: c.remoteId, transfer: carried.transfer };
    c.continuity ||= { version: 1, handoffs: [] };
    c.continuity.prepared = carried.transfer;
    c.status = 'running';
    this.store.save(c);
    return new Promise((resolve, reject) => {
      const turn = { reply, resolve, reject, a, taskId, goal: text, items: new Map(), tools: new Set(), cancelled: false, lastSave: Date.now() };
      s.turn = turn;
      if (s.resumeNotice) {
        this.send(s, { sessionUpdate: 'tool_call', toolCallId: 'resume-' + taskId, kind: 'other', title: s.resumeNotice, status: 'completed' });
        delete s.resumeNotice;
      }
      turn.timer = setTimeout(() => { void this.stop(s, '执行等待超时，下一次发送会核对并重新接续'); }, this.turnTimeout);
      Promise.resolve(this.lobster?.record(c, taskId, 'started', { goal: text })).then(() => {
        if (s.turn === turn && !turn.cancelled) return a.prompt(c.remoteId, carried.prompt, imageInput);
      }).catch(e => { if (s.turn === turn) void this.finish(s, 'error', e.message); });
    });
  }
  event(s, a, event) {
    const t = s.turn;
    if (!t || t.a !== a || !routing.acceptsTurnEvent(s.c, event)) return;
    try {
      if (event.type === 'replace') {
        const text = event.text || '';
        if (!text.startsWith(t.reply.text)) throw error('原软件最终回复与已显示内容不一致，已保留记录，请重试');
        const chunk = text.slice(t.reply.text.length);
        t.items.clear(); t.items.set('message', text); t.reply.text = text;
        if (chunk) this.send(s, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk } });
      }
      if (event.type === 'delta' || event.type === 'message-completed') {
        const key = event.itemId || 'message';
        const old = t.items.get(key) || '';
        const next = event.type === 'delta' ? old + event.text : event.text || old;
        const chunk = event.type === 'delta' ? event.text : next.startsWith(old) ? next.slice(old.length) : '';
        if (!t.items.has(key) && t.items.size && chunk) this.send(s, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '\n\n' } });
        t.items.set(key, next);
        t.reply.text = [...t.items.values()].join('\n\n');
        if (chunk) this.send(s, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk } });
        if (Date.now() - t.lastSave > 1000) { this.store.save(s.c); t.lastSave = Date.now(); }
      }
      if (event.type === 'tool') {
        const d = event.details || {};
        const id = String(d.toolCallId || d.id || event.tool);
        const status = ({ inProgress: 'in_progress', in_progress: 'in_progress', completed: 'completed', failed: 'failed', declined: 'failed', pending: 'pending' })[event.status] || 'in_progress';
        const kind = ['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'switch_mode', 'other'].includes(d.kind) ? d.kind : event.tool === 'commandExecution' ? 'execute' : event.tool === 'fileChange' ? 'edit' : 'other';
        const update = { sessionUpdate: t.tools.has(id) ? 'tool_call_update' : 'tool_call', toolCallId: id, title: String(event.text || event.tool || '工具'), status, kind };
        if (d.rawInput !== undefined) update.rawInput = d.rawInput;
        if (d.rawOutput !== undefined) update.rawOutput = d.rawOutput;
        if (Array.isArray(d.content)) update.content = d.content;
        if (d.aggregatedOutput) update.content = [{ type: 'content', content: { type: 'text', text: d.aggregatedOutput } }];
        t.tools.add(id);
        this.send(s, update);
      }
      if (['completed', 'cancelled', 'error'].includes(event.type)) void this.finish(s, event.type, event.text);
    } catch (e) { void this.finish(s, 'error', e.message); }
  }
  async permission(s, a, request) {
    const t = s.turn;
    if (!t || t.a !== a || t.cancelled) {
      try { a.approve(request.requestId, 'deny'); } catch { /* Provider already disconnected. */ }
      return;
    }
    // Kiro V3 names MCP permission requests with the server/tool identity.
    // Only this host-owned, current-chat, read-only server bypasses the UI.
    // File, command, other MCP and maintenance permissions keep the normal path.
    if (a.config.id === 'kiro-v3' && request.method === 'session/request_permission' &&
        /^@workbench_history\/history_(search|read|overview)$/.test(request.params.toolCall?.title || '')) {
      const once = request.params.options?.find(option => option.kind === 'allow_once');
      const native = a.approvals.get(request.requestId);
      if (once && native) {
        a.rpc.respond(native.id, { outcome: { outcome: 'selected', optionId: once.optionId } });
        a.approvals.delete(request.requestId);
        return;
      }
    }
    const pending = { a, request, active: true };
    s.permissions.set(request.requestId, pending);
    void this.lobster?.record(s.c, t.taskId, 'waiting', { goal: t.goal, result: t.reply.text }).catch(() => {});
    try {
      if (/requestUserInput|elicitation/.test(request.method)) throw error('此样机尚未接入原软件的问答表单，请在聊天中补充要求');
      const native = request.method === 'session/request_permission';
      const options = native ? request.params.options : [
        { optionId: 'allow', name: '允许本次操作', kind: 'allow_once' },
        { optionId: 'deny', name: '拒绝', kind: 'reject_once' },
      ];
      const toolCall = native ? request.params.toolCall : {
        toolCallId: String(request.params.itemId || request.requestId), title: String(request.params.command || request.params.reason || '请求执行项目操作'),
        status: 'pending', rawInput: request.params,
      };
      const result = await this.connection.requestPermission({ sessionId: s.c.id, toolCall, options });
      if (!pending.active || !s.turn || s.turn !== t || t.cancelled) return;
      const selected = result.outcome?.outcome === 'selected' && options.find(o => o.optionId === result.outcome.optionId);
      if (native) {
        const m = a.approvals.get(request.requestId);
        if (m) { a.rpc.respond(m.id, selected ? result : { outcome: { outcome: 'cancelled' } }); a.approvals.delete(request.requestId); }
      } else a.approve(request.requestId, selected?.kind.startsWith('allow') ? 'allow' : 'deny');
    } catch (e) {
      if (pending.active) { try { a.approve(request.requestId, 'deny'); } catch { /* Request already ended. */ } }
      if (/问答表单/.test(e.message)) void this.stop(s, e.message);
    } finally { s.permissions.delete(request.requestId); }
  }
  denyPending(s) {
    for (const p of s.permissions.values()) {
      p.active = false;
      try { p.a.approve(p.request.requestId, 'deny'); } catch { /* Provider already disconnected. */ }
    }
    s.permissions.clear();
  }
  async finish(s, status, message = '') {
    const t = s.turn;
    if (!t) return;
    s.turn = null;
    clearTimeout(t.timer);
    clearTimeout(t.cancelTimer);
    this.denyPending(s);
    if (t.stopError) { status = 'error'; message = t.stopError; }
    if (t.cancelled && status !== 'error') status = 'cancelled';
    t.reply.status = status;
    routing.finishTurn(s.c, status);
    s.c.status = 'idle';
    s.c.updatedAt = Date.now();
    try {
      this.store.save(s.c);
      await this.lobster?.record(s.c, t.taskId, status === 'completed' ? 'awaiting-review' : status, { goal: t.goal, result: t.reply.text, error: message });
      await s.output;
      if (status === 'error') t.reject(error(message || '原软件执行失败，前文仍保留'));
      else t.resolve({ stopReason: status === 'cancelled' ? 'cancelled' : 'end_turn' });
    } catch (e) { t.reject(error(e.message)); }
  }
  async stop(s, message) {
    const t = s.turn;
    if (!t) {
      if (s.operation?.kind === 'prepare') s.operation.cancelled = true;
      return;
    }
    if (t.cancelled) return;
    t.cancelled = true;
    t.stopError = message;
    this.denyPending(s);
    void this.lobster?.record(s.c, t.taskId, message ? 'error' : 'cancelled', { goal: t.goal, result: t.reply.text, error: message || '' }).catch(() => {});
    t.cancelTimer = setTimeout(() => {
      if (s.turn !== t) return;
      void this.finish(s, message ? 'error' : 'cancelled', message);
      t.a.close();
    }, this.cancelGrace);
    // A native interrupt request can itself hang. The fallback must already be
    // armed, and ACP's cancel notification must not wait for that request.
    Promise.resolve().then(() => t.a.cancel(s.c.remoteId)).catch(() => {});
  }
  async cancel({ sessionId }) { await this.stop(this.get(sessionId)); }
  closeSession(s) {
    s.closed = true;
    if (s.turn) void this.finish(s, 'error', '连接中断，下一次恢复时会重新核对接续状态');
    for (const a of s.adapters.values()) a.close();
    this.lobster?.detach(s.c);
    this.store.release(s.c.id);
    this.sessions.delete(s.c.id);
  }
  close() { for (const s of [...this.sessions.values()]) this.closeSession(s); }
}
