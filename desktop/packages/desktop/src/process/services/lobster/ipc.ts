import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { app, ipcMain } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { callLobster, callWorkspace } from './runtime';
import type { LobsterAction } from '@/common/types/platform/lobster';
import type { WorkspaceAction } from '@/common/types/platform/workspace';

export const isLobsterSenderAllowed = (event: IpcMainInvokeEvent, win: BrowserWindow | null): boolean => {
  if (
    !win ||
    win.isDestroyed() ||
    event.sender !== win.webContents ||
    event.senderFrame !== win.webContents.mainFrame ||
    event.senderFrame.url !== win.webContents.getURL()
  )
    return false;
  const expected =
    process.env.ELECTRON_RENDERER_URL || pathToFileURL(path.join(app.getAppPath(), 'out/renderer/index.html')).href;
  return event.senderFrame.url.split('#')[0] === expected.split('#')[0];
};

export function registerLobsterIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('workbench:workspace', (event, action: WorkspaceAction, data: Record<string, unknown>) => {
    const win = getWindow();
    if (!win || !isLobsterSenderAllowed(event, win))
      throw new Error('Workbench access is limited to the main application window');
    return callWorkspace(action, data, win);
  });
  ipcMain.handle('workbench:lobster', (event, action: LobsterAction, data: Record<string, unknown>) => {
    if (!isLobsterSenderAllowed(event, getWindow()))
      throw new Error('Workbench access is limited to the main application window');
    return callLobster(action, data);
  });
}
