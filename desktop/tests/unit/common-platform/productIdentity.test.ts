import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeProductIdentity } from '@/common/platform';
describe('Xuzhou profile compatibility', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'xuzhou-profile-'));
    for (const key of [
      'XUZHOU_PROFILE_DIR',
      'XUZHOU_SESSIONS_DIR',
      'AIONUI_E2E_TEST',
      'AIONUI_E2E_USER_DATA_DIR',
      'AIONUI_MULTI_INSTANCE',
    ])
      vi.stubEnv(key, '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });
  function app(isPackaged = false) {
    return { isPackaged, getPath: vi.fn(() => root), setPath: vi.fn(), setName: vi.fn() };
  }
  it.each([false, true])('uses the existing explicit profile before naming the app (packaged=%s)', (packaged) => {
    const target = path.join(root, 'profile-local');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'history.json'), 'original');
    vi.stubEnv('XUZHOU_PROFILE_DIR', target);
    const runtime = app(packaged);
    initializeProductIdentity(runtime);
    initializeProductIdentity(runtime);
    expect(runtime.setPath).toHaveBeenNthCalledWith(1, 'userData', target);
    expect(runtime.setPath).toHaveBeenNthCalledWith(2, 'userData', target);
    expect(runtime.setName).toHaveBeenCalledWith('续舟');
    expect(runtime.setPath.mock.invocationCallOrder[0]).toBeLessThan(runtime.setName.mock.invocationCallOrder[0]);
    expect(fs.readFileSync(path.join(target, 'history.json'), 'utf8')).toBe('original');
  });
  it('retains the source host E2E profile and gives an explicit product profile priority', () => {
    vi.stubEnv('AIONUI_E2E_TEST', '1');
    vi.stubEnv('AIONUI_E2E_USER_DATA_DIR', path.join(root, 'test'));
    const runtime = app();
    initializeProductIdentity(runtime);
    expect(runtime.setPath).toHaveBeenLastCalledWith('userData', path.join(root, 'test'));
    vi.stubEnv('XUZHOU_PROFILE_DIR', path.join(root, 'product'));
    initializeProductIdentity(runtime);
    expect(runtime.setPath).toHaveBeenLastCalledWith('userData', path.join(root, 'product'));
  });
  it.each([
    [true, false, 'AionUi'],
    [false, false, 'AionUi-Dev'],
    [false, true, 'AionUi-Dev-2'],
  ] as const)('preserves the original fallback profile (%s,%s)', (packaged, multi, folder) => {
    vi.stubEnv('AIONUI_MULTI_INSTANCE', multi ? '1' : '');
    const runtime = app(packaged);
    initializeProductIdentity(runtime);
    expect(runtime.setPath).toHaveBeenCalledWith('userData', path.join(root, folder));
  });
  it('reopens a verified existing profile and its canonical sessions without moving either', () => {
    const profile = path.join(root, 'existing-profile'),
      sessions = path.join(root, 'existing-sessions');
    fs.mkdirSync(path.join(profile, 'aionui'), { recursive: true });
    fs.mkdirSync(sessions);
    fs.writeFileSync(path.join(profile, 'aionui/aionui-backend.db'), 'existing database');
    fs.mkdirSync(path.join(root, 'Xuzhou'));
    fs.writeFileSync(
      path.join(root, 'Xuzhou/profile-location.json'),
      JSON.stringify({ version: 1, profileDirectory: profile, sessionsDirectory: sessions })
    );
    const runtime = app(true);
    initializeProductIdentity(runtime);
    expect(runtime.setPath).toHaveBeenCalledWith('userData', profile);
    expect(process.env.XUZHOU_SESSIONS_DIR).toBe(sessions);
    expect(fs.readFileSync(path.join(profile, 'aionui/aionui-backend.db'), 'utf8')).toBe('existing database');
  });
  it('refuses a broken profile link instead of creating a replacement empty profile', () => {
    fs.mkdirSync(path.join(root, 'Xuzhou'));
    fs.writeFileSync(
      path.join(root, 'Xuzhou/profile-location.json'),
      JSON.stringify({ version: 1, profileDirectory: 'relative', sessionsDirectory: 'relative' })
    );
    const runtime = app(true);
    expect(() => initializeProductIdentity(runtime)).toThrow('profile link is invalid');
    expect(runtime.setPath).not.toHaveBeenCalled();
  });
  it('keeps a beta release separate from a stable profile link, including a broken stable pointer', () => {
    fs.mkdirSync(path.join(root, 'Xuzhou'));
    fs.writeFileSync(path.join(root, 'Xuzhou/profile-location.json'), 'invalid stable pointer');
    const runtime = { ...app(true), getVersion: () => '2.3.1-beta.1' };
    initializeProductIdentity(runtime);
    expect(runtime.setPath).toHaveBeenCalledWith('userData', path.join(root, 'XuzhouBeta'));
    expect(runtime.setName).toHaveBeenCalledWith('续舟 Beta');
    expect(fs.readFileSync(path.join(root, 'Xuzhou/profile-location.json'), 'utf8')).toBe('invalid stable pointer');
  });
  it('honors an explicit beta upgrade profile without moving its existing messages', () => {
    const profile = path.join(root, 'beta-upgrade');
    fs.mkdirSync(profile);
    fs.writeFileSync(path.join(profile, 'history.json'), 'existing messages');
    vi.stubEnv('XUZHOU_PROFILE_DIR', profile);
    const runtime = { ...app(true), getVersion: () => '2.3.1-beta.1' };
    initializeProductIdentity(runtime);
    expect(runtime.setPath).toHaveBeenCalledWith('userData', profile);
    expect(fs.readFileSync(path.join(profile, 'history.json'), 'utf8')).toBe('existing messages');
  });
});
