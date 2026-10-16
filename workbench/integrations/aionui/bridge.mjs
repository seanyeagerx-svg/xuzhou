import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { WorkbenchAgent, readAgents } from './service.mjs';
import { LobsterClient } from './lobster/client.mjs';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const configFile = arg('--config', path.join(process.env.APPDATA, 'human-ai-workbench', 'workspace.json'));
const dataDir = arg('--data-dir', path.join(process.env.APPDATA, 'workbench-aionui-bridge', 'sessions'));
const endpoint = arg('--lobster-endpoint', process.env.AIONUI_WORKBENCH_ENDPOINT);
const lobster = endpoint ? new LobsterClient(endpoint, dataDir) : null;
let agent;
try {
  const agents = readAgents(configFile);
  const connection = new AgentSideConnection(conn => {
    agent = new WorkbenchAgent(conn, { agents, dataDir, lobster });
    return agent;
  }, ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
  const close = () => { agent?.close(); lobster?.close(); };
  process.on('SIGTERM', () => { close(); process.exit(0); });
  process.on('SIGINT', () => { close(); process.exit(0); });
  await connection.closed;
  close();
} catch (e) {
  // Keep protocol stdout clean, and never dump config objects or provider logs.
  process.stderr.write(`接续助手启动失败：${e.message}\n`);
  agent?.close();
  process.exitCode = 1;
}
