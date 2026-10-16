import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Phone from '@/renderer/pages/conversation/Computers/Phone';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const call = vi.fn();
function controls(id = 'chat-one') {
  return {
    call,
    busy: '',
    state: { conversationId: id, mobile: { running: false, devices: [] } },
  } as unknown as React.ComponentProps<typeof Phone>['controls'];
}
beforeEach(() => {
  call.mockReset();
  call.mockResolvedValue({ url: 'http://100.64.0.1:1234/#pair=example', expiresAt: Date.now() + 120000 });
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { workspaceCall: vi.fn() } });
});
afterEach(() => cleanup());
describe('phone owner consent', () => {
  it('requires a deliberate unchecked permission grant before generating a ticket', async () => {
    render(<Phone controls={controls()} />);
    const button = screen.getByRole('button', { name: 'conversation.computers.createPair' });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(button);
    await waitFor(() => expect(call).toHaveBeenCalledWith('computer-pair', { ownerConsent: true }));
    await waitFor(() => expect(button).toBeDisabled());
  });
  it('clears consent when changing chats and describes the full owner scope', () => {
    const view = render(<Phone controls={controls()} />);
    expect(screen.getByText('conversation.computers.phoneOwnerScope')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    view.rerender(<Phone controls={controls('chat-two')} />);
    expect(screen.getByRole('button', { name: 'conversation.computers.createPair' })).toBeDisabled();
  });
});
