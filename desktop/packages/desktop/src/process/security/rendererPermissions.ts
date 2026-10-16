import type { Session, WebContents } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function trustedRendererUrl(value: string, rendererFile: string, developmentUrl?: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'file:') {
      url.hash = '';
      url.search = '';
      return path.resolve(fileURLToPath(url)).toLowerCase() === path.resolve(rendererFile).toLowerCase();
    }
    if (!developmentUrl) return false;
    const dev = new URL(developmentUrl);
    return (
      ['http:', 'https:'].includes(dev.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(dev.hostname) &&
      url.origin === dev.origin
    );
  } catch {
    return false;
  }
}

/** Local-font enumeration is the only implicitly granted browser permission. */
export function rendererPermissionAllowed(input: {
  permission: string;
  topUrl: string;
  frameUrl?: string;
  mainFrame?: boolean;
  rendererFile: string;
  developmentUrl?: string;
}): boolean {
  if (input.permission !== 'local-fonts' || input.mainFrame === false) return false;
  if (!trustedRendererUrl(input.topUrl, input.rendererFile, input.developmentUrl)) return false;
  if (
    input.frameUrl &&
    input.frameUrl !== 'file://' &&
    !trustedRendererUrl(input.frameUrl, input.rendererFile, input.developmentUrl)
  )
    return false;
  return true;
}

export function installRendererPermissions(
  target: Session,
  owner: () => WebContents | undefined,
  rendererFile: string,
  developmentUrl?: string
): void {
  target.setPermissionCheckHandler((contents, permission, origin, details) => {
    if (!contents || contents !== owner()) return false;
    return rendererPermissionAllowed({
      permission,
      topUrl: contents.getURL(),
      frameUrl: details.requestingUrl || origin,
      mainFrame: details.isMainFrame,
      rendererFile,
      developmentUrl,
    });
  });
  target.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(
      contents === owner() &&
        rendererPermissionAllowed({
          permission,
          topUrl: contents.getURL(),
          frameUrl: details.requestingUrl,
          mainFrame: details.isMainFrame,
          rendererFile,
          developmentUrl,
        })
    );
  });
  target.setDevicePermissionHandler(() => false);
}
