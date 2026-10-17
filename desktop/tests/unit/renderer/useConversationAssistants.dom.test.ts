/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcBridge } from '@/common';
import { useConversationAssistants } from '@/renderer/pages/conversation/hooks/useConversationAssistants';
import type { Assistant } from '@/common/types/agent/assistantTypes';

vi.mock('@/common', () => ({
  ipcBridge: {
    assistants: {
      list: { invoke: vi.fn() },
    },
  },
}));

describe('useConversationAssistants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads only enabled assistants from the backend catalog', async () => {
    (ipcBridge.assistants.list.invoke as never as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'bare-aionrs',
        name: 'Codex',
        enabled: true,
        source: 'generated',
        agent: { type: 'acp', source: 'custom' },
      },
      {
        id: 'disabled-writer',
        name: 'ZCode',
        enabled: false,
        source: 'generated',
        agent: { type: 'acp', source: 'custom' },
      },
      { id: 'old-claude', name: 'Claude', enabled: true, source: 'builtin' },
      { id: 'assistant-1', name: 'Kiro V3', source: 'generated', agent: { type: 'acp', source: 'custom' } },
    ] satisfies Partial<Assistant>[]);

    const { result } = renderHook(() => useConversationAssistants());

    await waitFor(() => expect(result.current.presetAssistants).toHaveLength(2));

    expect(result.current.presetAssistants.map((assistant) => assistant.id)).toEqual(['bare-aionrs', 'assistant-1']);
  });

  it('keeps the filtered assistant list stable across rerenders when SWR data is unchanged', async () => {
    const catalog = [
      {
        id: 'bare-aionrs',
        name: 'Codex',
        enabled: true,
        source: 'generated',
        agent: { type: 'acp', source: 'custom' },
      },
      { id: 'assistant-1', name: 'Kiro V3', source: 'generated', agent: { type: 'acp', source: 'custom' } },
    ] satisfies Partial<Assistant>[];

    (ipcBridge.assistants.list.invoke as never as ReturnType<typeof vi.fn>).mockResolvedValue(catalog);

    const { result, rerender } = renderHook(() => useConversationAssistants());

    await waitFor(() => expect(result.current.presetAssistants).toHaveLength(2));

    const firstRenderAssistants = result.current.presetAssistants;
    rerender();

    expect(result.current.presetAssistants).toBe(firstRenderAssistants);
  });
});
