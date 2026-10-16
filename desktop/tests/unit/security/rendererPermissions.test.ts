import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { rendererPermissionAllowed, trustedRendererUrl } from '@/process/security/rendererPermissions';

const rendererFile = path.resolve('out/renderer/index.html');
const topUrl = pathToFileURL(rendererFile).href;
const allowed = (changes: Partial<Parameters<typeof rendererPermissionAllowed>[0]> = {}) =>
  rendererPermissionAllowed({ permission: 'local-fonts', topUrl, rendererFile, mainFrame: true, ...changes });
describe('privileged renderer permissions', () => {
  it('permits local font enumeration only for the bundled document', () => expect(allowed()).toBe(true));
  it.each(['unknown', 'media', 'notifications', 'geolocation', 'clipboard-read', 'usb', 'serial', 'hid', 'midiSysex'])(
    'denies %s without a product-specific grant',
    (permission) => expect(allowed({ permission })).toBe(false)
  );
  it('denies a remote document and a remote subframe of the real document', () => {
    expect(allowed({ topUrl: 'https://example.test' })).toBe(false);
    expect(allowed({ frameUrl: 'https://example.test' })).toBe(false);
    expect(allowed({ mainFrame: false })).toBe(false);
  });
  it('denies another local file despite sharing the file origin', () =>
    expect(allowed({ topUrl: pathToFileURL(path.resolve('other.html')).href })).toBe(false));
  it('does not trust a URL containing the expected filename in its query', () =>
    expect(allowed({ topUrl: 'https://example.test/?file=' + topUrl })).toBe(false));
  it('allows an explicitly configured loopback development origin but rejects adjacent ports', () => {
    const developmentUrl = 'http://127.0.0.1:5173/';
    expect(allowed({ developmentUrl, topUrl: developmentUrl })).toBe(true);
    expect(allowed({ developmentUrl, topUrl: 'http://127.0.0.1:5174' })).toBe(false);
    expect(allowed({ developmentUrl: 'https://example.test', topUrl: 'https://example.test' })).toBe(false);
  });
  it.each(['data:text/html,test', 'javascript:alert(1)', 'about:blank', 'invalid'])(
    'rejects untrusted navigation %s',
    (value) => expect(trustedRendererUrl(value, rendererFile)).toBe(false)
  );
});
