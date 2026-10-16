import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NativeChats, { nativeGroups } from '@/renderer/components/layout/Sider/SiderNav/WorkspacePanel/NativeChats';
import type { NativeCodexCatalog } from '@/common/types/platform/workspace';

const { call, navigate } = vi.hoisted(() => ({ call: vi.fn(), navigate: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate, useParams: () => ({ id: 'bound' }) }));
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: vi.fn() } }));
vi.mock('@/renderer/components/layout/Sider/SiderNav/WorkspacePanel/api', () => ({
  workspaceCall: call,
  hasWorkbench: () => true,
}));
const catalog: NativeCodexCatalog = {
  projects: [{ id: 'project', name: 'My Codex project', roots: ['D:/project'] }],
  items: [
    { id: 'one', agentId: 'codex', title: 'Original chat', cwd: 'D:/project', projectId: 'project', updatedAt: 3 },
    { id: 'two', agentId: 'codex', title: 'Free chat', cwd: 'D:/project', projectId: null, updatedAt: 2 },
  ],
  bindings: { one: 'bound' },
  updatedAt: 1,
};
describe('Native Codex sidebar', () => {
  beforeEach(() => {
    call.mockReset();
    navigate.mockReset();
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { workspaceCall: call } });
    call.mockImplementation(async (action: string) =>
      action === 'state'
        ? { available: true }
        : action === 'codex-catalog'
          ? structuredClone(catalog)
          : { conversationId: 'bound' }
    );
  });
  it('lists original projects and chats without importing or generating', async () => {
    const bindings = vi.fn();
    render(<NativeChats onBindings={bindings} />);
    await screen.findByText('Original chat');
    expect(screen.getByText('My Codex project')).toBeInTheDocument();
    expect(call.mock.calls.every(([action]) => action === 'state' || action === 'codex-catalog')).toBe(true);
    await waitFor(() => expect(bindings).toHaveBeenLastCalledWith(['bound']));
  });
  it('one click navigates straight to the stable chat and repeated clicks do not duplicate a request', async () => {
    let resolve!: (value: unknown) => void;
    call.mockImplementation((action: string) =>
      action === 'state'
        ? Promise.resolve({ available: true })
        : action === 'codex-catalog'
          ? Promise.resolve(catalog)
          : new Promise((done) => {
              resolve = done;
            })
    );
    render(<NativeChats onBindings={vi.fn()} />);
    const chat = await screen.findByText('Original chat');
    fireEvent.click(chat);
    fireEvent.click(chat);
    expect(call.mock.calls.filter(([action]) => action === 'codex-open')).toHaveLength(1);
    await act(async () => {
      resolve({ conversationId: 'bound' });
    });
    expect(navigate).toHaveBeenCalledWith('/conversation/bound');
    expect(call.mock.calls.some(([action]) => action === 'history-import' || action === 'history-preview')).toBe(false);
  });
  it('keeps the catalog and shows a failed opening without navigating or clearing it', async () => {
    call.mockImplementation(async (action: string) => {
      if (action === 'state') return { available: true };
      if (action === 'codex-catalog') return catalog;
      throw Error('original folder unavailable');
    });
    render(<NativeChats onBindings={vi.fn()} />);
    fireEvent.click(await screen.findByText('Original chat'));
    await screen.findByText('Error: original folder unavailable');
    expect(screen.getByText('Original chat')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
  it('refreshes catalog on focus and finds chats across projects', async () => {
    render(<NativeChats onBindings={vi.fn()} />);
    await screen.findByText('Original chat');
    fireEvent.change(screen.getByPlaceholderText('settings.workspace.search'), { target: { value: 'Free chat' } });
    await screen.findByText('Free chat');
    expect(screen.queryByText('Original chat')).not.toBeInTheDocument();
    fireEvent.focus(window);
    await waitFor(() => expect(call.mock.calls.filter(([action]) => action === 'codex-catalog')).toHaveLength(2));
  });
  it('uses explicit native project membership and retains empty projects', () => {
    const result = nativeGroups(catalog, '', 'Free');
    expect(result.find((g) => g.id === 'project')?.items.map((i) => i.id)).toEqual(['one']);
    expect(result.find((g) => g.id === 'free')?.items.map((i) => i.id)).toEqual(['two']);
    const empty = nativeGroups({ ...catalog, items: [] }, '', 'Free');
    expect(empty[0].name).toBe('My Codex project');
  });
  it('stays absent when the optional desktop integration is unavailable', async () => {
    call.mockResolvedValue({ available: false });
    render(<NativeChats onBindings={vi.fn()} />);
    await act(async () => {});
    expect(screen.queryByTestId('native-codex-chats')).not.toBeInTheDocument();
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('state');
  });
});
