import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const channel = () => ({ provider: vi.fn(), emit: vi.fn() });
  return {
    ipc: {
      update: {
        consumeInstallerLastFailure: channel(),
        check: channel(),
        download: channel(),
        cancelDownload: channel(),
        downloadProgress: channel(),
      },
      autoUpdate: {
        check: channel(),
        download: channel(),
        cancelDownload: channel(),
        restoreDownloaded: channel(),
        quitAndInstall: channel(),
        status: channel(),
      },
    },
    updater: { checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall: vi.fn() },
  };
});
vi.mock('@/common', () => ({ ipcBridge: mocks.ipc }));
vi.mock('@/common/utils', () => ({ uuid: vi.fn() }));
vi.mock('electron', () => ({ app: { getVersion: () => '2.2.2' } }));
vi.mock('electron-log', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('@/process/services/autoUpdaterService', () => ({ autoUpdaterService: mocks.updater }));
vi.mock('@/process/services/installerLastFailure', () => ({ consumeInstallerLastFailure: vi.fn() }));
vi.mock('@/process/services/i18n', () => ({ default: { t: (key: string) => key } }));
import { initUpdateBridge } from '@/process/bridge/updateBridge';

describe('Xuzhou upstream update protection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  it('blocks checks, downloads and installation even when IPC is invoked directly', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    initUpdateBridge();
    for (const ch of [
      mocks.ipc.update.check,
      mocks.ipc.update.download,
      mocks.ipc.autoUpdate.check,
      mocks.ipc.autoUpdate.download,
    ]) {
      expect(await ch.provider.mock.calls[0][0]({ url: 'https://example.com/update.exe' })).toMatchObject({
        success: false,
      });
    }
    expect(await mocks.ipc.autoUpdate.restoreDownloaded.provider.mock.calls[0][0]()).toEqual({
      success: true,
      data: { ready: false },
    });
    await expect(mocks.ipc.autoUpdate.quitAndInstall.provider.mock.calls[0][0]()).rejects.toThrow(
      'settings.brand.updates'
    );
    expect(fetch).not.toHaveBeenCalled();
    for (const fn of Object.values(mocks.updater)) expect(fn).not.toHaveBeenCalled();
  });
});
