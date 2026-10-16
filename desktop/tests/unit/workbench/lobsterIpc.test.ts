import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const mocks = vi.hoisted(() => ({ handle: vi.fn(), call: vi.fn(), workspace: vi.fn() }));
vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() }, ipcMain: { handle: mocks.handle } }));
vi.mock('@process/services/lobster/runtime', () => ({ callLobster: mocks.call, callWorkspace: mocks.workspace }));
import { isLobsterSenderAllowed, registerLobsterIpc } from '@process/services/lobster/ipc';

const fixture = (
  url = pathToFileURL(path.join(process.cwd(), 'out/renderer/index.html')).href + '#/conversation/test'
) => {
  const mainFrame = { url },
    webContents = { mainFrame, getURL: () => url };
  return {
    win: { isDestroyed: () => false, webContents } as unknown as BrowserWindow,
    event: { sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent,
  };
};
describe('Lobster native window boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ELECTRON_RENDERER_URL', '');
  });
  it('accepts the local main frame, including a conversation hash', () => {
    const f = fixture();
    expect(isLobsterSenderAllowed(f.event, f.win)).toBe(true);
  });
  it('rejects a remote document even if it navigated the main window', () => {
    const f = fixture('https://external.example/');
    expect(isLobsterSenderAllowed(f.event, f.win)).toBe(false);
  });
  it('rejects child frames and other windows', () => {
    const f = fixture();
    expect(
      isLobsterSenderAllowed({ ...f.event, senderFrame: { url: f.event.senderFrame.url } } as IpcMainInvokeEvent, f.win)
    ).toBe(false);
    expect(isLobsterSenderAllowed(f.event, fixture().win)).toBe(false);
  });
  it('does not forward denied requests to the credential-bearing runtime', () => {
    const f = fixture('https://external.example/');
    registerLobsterIpc(() => f.win);
    const handler = mocks.handle.mock.calls.find((row) => row[0] === 'workbench:lobster')![1] as (
      event: IpcMainInvokeEvent,
      action: string
    ) => unknown;
    expect(() => handler(f.event, 'ssh-connect')).toThrow(/main application window/);
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it.each([
    'history-import',
    'history-create-v3',
    'chat-create',
    'history-check-updates',
    'history-accept-updates',
    'history-sync-state',
    'history-sync-toggle',
  ])('rejects %s from a remote frame', (action) => {
    const f = fixture('https://external.example/');
    registerLobsterIpc(() => f.win);
    const handler = mocks.handle.mock.calls.find((row) => row[0] === 'workbench:workspace')![1] as (
      event: IpcMainInvokeEvent,
      action: string
    ) => unknown;
    expect(() => handler(f.event, action)).toThrow(/main application window/);
    expect(mocks.workspace).not.toHaveBeenCalled();
  });
});
