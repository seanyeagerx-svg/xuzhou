// Copyright 2026 Xuzhou contributors. SPDX-License-Identifier: Apache-2.0
const crypto = require('node:crypto');
const { isConfirmationElicitation, sessionServers } = require('../../../../src/adapters.cjs');

// Remember access to a named MCP tool, never a command, filesystem scope,
// questionnaire, or server that was not attached by the current chat host.
function scope(session, adapter, request) {
  const params = request.params || {};
  let serverName, tool;
  if (isConfirmationElicitation(request)) {
    serverName = params.serverName;
    if (typeof serverName !== 'string') return null;
    const prefix = `Allow the ${serverName} MCP server to run tool "`;
    if (typeof params.message !== 'string' || !params.message.startsWith(prefix) || !params.message.endsWith('"?')) return null;
    tool = params.message.slice(prefix.length, -2);
  } else if (request.method === 'session/request_permission') {
    const match = /^@([\w.-]+)\/([\w.:-]+)$/.exec(params.toolCall?.title || '');
    if (!match || !params.options?.some(option => option.kind === 'allow_once')) return null;
    [, serverName, tool] = match;
  } else return null;
  if (!/^[\w.:-]{1,160}$/.test(tool)) return null;
  const server = sessionServers(adapter, session.c.id).find(item => item.name === serverName);
  if (!server) return null;
  const identity = {
    conversationId: session.c.id, provider: adapter.config.id, cwd: session.c.cwd, serverName, tool,
    command: server.command, args: server.args || [],
    env: [...(server.env || [])].sort((a, b) => a.name.localeCompare(b.name)),
  };
  return { key: crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex'),
    provider: adapter.config.id, server: serverName, tool };
}
const grants = conversation => Array.isArray(conversation.toolPermissions) ? conversation.toolPermissions : [];
const has = (conversation, permission) => permission && grants(conversation).some(item => item.key === permission.key);
function remember(conversation, permission) {
  if (!has(conversation, permission)) conversation.toolPermissions = [...grants(conversation), { ...permission, createdAt: Date.now() }];
}
module.exports = { scope, grants, has, remember };
