// Modified for Xuzhou (续舟), 2026-10-15; see public/branding/MODIFICATIONS.md.
import path from 'path';
import fs from 'fs';
import { PRODUCT_NAME } from '../config/constants';
import type { IPlatformServices } from './IPlatformServices';
import { NodePlatformServices } from './NodePlatformServices';

let _services: IPlatformServices | null = null;

/** Pin the historical profile before applying the display name, regardless of module load order. */
export function initializeProductIdentity(
  app: Pick<import('electron').App, 'isPackaged' | 'getPath' | 'setPath' | 'setName'> &
    Partial<Pick<import('electron').App, 'getVersion'>>
): void {
  // Prereleases never inherit the stable profile pointer or touch its history.
  const prerelease = /-(?:alpha|beta|preview|rc)(?:\.|$)/i.test(app.getVersion?.() || '');
  const explicitProfile =
    process.env.XUZHOU_PROFILE_DIR ||
    (process.env.AIONUI_E2E_TEST === '1' ? process.env.AIONUI_E2E_USER_DATA_DIR : undefined);
  let linkedProfile: string | undefined;
  if (app.isPackaged && !explicitProfile?.trim()) {
    const pointer = path.join(app.getPath('appData'), prerelease ? 'XuzhouBeta' : 'Xuzhou', 'profile-location.json');
    if (fs.existsSync(pointer)) {
      const saved = JSON.parse(fs.readFileSync(pointer, 'utf8')) as {
        version?: number;
        profileDirectory?: string;
        sessionsDirectory?: string;
      };
      if (
        saved.version !== 1 ||
        !saved.profileDirectory ||
        !path.isAbsolute(saved.profileDirectory) ||
        !fs.existsSync(path.join(saved.profileDirectory, 'aionui/aionui-backend.db')) ||
        !saved.sessionsDirectory ||
        !path.isAbsolute(saved.sessionsDirectory) ||
        !fs.existsSync(saved.sessionsDirectory)
      ) {
        throw new Error('Xuzhou profile link is invalid; existing data has not been moved');
      }
      linkedProfile = saved.profileDirectory;
      process.env.XUZHOU_SESSIONS_DIR ||= saved.sessionsDirectory;
    }
  }
  const dataDir =
    explicitProfile?.trim() ||
    linkedProfile ||
    path.join(app.getPath('appData'), app.isPackaged ? (prerelease ? 'XuzhouBeta' : 'AionUi') : getDevAppName());
  fs.mkdirSync(dataDir, { recursive: true });
  app.setPath('userData', dataDir);
  app.setName(prerelease ? `${PRODUCT_NAME} Beta` : PRODUCT_NAME);
}

/**
 * Resolve the dev-mode app name for environment isolation.
 * Centralised so that every call-site stays in sync.
 */
export function getDevAppName(): string {
  const isMultiInstance = process.env.AIONUI_MULTI_INSTANCE === '1';
  return isMultiInstance ? 'AionUi-Dev-2' : 'AionUi-Dev';
}

export function registerPlatformServices(services: IPlatformServices): void {
  _services = services;
}

export function getPlatformServices(): IPlatformServices {
  if (!_services) {
    // In Electron, module-level code in initStorage.ts may execute before the
    // explicit registerPlatformServices(new ElectronPlatformServices()) call
    // because Rollup places the shared chunk require() ahead of side-effect
    // imports in the bundled output. Auto-register an inline implementation using
    // electron.app directly so that all platform API callers work regardless of
    // call order. This will be replaced by the proper ElectronPlatformServices
    // once registerPlatformServices() is called.
    if (process.versions?.electron) {
      // In Electron utility processes process.type === 'utility' and app is not
      // accessible. Fall back to NodePlatformServices (DATA_DIR is injected by
      // ElectronPlatformServices.fork so paths still resolve correctly).
      const processType = (process as NodeJS.Process & { type?: string }).type;
      if (processType !== 'browser') {
        _services = new NodePlatformServices();
      } else {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { app, net } = require('electron') as typeof import('electron');
        // Dev isolation: set app name before any getPath('userData') call.
        // Rollup may load this chunk before configureChromium.ts runs, so we
        // must apply the dev name here as a safety net.
        initializeProductIdentity(app);
        // Typed as IPlatformPaths so tsc enforces completeness: any new method
        // added to the interface will cause a compile error here if omitted below.
        const paths: import('./IPlatformServices').IPlatformPaths = {
          getDataDir: () => app.getPath('userData'),
          getTempDir: () => app.getPath('temp'),
          getHomeDir: () => app.getPath('home'),
          getLogsDir: () => {
            try {
              return app.getPath('logs');
            } catch {
              return path.join(app.getPath('userData'), 'logs');
            }
          },
          getAppPath: () => app.getAppPath(),
          isPackaged: () => app.isPackaged,
          getSystemPath: (name) => app.getPath(name),
          getName: () => app.getName(),
          getVersion: () => app.getVersion(),
          needsCliSafeSymlinks: () => process.platform === 'darwin',
        };
        _services = {
          paths,
          worker: {
            fork: () => {
              throw new Error('[Platform] Worker not available before registerPlatformServices()');
            },
          },
          power: { preventSleep: () => null, allowSleep: () => {}, preventDisplaySleep: () => null },
          notification: { send: () => {} },
          network: {
            fetch: (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
              net.fetch(input instanceof URL ? input.toString() : input, init),
          },
        };
      }
    } else {
      throw new Error(
        '[Platform] Services not registered. Call registerPlatformServices() before using platform APIs.'
      );
    }
  }
  return _services;
}

export type {
  IPlatformServices,
  IPlatformPaths,
  IWorkerProcess,
  IWorkerProcessFactory,
  IPowerManager,
  INotificationService,
  INetworkService,
} from './IPlatformServices';
