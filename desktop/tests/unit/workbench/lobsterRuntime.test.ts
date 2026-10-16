import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => process.cwd(), once: vi.fn() }, safeStorage: {} }));
describe('optional Lobster integration startup', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('AIONUI_WORKBENCH_MODULE', '');
  });
  it('leaves the regular AionUi desktop usable when the integration is not enabled', async () => {
    const runtime = await import('@process/services/lobster/runtime');
    await runtime.initializeLobsterRuntime();
    expect(await runtime.callLobster('state')).toEqual({ available: false, error: undefined });
  });
  it('preserves an actionable startup error without exposing a generic module loader to the renderer', async () => {
    vi.stubEnv('AIONUI_WORKBENCH_MODULE', 'relative/module.cjs');
    const runtime = await import('@process/services/lobster/runtime');
    await runtime.initializeLobsterRuntime();
    expect(await runtime.callLobster('state')).toMatchObject({
      available: false,
      error: expect.stringContaining('absolute path'),
    });
    await expect(runtime.callLobster('ssh-connect')).rejects.toThrow(/absolute path/);
  });
});
