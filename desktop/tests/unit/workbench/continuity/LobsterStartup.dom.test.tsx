import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ state: null as unknown }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ pathname: '/' }) }));
vi.mock('@/common', () => ({ ipcBridge: {} }));
vi.mock('@/renderer/components/layout/Sider/SiderNav/LobsterPanel/useLobster', () => ({
  useLobster: () => ({ state: mock.state, error: '', call: vi.fn() }),
}));
vi.mock('@/renderer/components/layout/Sider/SiderNav/LobsterPanel/SyncPane', () => ({ default: () => null }));
vi.mock('@/renderer/components/layout/Sider/SiderNav/LobsterPanel/MaintenancePane', () => ({ default: () => null }));
vi.mock('@/renderer/components/layout/Sider/SiderNav/LobsterPanel/ConnectionForm', () => ({ default: () => null }));
import LobsterPanel from '@/renderer/components/layout/Sider/SiderNav/LobsterPanel';

describe('Lobster sidebar during startup', () => {
  it('keeps the application mounted when the bridge reports an unavailable status without projects', () => {
    mock.state = { available: false, error: 'Bridge is starting' };
    const { rerender } = render(<LobsterPanel collapsed={false} />);
    expect(screen.getByTestId('lobster-open')).toBeInTheDocument();
    mock.state = null;
    rerender(<LobsterPanel collapsed={false} />);
    expect(screen.queryByTestId('lobster-open')).not.toBeInTheDocument();
    mock.state = { available: false, error: 'Temporarily offline' };
    rerender(<LobsterPanel collapsed={false} />);
    expect(screen.getByTestId('lobster-open')).toBeInTheDocument();
  });
});
