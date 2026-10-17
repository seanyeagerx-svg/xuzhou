const DEPRECATED_RUNTIME_AGENT_TYPES = new Set(['openclaw-gateway', 'nanobot', 'remote', 'gemini']);
// Product launchers are separate from historical assistant records.
const PRODUCT_ASSISTANTS = new Set([
  'Codex',
  'Kiro V3',
  'ZCode',
  'Codex / Kiro / ZCode · 同一对话',
  'Codex / Kiro · 同一对话',
]);
export function isXuzhouAssistant(assistant: { name: string; source: string; agent?: { source?: string } }): boolean {
  return (
    assistant.source === 'generated' && assistant.agent?.source === 'custom' && PRODUCT_ASSISTANTS.has(assistant.name)
  );
}
export function isXuzhouAgent(agent: {
  agent_source: string;
  backend?: string | null;
  args?: string[];
  name: string;
}): boolean {
  return (
    ['codex', 'kiro', 'kiro-v3', 'zcode'].includes(agent.backend || '') ||
    Boolean(
      agent.agent_source === 'custom' &&
      agent.args?.some((arg) => /[\\/]integrations[\\/]aionui[\\/]bridge\.mjs$/.test(arg))
    )
  );
}

export function isDeprecatedRuntimeAgentType(agentType?: string | null): boolean {
  return Boolean(agentType && DEPRECATED_RUNTIME_AGENT_TYPES.has(agentType));
}

export function resolveSupportedConversationType(backend?: string | null): 'acp' | 'aionrs' {
  return backend === 'aionrs' ? 'aionrs' : 'acp';
}
