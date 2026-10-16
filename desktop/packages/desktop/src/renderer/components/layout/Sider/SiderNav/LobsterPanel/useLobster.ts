import { useCallback, useEffect, useState } from 'react';
import { Message } from '@arco-design/web-react';
import type { LobsterAction, LobsterState } from '@/common/types/platform/lobster';
import { lobsterCall, hasWorkbench } from '../WorkspacePanel/api';

export function useLobster() {
  const [state, setState] = useState<LobsterState | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    if (!hasWorkbench()) return;
    try {
      setState(await lobsterCall<LobsterState>('state'));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 2500);
    return () => clearInterval(timer);
  }, [refresh]);
  const call = useCallback(
    async (action: LobsterAction, data?: Record<string, unknown>) => {
      setBusy(action);
      try {
        const result = await lobsterCall(action, data);
        await refresh();
        return result;
      } catch (e) {
        Message.error(e instanceof Error ? e.message : String(e));
        return undefined;
      } finally {
        setBusy((current) => (current === action ? '' : current));
      }
    },
    [refresh]
  );
  return { state, busy, error, call, refresh };
}
export type LobsterControls = ReturnType<typeof useLobster>;
