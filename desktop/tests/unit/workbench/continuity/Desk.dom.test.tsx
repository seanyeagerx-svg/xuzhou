import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ value: {} as Record<string, unknown>, perform: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/pages/conversation/runtime/Continuity/useContinuity', () => ({ useContinuity: () => mock.value }));
import Desk from '@/renderer/pages/conversation/runtime/Continuity';

describe('Conversation handoff and sync desk', () => {
  beforeEach(() => {
    mock.perform.mockReset();
    mock.value = {
      state: {
        available: true,
        activeProvider: 'codex',
        totalMessages: 12,
        routes: [{ provider: 'codex', pendingMessages: 4 }],
        handoffs: [],
        sync: {
          enabled: true,
          provider: 'kiro-v3',
          inbound: { state: 'ready' },
          outbound: { state: 'waiting', detail: 'native writer busy' },
        },
      },
      error: '',
      saving: false,
      perform: mock.perform,
    };
  });
  it('shows pending sync and exposes each direction inside the conversation', async () => {
    render(<Desk conversationId='chat' />);
    expect(screen.getByTestId('xuzhou-sync-status')).toHaveTextContent('conversation.continuity.sync.pending');
    fireEvent.click(screen.getByTestId('xuzhou-sync-status'));
    expect(await screen.findByText('native writer busy')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('xuzhou-sync-now'));
    expect(mock.perform).toHaveBeenCalledWith('chat-sync-now');
  });
  it('pauses synchronization and describes incomplete handoffs without claiming success', async () => {
    const state = mock.value.state as Record<string, unknown>;
    state.handoffs = [{ id: 'receipt', provider: 'kiro-v3', historyCount: 8, status: 'error', finishedAt: 10 }];
    render(<Desk conversationId='chat' />);
    fireEvent.click(screen.getByTestId('xuzhou-context-open'));
    expect(await screen.findByText('conversation.continuity.turnIncomplete')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch'));
    expect(mock.perform).toHaveBeenCalledWith('chat-sync-toggle', false);
  });
  it('keeps legacy conversations untouched when the continuity bridge is unavailable', () => {
    mock.value = { state: { available: false }, error: '', saving: false, perform: mock.perform };
    const { container } = render(<Desk conversationId='legacy' />);
    expect(container).toBeEmptyDOMElement();
  });
  it('surfaces a sync conflict without enabling a hidden overwrite operation', async () => {
    mock.value.error = 'source changed';
    render(<Desk conversationId='chat' />);
    expect(screen.getByTestId('xuzhou-sync-status')).toHaveTextContent('conversation.continuity.sync.attention');
    fireEvent.click(screen.getByTestId('xuzhou-sync-status'));
    expect(await screen.findByText('source changed')).toBeInTheDocument();
    expect(mock.perform).not.toHaveBeenCalled();
  });
  it('never reports local-save success when the initial metadata request failed', () => {
    mock.value = { state: undefined, error: 'offline', saving: false, perform: mock.perform };
    render(<Desk conversationId='chat' />);
    expect(screen.getByTestId('xuzhou-sync-status')).toHaveTextContent('conversation.continuity.sync.attention');
  });
});
