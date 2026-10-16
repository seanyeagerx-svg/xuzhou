import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistorySnapshot, HistorySource, HistoryUpdatePreview } from '@/common/types/platform/workspace';

const call = vi.hoisted(() => vi.fn());
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/components/layout/Sider/SiderNav/WorkspacePanel/api', () => ({ workspaceCall: call }));
vi.mock('@/renderer/components/layout/Sider/SiderNav/WorkspacePanel/HistorySync', () => ({ default: () => null }));
vi.mock('@/renderer/components/layout/Sider/SiderNav/WorkspacePanel/HistoryBrowser', () => ({
  HistoryMessages: ({ source }: { source: HistorySource }) => (
    <div>
      {source.messages.map((m) => (
        <pre key={m.id}>{m.text}</pre>
      ))}
    </div>
  ),
}));
import ImportedHistory from '@/renderer/components/layout/Sider/SiderNav/WorkspacePanel/ImportedHistory';

const source: HistorySource = {
  id: 'native',
  agentId: 'codex',
  title: 'Original',
  cwd: 'D:/project',
  updatedAt: 1,
  messages: [{ id: 'old', role: 'user', text: 'Old record' }],
};
const snapshot: HistorySnapshot = { id: 'import', cwd: source.cwd, source, createdAt: 1, revision: 0 };
const added = [{ id: 'new', role: 'user', text: 'New source record' }];
const preview: HistoryUpdatePreview = {
  token: 'reviewed-token',
  importId: 'import',
  source: { ...source, messages: [...source.messages, ...added] },
  createdAt: 2,
  revision: 0,
  added,
};

describe('Imported history updates', () => {
  beforeEach(() => {
    call.mockReset();
    call.mockImplementation(async (action: string) => {
      if (action === 'history-snapshot') return snapshot;
      if (action === 'history-check-updates') return preview;
      if (action === 'history-accept-updates')
        return { snapshot: { ...snapshot, source: preview.source, revision: 1 }, added: 1, existing: false };
      throw new Error('Unexpected action');
    });
  });
  it('does not describe a fresh empty source as imported history', async () => {
    call.mockResolvedValue({ ...snapshot, source: { ...source, agentId: 'kiro-v3', messages: [] } });
    render(<ImportedHistory id='new-chat' />);
    await act(async () => {});
    expect(call).toHaveBeenCalledWith('history-snapshot', { id: 'new-chat' });
    expect(screen.queryByTestId('imported-history')).not.toBeInTheDocument();
  });
  it('shows only new records before the user brings them into the current chat', async () => {
    render(<ImportedHistory id='import' />);
    await waitFor(() => expect(screen.getByTestId('imported-history')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('imported-history'));
    fireEvent.click(await screen.findByTestId('history-update-check'));
    await screen.findByText('New source record');
    expect(screen.queryByText('Old record')).not.toBeInTheDocument();
    expect(call.mock.calls.some(([action]) => action === 'history-accept-updates')).toBe(false);
    fireEvent.click(screen.getByTestId('history-update-accept'));
    await screen.findByText('settings.workspace.updatesSaved');
    expect(call).toHaveBeenCalledWith('history-accept-updates', { token: 'reviewed-token' });
  });
  it('keeps imported history accessible when checking the original fails', async () => {
    call.mockImplementation(async (action: string) => {
      if (action === 'history-snapshot') return snapshot;
      throw new Error('Original unavailable');
    });
    render(<ImportedHistory id='import' />);
    await waitFor(() => expect(screen.getByTestId('imported-history')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('imported-history'));
    fireEvent.click(await screen.findByTestId('history-update-check'));
    await screen.findByText('Error: Original unavailable');
    expect(screen.getByText('Old record')).toBeInTheDocument();
    expect(screen.queryByTestId('history-update-accept')).not.toBeInTheDocument();
  });
  it('discards a delayed update preview after switching conversations', async () => {
    let finish: ((value: HistoryUpdatePreview) => void) | undefined;
    call.mockImplementation(async (action: string) =>
      action === 'history-snapshot'
        ? snapshot
        : new Promise<HistoryUpdatePreview>((resolve) => {
            finish = resolve;
          })
    );
    const { rerender } = render(<ImportedHistory id='import' />);
    await waitFor(() => expect(screen.getByTestId('imported-history')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('imported-history'));
    fireEvent.click(await screen.findByTestId('history-update-check'));
    rerender(<ImportedHistory id='other-import' />);
    await act(async () => {
      if (!finish) throw new Error('The preview request did not start');
      finish(preview);
    });
    await waitFor(() => expect(screen.getByTestId('imported-history')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('imported-history'));
    expect(screen.queryByText('New source record')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-update-accept')).not.toBeInTheDocument();
  });
});
