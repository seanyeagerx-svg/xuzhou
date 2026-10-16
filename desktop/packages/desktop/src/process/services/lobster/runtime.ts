import { app, safeStorage, dialog } from 'electron';
import type { BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { LobsterCall } from '@/common/types/platform/lobster';
import type { WorkspaceAction, WorkspaceCall } from '@/common/types/platform/workspace';
import { createComputerNative } from '../computer';
import type { NativeInput } from '../computer/screen';

type Runtime = { call: LobsterCall; close: () => void; endpointFile: string };
type WorkbenchModule = {
  createNativeInput?: () => NativeInput;
  resolveBundledNode?: (resourcesDirectory: string) => string;
  preparePackagedRuntime?: (options: {
    directory: string;
    legacyDirectory: string;
    sessionsDirectory?: string;
    nodeCommand: string;
  }) => { legacyDirectory: string; sessionsDirectory: string; nodeCommand: string; configFile: string };
  createWorkspaceRuntime?: (options: {
    directory: string;
    legacyDirectory: string;
    window: BrowserWindow;
    backend: (route: string, method?: string, body?: unknown, allowMissing?: boolean) => Promise<unknown>;
    chooseFile: () => Promise<string | null>;
    chooseDirectory: () => Promise<string | null>;
    lobster?: Runtime;
    native?: ReturnType<typeof createComputerNative>;
  }) => { call: WorkspaceCall; close: () => Promise<void> };
  createRuntime: (options: {
    directory: string;
    legacyDirectory: string;
    safeStorage: typeof safeStorage;
    autoConnect?: boolean;
  }) => Promise<Runtime>;
};
let runtime: Runtime | undefined;
let startupError: string | undefined;
let integrationModule: WorkbenchModule | undefined;
let workspaceRuntime: ReturnType<NonNullable<WorkbenchModule['createWorkspaceRuntime']>> | undefined;
let legacyDirectory: string | undefined;

export async function initializeLobsterRuntime(): Promise<void> {
  const modulePath =
    process.env.AIONUI_WORKBENCH_MODULE ||
    (app.isPackaged
      ? path.join(process.resourcesPath, 'workbench/integrations/aionui/lobster/runtime.cjs')
      : undefined);
  if (!modulePath) return;
  try {
    if (!path.isAbsolute(modulePath)) throw new Error('Workbench module must use an absolute path');
    const requireExternal = createRequire(path.join(app.getPath('userData'), 'workbench-loader.cjs'));
    const integration = requireExternal(modulePath) as WorkbenchModule;
    integrationModule = integration;
    legacyDirectory =
      (process.env.AIONUI_E2E_TEST === '1' && process.env.XUZHOU_ISOLATED_TEST === '1') ||
      /-(?:alpha|beta|preview|rc)(?:\.|$)/i.test(app.getVersion?.() || '')
        ? path.join(app.getPath('userData'), 'legacy-workbench')
        : path.join(app.getPath('appData'), 'human-ai-workbench');
    if (app.isPackaged && integration.preparePackagedRuntime) {
      const nodeCommand = integration.resolveBundledNode?.(process.resourcesPath);
      if (!nodeCommand) throw new Error('Bundled Xuzhou Node runtime is missing');
      const prepared = integration.preparePackagedRuntime({
        directory: app.getPath('userData'),
        legacyDirectory,
        sessionsDirectory: process.env.XUZHOU_SESSIONS_DIR,
        nodeCommand,
      });
      legacyDirectory = prepared.legacyDirectory;
      process.env.XUZHOU_NODE_BIN = prepared.nodeCommand;
      process.env.XUZHOU_BRIDGE_CONFIG = prepared.configFile;
      process.env.XUZHOU_SESSIONS_DIR = prepared.sessionsDirectory;
    }
    runtime = await integration.createRuntime({
      directory: path.join(app.getPath('userData'), 'lobster'),
      legacyDirectory,
      safeStorage,
      ...(process.env.XUZHOU_ISOLATED_TEST === '1' ? { autoConnect: false } : {}),
    });
    process.env.AIONUI_WORKBENCH_ENDPOINT = runtime.endpointFile;
    app.once('before-quit', () => runtime?.close());
  } catch (error) {
    startupError = error instanceof Error ? error.message : 'Workbench integration could not start';
  }
}

export const callLobster: LobsterCall = async (action, data) => {
  if (!runtime) {
    if (action === 'state') return { available: false, error: startupError };
    throw new Error(startupError || 'Workbench integration is not enabled');
  }
  return runtime.call(action, data);
};

/** Reuse the optional local integration through the same trusted native frame. */
export async function callWorkspace(
  action: WorkspaceAction,
  data: Record<string, unknown>,
  win: BrowserWindow
): Promise<unknown> {
  if (!integrationModule?.createWorkspaceRuntime) {
    if (action === 'chat-options' && startupError) throw new Error(startupError);
    if (action === 'state' || action === 'chat-options') return { available: false };
    throw new Error(startupError || 'Workbench integration is not enabled');
  }
  if (!workspaceRuntime) {
    const choose = async (directory: boolean) => {
      const result = await dialog.showOpenDialog(win, { properties: [directory ? 'openDirectory' : 'openFile'] });
      return result.canceled ? null : result.filePaths[0] || null;
    };
    workspaceRuntime = integrationModule.createWorkspaceRuntime({
      directory: app.getPath('userData'),
      legacyDirectory: legacyDirectory || path.join(app.getPath('appData'), 'human-ai-workbench'),
      window: win,
      lobster: runtime,
      native: integrationModule.createNativeInput
        ? createComputerNative(integrationModule.createNativeInput())
        : undefined,
      chooseFile: () => choose(false),
      chooseDirectory: () => choose(true),
      backend: async (route, method = 'GET', body, allowMissing = false) => {
        const port = (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
        if (!port || !route.startsWith('/api/')) throw new Error('Local backend is not ready');
        const response = await fetch(`http://127.0.0.1:${port}${route}`, {
          method,
          headers: { 'content-type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(60000),
        });
        if (response.status === 404 && allowMissing) return null;
        const result = (await response.json()) as { success?: boolean; error?: string; data?: unknown };
        if (!response.ok || result.success === false) throw new Error(result.error || `HTTP ${response.status}`);
        return result.data;
      },
    });
    let closing = false,
      restored = false;
    win.on('close', (event) => {
      if (restored) return;
      event.preventDefault();
      if (closing) return;
      closing = true;
      void workspaceRuntime
        ?.close()
        .catch(() => {})
        .finally(() => {
          restored = true;
          if (!win.isDestroyed()) win.close();
        });
    });
  }
  return workspaceRuntime.call(action, data);
}
