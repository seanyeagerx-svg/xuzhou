import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ call: vi.fn(), navigate: vi.fn(), emit: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: mocks.emit } }));
vi.mock('@/renderer/components/layout/Sider/SiderNav/WorkspacePanel/api', () => ({ workspaceCall: mocks.call }));
import HistoryBrowser from '@/renderer/components/layout/Sider/SiderNav/WorkspacePanel/HistoryBrowser';
describe('Import existing conversations', () => {
  beforeEach(() => vi.clearAllMocks());
  it('keeps old-history import available without a second new-chat entry', async () => {
    let attempts = 0;
    mocks.call.mockImplementation(async (action: string) => {
      if (action === 'history-list')
        return {
          items: [{ id: 'old-chat', title: 'Existing chat', cwd: 'D:/project', updatedAt: 1 }],
          nextCursor: null,
        };
      if (action === 'history-preview')
        return {
          token: 'preview-token',
          source: { id: 'old-chat', title: 'Existing chat', cwd: 'D:/project', messages: [] },
        };
      if (action === 'history-import') {
        if (++attempts === 1) throw new Error('Reply lost');
        return { conversationId: 'same-chat' };
      }
      throw new Error('Unexpected action');
    });
    const close = vi.fn();
    render(<HistoryBrowser onClose={close} />);
    expect(screen.queryByTestId('history-create-v3')).toBeNull();
    fireEvent.click(await screen.findByText('Existing chat'));
    fireEvent.click(await screen.findByTestId('history-import'));
    await screen.findByText('Error: Reply lost');
    expect(mocks.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('history-import'));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    const creates = mocks.call.mock.calls.filter(([action]) => action === 'history-import');
    expect(creates[0][1]).toEqual({ token: 'preview-token', cwd: 'D:/project' });
    expect(creates[0][1]).toEqual(creates[1][1]);
    expect(mocks.navigate).toHaveBeenCalledWith('/conversation/same-chat');
  });
  it('opening the old-history browser does not create a chat or ask for a project', async () => {
    mocks.call.mockResolvedValue({ items: [], nextCursor: null });
    render(<HistoryBrowser onClose={vi.fn()} />);
    await screen.findByText('settings.workspace.noHistory');
    expect(mocks.call.mock.calls.map(([action]) => action)).toEqual(['history-list']);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
