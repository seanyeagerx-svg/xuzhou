import type { WebContents } from 'electron';
import { trustedRendererUrl } from './rendererPermissions';

/** A privileged preload must never survive navigation to a remote document. */
export function protectRendererNavigation(contents: WebContents, rendererFile: string, developmentUrl?: string): void {
  contents.on('will-navigate', (event, url) => {
    if (!trustedRendererUrl(url, rendererFile, developmentUrl)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!trustedRendererUrl(url, rendererFile, developmentUrl)) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (_event, preferences) => {
    delete preferences.preload;
    preferences.nodeIntegration = false;
    preferences.contextIsolation = true;
    preferences.sandbox = true;
    preferences.webSecurity = true;
    preferences.allowRunningInsecureContent = false;
  });
}
