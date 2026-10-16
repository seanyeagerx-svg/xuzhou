import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const call = vi.hoisted(() => vi.fn());
vi.mock('@/renderer/components/layout/Sider/SiderNav/WorkspacePanel/api', () => ({ workspaceCall: call }));
import { useContinuity } from '@/renderer/pages/conversation/runtime/Continuity/useContinuity';
const ready = (id: string) => ({ available: true, conversationId: id, totalMessages: 4, sync: null });

describe('Conversation continuity state', () => {
  beforeEach(() => {
    call.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it('automatically refreshes metadata without sending a provider prompt', async () => {
    vi.useFakeTimers();
    call.mockResolvedValue(ready('one'));
    const { result } = renderHook(() => useContinuity('one'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    call.mockResolvedValue({ ...ready('one'), totalMessages: 8 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    expect(result.current.state?.totalMessages).toBe(8);
    expect(call.mock.calls.every(([action]) => action === 'chat-continuity')).toBe(true);
  });
  it('ignores a previous chat response after navigation', async () => {
    let old: ((value: unknown) => void) | undefined;
    call.mockImplementation((_action: string, args: { conversationId: string }) =>
      args.conversationId === 'old'
        ? new Promise((resolve) => {
            old = resolve;
          })
        : Promise.resolve(ready('new'))
    );
    const { result, rerender } = renderHook(({ id }) => useContinuity(id), { initialProps: { id: 'old' } });
    rerender({ id: 'new' });
    await waitFor(() => expect(result.current.state?.conversationId).toBe('new'));
    await act(async () => old?.(ready('old')));
    expect(result.current.state?.conversationId).toBe('new');
  });
  it('persists a pause through the conversation action and exposes connection failures', async () => {
    call.mockResolvedValue(ready('one'));
    const { result } = renderHook(() => useContinuity('one'));
    await waitFor(() => expect(result.current.state?.available).toBe(true));
    call.mockImplementation((action: string) =>
      action === 'chat-sync-toggle' ? Promise.reject(Error('offline')) : Promise.resolve(ready('one'))
    );
    await act(async () => result.current.perform('chat-sync-toggle', false));
    expect(call).toHaveBeenCalledWith('chat-sync-toggle', { conversationId: 'one', enabled: false });
    expect(result.current.error).toContain('offline');
  });
});
