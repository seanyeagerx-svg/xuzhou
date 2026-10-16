import { app } from 'electron';
import path from 'node:path';
import { startWebHost } from '@aionui/web-host';
import { ComputerScreen, type NativeInput } from './screen';

/** Reuses Electron capture and the existing WebUI static/backend bridge behind paired-device authentication. */
export function createComputerNative(input: NativeInput) {
  return {
    screen: new ComputerScreen(input),
    startStatic: async () => {
      const port = (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
      if (!port) throw new Error('XUZHOU_DEVICE_BACKEND_UNAVAILABLE');
      return startWebHost({
        app: {
          version: app.getVersion(),
          isPackaged: app.isPackaged,
          resourcesPath: app.getAppPath(),
          userDataPath: app.getPath('userData'),
        },
        staticDir: path.join(app.getAppPath(), 'out/renderer'),
        backend: { kind: 'useExistingBackend', port },
        port: 0,
        allowRemote: false,
      });
    },
  };
}
