// Copyright 2026 Xuzhou contributors. SPDX-License-Identifier: Apache-2.0.
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useTalkToButler } from '@/renderer/hooks/assistant/useTalkToButler';

const mocks = vi.hoisted(() => ({ call: vi.fn(), navigate: vi.fn(), error: vi.fn(), mutate: vi.fn() }));
vi.mock('@/renderer/components/layout/Sider/SiderNav/WorkspacePanel/api', () => ({ workspaceCall: mocks.call }));
vi.mock('@/renderer/utils/navigation', () => ({ globalNavigate: mocks.navigate }));
vi.mock('@arco-design/web-react', () => ({ Message: { error: mocks.error } }));
vi.mock('swr', () => ({ mutate: mocks.mutate }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
beforeEach(() => vi.clearAllMocks());

it('settings and repair links prefill the unified chat without creating an upstream assistant', async () => {
  mocks.call.mockResolvedValue({ assistantId: 'unified-local' });
  const hook = renderHook(() => useTalkToButler());
  await act(() => hook.result.current({ prompt: 'Explain this local error', files: ['test.txt'] }));
  expect(mocks.call).toHaveBeenCalledExactlyOnceWith('chat-options');
  expect(mocks.navigate).toHaveBeenCalledWith('/guid', {
    state: {
      selectedAssistantId: 'unified-local',
      prefillPrompt: 'Explain this local error',
      prefillFiles: ['test.txt'],
    },
  });
});

it('a missing integration reports an error and never falls back to an unwanted preset', async () => {
  mocks.call.mockResolvedValue({});
  const hook = renderHook(() => useTalkToButler());
  await expect(hook.result.current({ prompt: 'Diagnose' })).rejects.toThrow();
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalled();
});
