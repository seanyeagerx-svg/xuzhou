import { describe, expect, it } from 'vitest';

import {
  isDeprecatedRuntimeAgentType,
  resolveSupportedConversationType,
  isXuzhouAssistant,
  isXuzhouAgent,
} from '@/renderer/utils/model/agentTypeSupportPolicy';

describe('Guid agent support policy', () => {
  it('removes Claude and role templates from new assistant choices while leaving records untouched', () => {
    const old = { name: 'Claude', source: 'builtin', agent: { source: 'internal' } };
    expect(isXuzhouAssistant(old)).toBe(false);
    expect(isXuzhouAssistant({ name: 'Codex', source: 'generated', agent: { source: 'custom' } })).toBe(true);
    expect(old.name).toBe('Claude');
  });
  it('rejects an unrelated custom launcher and accepts the connected software bridge', () => {
    expect(isXuzhouAgent({ name: 'Other', agent_source: 'custom', args: ['/other/agent.mjs'] })).toBe(false);
    expect(
      isXuzhouAgent({
        name: 'Codex',
        agent_source: 'custom',
        args: ['/project/workbench/integrations/aionui/bridge.mjs'],
      })
    ).toBe(true);
  });
  it('marks retired top-level runtime agent types as deprecated', () => {
    expect(isDeprecatedRuntimeAgentType('acp')).toBe(false);
    expect(isDeprecatedRuntimeAgentType('aionrs')).toBe(false);
    expect(isDeprecatedRuntimeAgentType('openclaw-gateway')).toBe(true);
    expect(isDeprecatedRuntimeAgentType('nanobot')).toBe(true);
    expect(isDeprecatedRuntimeAgentType('remote')).toBe(true);
    expect(isDeprecatedRuntimeAgentType('gemini')).toBe(true);
  });

  it('resolves supported top-level conversation type from backend labels', () => {
    expect(resolveSupportedConversationType('aionrs')).toBe('aionrs');
    expect(resolveSupportedConversationType('claude')).toBe('acp');
    expect(resolveSupportedConversationType('gemini')).toBe('acp');
    expect(resolveSupportedConversationType('openclaw-gateway')).toBe('acp');
    expect(resolveSupportedConversationType('openclaw')).toBe('acp');
  });
});
