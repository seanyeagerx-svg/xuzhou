import { describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/electron/main';
import type { BrowserWindow } from 'electron';
import { DIAGNOSTICS_UPLOAD_ENABLED } from '@/common/config/privacy';
import { initSentry, scheduleStartupLogReport, setSentryDeviceId } from '@/sentry';
import { submitFeedbackReport } from '@/renderer/services/feedback/submitFeedbackReport';

vi.mock('@sentry/electron/main', () => ({ init: vi.fn(), setUser: vi.fn(), setTag: vi.fn() }));
vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw Error('must not access a profile');
    },
    getVersion: () => 'test',
    isPackaged: true,
  },
}));
vi.mock('@/process/utils/analyticsId', () => ({
  getOrCreateAnalyticsId: () => {
    throw Error('must not create an identifier');
  },
}));
describe('Xuzhou public privacy policy', () => {
  it('does not initialize telemetry or create an installation identifier', () => {
    initSentry();
    setSentryDeviceId();
    expect(DIAGNOSTICS_UPLOAD_ENABLED).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.setUser).not.toHaveBeenCalled();
  });
  it('does not schedule startup log collection', () => {
    vi.useFakeTimers();
    try {
      scheduleStartupLogReport({} as BrowserWindow);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it('refuses feedback before reading any input or collecting attachments', async () => {
    const input = new Proxy(
      {},
      {
        get() {
          throw Error('must not collect input');
        },
      }
    ) as Parameters<typeof submitFeedbackReport>[0];
    await expect(submitFeedbackReport(input)).rejects.toThrow('XUZHOU_DIAGNOSTICS_UPLOAD_DISABLED');
  });
});
