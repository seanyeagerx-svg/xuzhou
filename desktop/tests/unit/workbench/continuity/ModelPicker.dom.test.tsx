import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  set: vi.fn(),
  catalog: vi.fn(),
  runtime: { activeTurnId: null as string | null },
  info: {} as Record<string, unknown>,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/components/layout/Sider/SiderNav/WorkspacePanel/api', () => ({
  workspaceCall: (...args: unknown[]) => mocks.catalog(...args),
}));
vi.mock('@/renderer/hooks/agent/useAcpModelInfo', () => ({ useAcpModelInfo: () => mocks.info }));
vi.mock('@/renderer/pages/conversation/runtime/useConversationRuntimeView', () => ({
  useConversationRuntimeView: () => mocks.runtime,
}));
import ModelPicker from '@/renderer/pages/conversation/runtime/Continuity/ModelPicker';
import DraftModelPicker from '@/renderer/pages/conversation/runtime/Continuity/DraftModelPicker';

describe('New conversation model selection', () => {
  beforeEach(() => mocks.catalog.mockReset());
  it('loads real choices on click before a conversation exists and retains a working provider if another fails', async () => {
    mocks.catalog.mockResolvedValue({
      models: [{ id: 'codex/real', label: 'Native Codex model', efforts: [] }],
      errors: [{ provider: 'kiro-v3', message: 'Sign-in required' }],
    });
    const select = vi.fn();
    render(<DraftModelPicker value={null} onChange={select} />);
    fireEvent.click(screen.getByTestId('guid-model-selector'));
    fireEvent.click(await screen.findByText('Native Codex model'));
    expect(select).toHaveBeenCalledWith('codex/real');
  });
  it('shows a discovery failure and lets the user retry instead of leaving a dead default button', async () => {
    mocks.catalog.mockRejectedValue(Error('native discovery failed'));
    render(<DraftModelPicker value={null} onChange={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('guid-model-selector'));
    });
    expect(await screen.findByText(/native discovery failed/)).toBeVisible();
    mocks.catalog.mockResolvedValue({ models: [], errors: [] });
    await act(async () => {
      fireEvent.click(screen.getByText('common.refresh'));
    });
    await waitFor(() => expect(mocks.catalog).toHaveBeenCalledTimes(2));
  });
});

describe('Xuzhou unified model chooser', () => {
  it('revokes the current chat tool memory through the existing confirmed config port', async () => {
    mocks.info.toolPermissions = 'remembered';
    mocks.set.mockResolvedValue([]);
    render(<ModelPicker conversationId='chat' />);
    fireEvent.click(screen.getByTestId('xuzhou-permissions-reset'));
    await waitFor(() => expect(mocks.set).toHaveBeenCalledWith('tool_permissions', 'ask'));
  });
  it('opens the chooser while native model discovery is still running', () => {
    mocks.info = { ...mocks.info, model_info: null, isLoading: true };
    render(<ModelPicker conversationId='chat' />);
    fireEvent.click(screen.getByTestId('xuzhou-model-picker'));
    expect(screen.getByText('conversation.continuity.discovering')).toBeInTheDocument();
  });
  beforeEach(() => {
    mocks.set.mockReset();
    mocks.runtime.activeTurnId = null;
    mocks.info = {
      model_info: {
        current_model_id: 'codex/one',
        available_models: [
          { id: 'codex/one', label: 'Codex standard' },
          { id: 'kiro-v3/fast', label: 'Kiro fast' },
          { id: 'zcode/chat', label: 'ZCode chat' },
        ],
      },
      thoughtLevel: null,
      isLoading: false,
      isRuntimeReady: true,
      setStatus: { state: 'idle' },
      isConfigOptionBlocked: () => false,
      canSwitch: true,
      setConfigOption: mocks.set,
    };
  });
  it('shows grouped software choices in one searchable conversation picker', async () => {
    render(<ModelPicker conversationId='chat' />);
    fireEvent.click(screen.getByTestId('xuzhou-model-picker'));
    expect(await screen.findByText('Kiro V3')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('conversation.continuity.searchModels'), { target: { value: 'ZCode' } });
    expect(screen.queryByText('Kiro fast')).not.toBeInTheDocument();
    expect(screen.getByText('ZCode chat')).toBeInTheDocument();
  });
  it('waits for the native acknowledgement before closing the choice dialog', async () => {
    let finish: ((value: unknown[]) => void) | undefined;
    mocks.set.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    render(<ModelPicker conversationId='chat' />);
    fireEvent.click(screen.getByTestId('xuzhou-model-picker'));
    fireEvent.click(await screen.findByRole('button', { name: 'Kiro fast' }));
    expect(mocks.set).toHaveBeenCalledWith('model', 'kiro-v3/fast');
    expect(screen.getByTestId('xuzhou-model-options')).toBeVisible();
    await act(async () => finish?.([]));
    await waitFor(() => expect(screen.getByTestId('xuzhou-model-options')).not.toBeVisible());
  });
  it('keeps the current model and dialog after a rejected switch', async () => {
    mocks.set.mockRejectedValue(Error('account unavailable'));
    render(<ModelPicker conversationId='chat' />);
    fireEvent.click(screen.getByTestId('xuzhou-model-picker'));
    fireEvent.click(await screen.findByRole('button', { name: 'Kiro fast' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Kiro fast' })).not.toBeDisabled());
    expect(screen.getByTestId('xuzhou-model-picker')).toHaveTextContent('Codex standard');
  });
  it('blocks model changes during a running reply and reports provider-managed reasoning', async () => {
    mocks.runtime.activeTurnId = 'active';
    render(<ModelPicker conversationId='chat' />);
    fireEvent.click(screen.getByTestId('xuzhou-model-picker'));
    expect(await screen.findByRole('button', { name: 'Kiro fast' })).toBeDisabled();
    expect(screen.getByText('conversation.continuity.providerManaged')).toBeInTheDocument();
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
