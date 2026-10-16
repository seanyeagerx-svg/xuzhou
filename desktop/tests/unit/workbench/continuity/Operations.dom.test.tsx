import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/renderer/components/layout/Sider/SiderNav/WorkspacePanel/api', () => ({ workspaceCall: mock.call }));
vi.mock('@/renderer/components/layout/Sider/SiderNav/LobsterPanel', () => ({ default: () => null }));
import Console from '@/renderer/pages/settings/components/SettingsSider/Console';
describe('Xuzhou control center', () => {
  beforeEach(() => {
    mock.call.mockReset();
  });
  it('keeps backup writes unavailable when the external drive and memory-only key are absent', async () => {
    mock.call.mockResolvedValue({
      backup: { config: {}, status: { state: 'disabled' }, volumes: [], keyLoaded: false },
      updates: { config: {}, status: { state: 'not-configured' } },
    });
    render(<Console />);
    await waitFor(() => expect(mock.call).toHaveBeenCalledWith('operations-state'));
    expect(await screen.findByText('settings.xuzhou.noDisk')).toBeInTheDocument();
    expect(screen.getByText('settings.xuzhou.betaScope')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'settings.xuzhou.run' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'settings.xuzhou.check' })).toBeDisabled();
  });
  it('shows bridge failure without inventing backup or update success', async () => {
    mock.call.mockRejectedValue(new Error('Bridge unavailable'));
    render(<Console />);
    expect(await screen.findByText('Bridge unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'settings.xuzhou.run' })).toBeDisabled();
  });
});
