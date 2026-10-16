import type { WorkspaceAction } from '@/common/types/platform/workspace';
import type { LobsterAction } from '@/common/types/platform/lobster';
declare global {
  interface Window {
    __xuzhouDeviceBridge?: boolean;
  }
}

async function pairedCall<T>(route: string, action: string, data?: Record<string, unknown>): Promise<T> {
  if (!window.__xuzhouDeviceBridge) throw new Error('XUZHOU_DEVICE_UNAVAILABLE');
  const response = await fetch('/xuzhou/' + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, data }),
  });
  const value = (await response.json()) as { value: T; error?: string };
  if (!response.ok || value.error) throw new Error(value.error || 'XUZHOU_DEVICE_PHONE_UNAUTHORIZED');
  return value.value;
}

export async function workspaceCall<T>(action: WorkspaceAction, data?: Record<string, unknown>): Promise<T> {
  if (!window.electronAPI?.workspaceCall) return pairedCall<T>('workspace', action, data);
  return (await window.electronAPI.workspaceCall(action, data)) as T;
}
export function lobsterCall<T>(action: LobsterAction, data?: Record<string, unknown>): Promise<T> {
  if (window.electronAPI?.lobsterCall) return window.electronAPI.lobsterCall(action, data) as Promise<T>;
  return pairedCall<T>('lobster', action, data);
}
export const hasWorkbench = (): boolean => !!window.electronAPI?.workspaceCall || window.__xuzhouDeviceBridge === true;
export function showWorkbenchPanel(panel: string): void {
  window.dispatchEvent(new CustomEvent('workbench:panel', { detail: panel }));
}
