import { describe, expect, it, vi } from 'vitest';
vi.mock('@/common', () => ({ ipcBridge: { deepLink: { received: { emit: vi.fn() } } } }));
import { getInitialNavigationRoute } from '@/process/utils/deepLink';
describe('Initial conversation navigation', () => {
  it('opens a short conversation id or a native UUID before the renderer subscribes', () => {
    expect(getInitialNavigationRoute('aionui://navigate?route=%2Fconversation%2Ff8103894')).toBe(
      '/conversation/f8103894'
    );
    expect(
      getInitialNavigationRoute('aionui://navigate?route=/conversation/43c7c55e-5c36-4ce5-bd88-6d825c82d647')
    ).toContain('43c7c55e');
  });
  it('keeps unrelated startup links on the existing handling path', () => {
    expect(getInitialNavigationRoute('aionui://add-provider?name=demo')).toBeUndefined();
    expect(getInitialNavigationRoute(null)).toBeUndefined();
  });
  it('rejects external locations, traversal, query injection and untrusted protocols', () => {
    for (const value of [
      'https://example.com',
      '/conversation/../settings',
      '/settings/model',
      '/conversation/id?redirect=x',
      '/conversation/',
    ])
      expect(getInitialNavigationRoute('aionui://navigate?route=' + encodeURIComponent(value))).toBeUndefined();
    expect(getInitialNavigationRoute('other://navigate?route=/conversation/id')).toBeUndefined();
  });
});
