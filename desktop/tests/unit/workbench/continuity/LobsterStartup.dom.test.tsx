import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ state: null as unknown, path: '/', getTeam: vi.fn(), getChat: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ pathname: mock.path }) }));
vi.mock('@/common', () => ({
  ipcBridge: { team: { get: { invoke: mock.getTeam } }, conversation: { get: { invoke: mock.getChat } } },
}));
vi.mock('@/renderer/components/layout/Sider/SiderNav/LobsterPanel/useLobster', () => ({
  useLobster: () => ({ state: mock.state, error: '', call: vi.fn() }),
}));
vi.mock('@/renderer/components/layout/Sider/SiderNav/LobsterPanel/SyncPane', () => ({ default: () => null }));
vi.mock('@/renderer/components/layout/Sider/SiderNav/LobsterPanel/MaintenancePane', () => ({ default: () => null }));
vi.mock('@/renderer/components/layout/Sider/SiderNav/LobsterPanel/ConnectionForm', () => ({ default: () => null }));
vi.mock('@/renderer/components/layout/Sider/SiderNav/LobsterPanel/Companion', () => ({ default: () => null }));
import LobsterPanel from '@/renderer/components/layout/Sider/SiderNav/LobsterPanel';
import {
  activityRows,
  activityStatusKey,
} from '@/renderer/components/layout/Sider/SiderNav/LobsterPanel/Activity/rows';
import type { LobsterState } from '@/common/types/platform/lobster';

const fixture = (): LobsterState => ({
  available: true,
  importedAt: 0,
  projects: [
    { id: 'one', name: 'One', root: 'F:\\one' },
    { id: 'two', name: 'Two', root: 'F:\\two' },
  ],
  gateway: { url: 'local', state: 'disconnected', detail: '' },
  maintenance: {
    state: 'disconnected',
    detail: '',
    ready: false,
    generation: 0,
    profile: { host: '', username: '', port: 22, httpPort: 0, scope: 'user', keyFile: '' },
  },
  sync: { enabled: true, counts: { pending: 0, delivered: 0 }, projects: {}, items: [], batches: [] },
  jobs: [],
  tasks: [],
  conversations: [],
  approvals: [],
});

describe('Lobster sidebar during startup', () => {
  beforeEach(() => {
    localStorage.clear();
    mock.path = '/';
    vi.clearAllMocks();
  });
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
  it('opens the animated pet functions and follows the active team project instead of a previous selection', async () => {
    mock.path = '/team/current';
    mock.state = fixture();
    localStorage.setItem('workbench:lobster-project', 'one');
    mock.getTeam.mockResolvedValue({ workspace: 'F:\\two', assistants: [{ role: 'leader', conversation_id: 'lead' }] });
    render(<LobsterPanel collapsed={false} />);
    await waitFor(() => expect(localStorage.getItem('workbench:lobster-project')).toBe('two'));
    fireEvent.click(screen.getByTestId('lobster-pet-open'));
    expect(await screen.findByTestId('lobster-pet-menu')).toBeVisible();
    fireEvent.click(screen.getByTestId('lobster-pet-activity'));
    expect(await screen.findByTestId('lobster-activity')).toBeVisible();
    fireEvent.click(screen.getByTestId('lobster-pet-open'));
    await waitFor(() => expect(localStorage.getItem('workbench:lobster-open')).toBe('false'));
    expect(await screen.findByTestId('lobster-pet-menu')).toBeVisible();
  });
  it('never keeps the previous project selected when resolving the new team fails', async () => {
    mock.path = '/team/missing';
    mock.state = fixture();
    localStorage.setItem('workbench:lobster-project', 'one');
    mock.getTeam.mockRejectedValue(Error('not found'));
    render(<LobsterPanel collapsed={false} />);
    await waitFor(() => expect(localStorage.getItem('workbench:lobster-project')).toBe(''));
    expect(screen.getByTestId('lobster-pet-open')).toBeVisible();
  });
  it('separates queueing, receipts, tool completion and other project activity', () => {
    const state = fixture();
    state.sync.items = [
      {
        id: 'r1',
        projectId: 'two',
        agentName: 'Codex',
        label: 'Progress',
        phase: 'progress',
        state: 'pending',
        createdAt: 1792000000000,
        text: 'REPORT_CONTENT',
      },
      {
        id: 'r2',
        projectId: 'one',
        agentName: 'Kiro',
        label: 'PRIVATE_OTHER',
        phase: 'progress',
        state: 'delivered',
        createdAt: 1792000000001,
      },
    ];
    state.conversations = [
      {
        id: 'inbox',
        projectId: 'two',
        gateway: 'local',
        title: '',
        status: 'idle',
        messages: [
          { id: 'reply', role: 'assistant', text: 'LOBSTER_REPLY', status: 'completed', createdAt: 1792000000002 },
        ],
      },
    ];
    state.activities = [
      {
        id: 'a1',
        projectId: 'two',
        conversationId: 'c',
        agentId: 'openclaw',
        time: 1792000000003,
        title: 'read',
        status: 'completed',
        output: 'TOOL_RESULT',
      },
    ];
    const rows = activityRows(state, 'two');
    expect(rows.map((row) => row.text)).toEqual(['TOOL_RESULT', 'LOBSTER_REPLY', 'REPORT_CONTENT']);
    expect(activityStatusKey(rows[0])).toBe('activityToolDone');
    expect(activityStatusKey(rows[2])).toBe('queued');
  });
});
