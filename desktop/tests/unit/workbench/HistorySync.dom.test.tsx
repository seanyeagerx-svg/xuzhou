import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistorySyncState } from '@/common/types/platform/workspace';
const call = vi.hoisted(() => vi.fn());
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/components/layout/Sider/SiderNav/WorkspacePanel/api', () => ({ workspaceCall: call }));
import HistorySync from '@/renderer/components/layout/Sider/SiderNav/WorkspacePanel/HistorySync';
const state: HistorySyncState = {
  id: 'import',
  enabled: true,
  inbound: { state: 'ready' },
  outbound: { state: 'unsupported' },
  snapshot: {
    id: 'import',
    cwd: 'D:/project',
    createdAt: 1,
    revision: 0,
    source: { id: 'native', agentId: 'kiro', title: 'Original', cwd: 'D:/project', updatedAt: 1, messages: [] },
  },
};
describe('Automatic history status', () => {
  beforeEach(() => {
    call.mockReset();
    call.mockResolvedValue(state);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it('refreshes automatically and updates the displayed source without a check click', async () => {
    vi.useFakeTimers();
    const update = vi.fn();
    render(<HistorySync id='import' onSnapshot={update} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    call.mockResolvedValue({ ...state, snapshot: { ...state.snapshot, revision: 1 } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(update.mock.calls.at(-1)?.[0].revision).toBe(1);
    expect(call.mock.calls.every(([action]) => action === 'history-sync-state')).toBe(true);
  });
  it('explains an unsupported return path and persists a pause', async () => {
    call.mockImplementation(async (action: string) =>
      action === 'history-sync-toggle' ? { ...state, enabled: false } : state
    );
    render(<HistorySync id='import' onSnapshot={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByTestId('history-sync-status')).toHaveTextContent('settings.workspace.sync.partial')
    );
    fireEvent.click(screen.getByTestId('history-sync-status'));
    expect(screen.getByText('settings.workspace.sync.kiroHint')).toBeInTheDocument();
    expect(screen.getByText('settings.workspace.sync.longContext')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('history-sync-toggle'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('history-sync-toggle', { id: 'import', enabled: false }));
    await screen.findByText('settings.workspace.sync.paused');
  });
  it('ignores an old chat response after the user switches chats', async () => {
    let finish: ((value: HistorySyncState) => void) | undefined;
    call.mockImplementation(async (_action: string, args: { id: string }) =>
      args.id === 'old'
        ? new Promise<HistorySyncState>((resolve) => {
            finish = resolve;
          })
        : { ...state, id: 'new' }
    );
    const update = vi.fn();
    const { rerender } = render(<HistorySync id='old' onSnapshot={update} />);
    rerender(<HistorySync id='new' onSnapshot={update} />);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await act(async () => {
      finish?.({ ...state, id: 'old' });
    });
    expect(update).toHaveBeenCalledTimes(1);
  });
  it('shows a polling failure instead of retaining a healthy status', async () => {
    call.mockRejectedValue(new Error('Read unavailable'));
    render(<HistorySync id='import' onSnapshot={vi.fn()} />);
    fireEvent.click(screen.getByTestId('history-sync-status'));
    await screen.findByText('Error: Read unavailable');
  });
  it('shows the V3 return path and opens the bound native session without claiming V2 support', async () => {
    call.mockResolvedValue({
      ...state,
      outbound: { state: 'ready' },
      snapshot: { ...state.snapshot, source: { ...state.snapshot.source, id: 'sess_bound', agentId: 'kiro-v3' } },
    });
    render(<HistorySync id='import' onSnapshot={vi.fn()} />);
    await screen.findByText('settings.workspace.sync.active');
    fireEvent.click(screen.getByTestId('history-sync-status'));
    expect(screen.getByText('settings.workspace.sync.kiroV3Hint')).toBeInTheDocument();
    expect(screen.queryByText('settings.workspace.sync.kiroHint')).not.toBeInTheDocument();
    expect(screen.getByTestId('kiro-v3-resume-command')).toHaveTextContent('kiro-cli chat --v3 --resume-id sess_bound');
  });
});
