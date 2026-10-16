import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceAction } from '@/common/types/platform/workspace';
import type { ComputerState } from '@/common/types/platform/computer';
import { workspaceCall, hasWorkbench } from '@/renderer/components/layout/Sider/SiderNav/WorkspacePanel/api';

export type ComputerCall = <T = unknown>(
  action: WorkspaceAction,
  data?: Record<string, unknown>
) => Promise<T | undefined>;
export const deviceErrorCode = (error: string): string => error.match(/XUZHOU_DEVICE_([A-Z_]+)/)?.[1] || 'FAILED';
export function useComputer(conversationId: string) {
  const [state, setState] = useState<ComputerState>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const alive = useRef(false);
  const refresh = useCallback(async () => {
    if (!hasWorkbench()) return;
    try {
      const next = await workspaceCall<ComputerState>('computer-state', { conversationId });
      if (alive.current) setState(next);
    } catch (e) {
      if (alive.current) setError(String(e));
    }
  }, [conversationId]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 2500);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [refresh]);
  const call: ComputerCall = useCallback(
    async <T>(action: WorkspaceAction, data: Record<string, unknown> = {}) => {
      setBusy(action);
      setError('');
      try {
        const value = await workspaceCall<T>(action, { ...data, conversationId });
        if (alive.current) await refresh();
        return value;
      } catch (e) {
        if (alive.current) setError(e instanceof Error ? e.message : String(e));
        return undefined;
      } finally {
        if (alive.current) setBusy((current) => (current === action ? '' : current));
      }
    },
    [conversationId, refresh]
  );
  return { state, error, busy, call, refresh };
}
export type ComputerControls = ReturnType<typeof useComputer>;

export function bytesLabel(value: number): string {
  const unit = value >= 1024 ** 3 ? 'GiB' : 'MiB';
  return `${(value / (unit === 'GiB' ? 1024 ** 3 : 1024 ** 2)).toFixed(1)} ${unit}`;
}
export function screenPoint(
  rect: { left: number; top: number; width: number; height: number },
  frame: { width: number; height: number },
  x: number,
  y: number
) {
  const scale = Math.min(rect.width / frame.width, rect.height / frame.height);
  const width = frame.width * scale,
    height = frame.height * scale;
  const dx = x - rect.left - (rect.width - width) / 2,
    dy = y - rect.top - (rect.height - height) / 2;
  if (width <= 0 || height <= 0 || dx < 0 || dy < 0 || dx > width || dy > height) return null;
  return { x: dx / width, y: dy / height };
}
