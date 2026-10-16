import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import LobsterCompanion from '@/renderer/components/layout/Sider/SiderNav/LobsterPanel/Companion';
const state = (id: string) => ({
  available: true,
  ready: true,
  conversationId: id,
  title: `Chat ${id}`,
  gatewayConnected: true,
  sourceCount: 2,
  entry: { mode: 'off', status: 'idle', intervalMinutes: 5, notes: [] },
});
describe('Lobster beside a unified chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { workspaceCall: mocks.call } });
    mocks.call.mockImplementation(async (_action, data) => state(data.conversationId));
  });
  it('stays idle until asked and sends only a chat identity when summarizing', async () => {
    render(<LobsterCompanion conversationId='one' />);
    fireEvent.click(await screen.findByTestId('companion-open'));
    expect(mocks.call.mock.calls.map(([action]) => action)).toEqual(['companion-state']);
    fireEvent.click(screen.getByTestId('companion-summary'));
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith('companion-request', { conversationId: 'one', kind: 'summary' })
    );
  });
  it('ignores late summaries from the previous chat and keeps the new chat isolated', async () => {
    let resolveOld: (value: unknown) => void = () => {};
    mocks.call.mockImplementation((action, data) =>
      action === 'companion-request'
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve(state(data.conversationId))
    );
    const view = render(<LobsterCompanion conversationId='one' />);
    fireEvent.click(await screen.findByTestId('companion-open'));
    fireEvent.click(screen.getByTestId('companion-summary'));
    view.rerender(<LobsterCompanion conversationId='two' />);
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith('companion-state', { conversationId: 'two' }));
    await act(async () => {
      resolveOld({ ...state('one'), title: 'STALE CHAT' });
    });
    fireEvent.click(screen.getByTestId('companion-open'));
    expect(await screen.findByText('Chat two')).toBeTruthy();
    expect(screen.queryByText('STALE CHAT')).toBeNull();
  });
  it('shows connection failures without claiming a note was created', async () => {
    mocks.call.mockImplementation(async (action, data) => {
      if (action === 'companion-request') throw new Error('Connection unavailable');
      return state(data.conversationId);
    });
    render(<LobsterCompanion conversationId='one' />);
    fireEvent.click(await screen.findByTestId('companion-open'));
    fireEvent.click(screen.getByTestId('companion-summary'));
    expect(await screen.findByText('Connection unavailable')).toBeTruthy();
    expect(screen.queryByText('settings.companion.summary')).toBeNull();
  });
});
