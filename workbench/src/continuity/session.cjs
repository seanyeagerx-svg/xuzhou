// Copyright 2026 Xuzhou contributors. SPDX-License-Identifier: Apache-2.0
const transfer = require('./transfer.cjs');
const fields = ['remoteId', 'model', 'effort', 'mode', 'sessionOptions', 'availableModels'];

/** Preserve the legacy document shape while keeping each provider independent. */
function routeFor(c, agentId = c.agentId) {
  if (typeof agentId !== 'string' || !agentId || ['__proto__', 'constructor', 'prototype'].includes(agentId)) throw Error('软件来源编号无效');
  if (!c.routes) {
    c.originAgentId ||= c.agentId;
    c.routes = {};
    c.routes[c.agentId] = { agentId: c.agentId, cursor: c.remoteId ? c.messages?.length || 0 : 0 };
    for (const key of fields) c.routes[c.agentId][key] = c[key] ?? null;
  }
  if (!Object.hasOwn(c.routes, agentId)) c.routes[agentId] = { agentId, remoteId: null, model: null, effort: null, mode: null, cursor: 0 };
  return c.routes[agentId];
}
function activateRoute(c, agentId) {
  const route = routeFor(c, agentId);
  c.agentId = agentId;
  for (const key of fields) c[key] = route[key] ?? null;
  return route;
}
function saveOptions(c, options, agentId = c.agentId) {
  if (!options) return;
  const route = routeFor(c, agentId);
  Object.assign(route, { sessionOptions: options, model: options.model || null, effort: options.effort || null, mode: options.mode || null });
  if (c.agentId === agentId) activateRoute(c, agentId);
}
function bindSession(c, agentId, sessionId) {
  const route = routeFor(c, agentId);
  if (route.remoteId !== sessionId) {
    if (route.remoteId) route.previousSessionIds = [...new Set([...(route.previousSessionIds || []), route.remoteId])];
    route.remoteId = sessionId;
    route.cursor = 0;
  }
  route.contextUncertain = false;
  if (c.agentId === agentId) activateRoute(c, agentId);
  return route;
}
function matchesSession(c, agentId, remoteId) {
  return Boolean(agentId && remoteId && (c.agentId === agentId && c.remoteId === remoteId || c.routes?.[agentId]?.remoteId === remoteId));
}
function acceptsTurnEvent(c, event) {
  const owner = c.activeTurn || { agentId: c.agentId, remoteId: c.remoteId };
  return c.status === 'running' && owner.agentId === event.agentId && owner.remoteId === event.sessionId;
}
function finishTurn(c, status) {
  if (!c.activeTurn) return;
  routeFor(c, c.activeTurn.agentId);
  transfer.acknowledge(c, c.activeTurn, status);
  delete c.activeTurn;
}
function continuation(c, text, agentName) { routeFor(c); return transfer.prepare(c, text, agentName); }
function canSwitch(c, from, to) { return Boolean(c && !c.assistantInbox && from?.role === 'executor' && to?.role === 'executor' && ['codex', 'acp', 'zcode'].includes(to.type)); }
async function selectModel(c, agentId, model, load) {
  if (typeof model !== 'string' || !model) throw Error('请选择可用的模型');
  if (c.status === 'running') throw Error('当前回复尚未结束，模型选择保持不变');
  const adapter = await load(c, agentId), route = routeFor(c, agentId);
  const options = route.model === model ? adapter.sessionOptions(route.remoteId) : await adapter.setSessionOption(route.remoteId, 'model', model);
  if (options?.model !== model) throw Error('所选模型尚未确认，当前选择保持不变');
  saveOptions(c, options, agentId);
  activateRoute(c, agentId);
  c.updatedAt = Date.now();
  return c;
}
module.exports = { routeFor, activateRoute, saveOptions, bindSession, matchesSession, acceptsTurnEvent, finishTurn, continuation, canSwitch, selectModel };
