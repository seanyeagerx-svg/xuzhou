import { useCallback, useEffect, useRef, useState } from 'react';
import type { CompanionState, WorkspaceAction } from '@/common/types/platform/workspace';
import { workspaceCall, hasWorkbench } from '../../WorkspacePanel/api';

/** Keep async replies scoped to the chat that requested them. Polling never enables listening. */
export function useCompanion(conversationId: string) {
  const [state, setState] = useState<CompanionState>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const current = useRef(conversationId);
  const sequence = useRef(0);
  const pending = useRef(false);
  current.current = conversationId;
  const call = useCallback(
    async (action: WorkspaceAction, data: Record<string, unknown> = {}) => {
      const bridge = hasWorkbench() ? workspaceCall : undefined;
      if (!bridge || (action === 'companion-state' && pending.current)) return;
      const mutation = action !== 'companion-state';
      if (mutation && pending.current) return;
      if (mutation) {
        pending.current = true;
        setBusy(true);
      }
      const request = ++sequence.current;
      try {
        const result = (await bridge(action, { ...data, conversationId })) as CompanionState;
        if (current.current === conversationId && request === sequence.current) {
          setState(result);
          setError('');
        }
        return result;
      } catch (e) {
        if (current.current === conversationId && request === sequence.current)
          setError(e instanceof Error ? e.message : String(e));
        return undefined;
      } finally {
        if (mutation && current.current === conversationId) {
          pending.current = false;
          setBusy(false);
        }
      }
    },
    [conversationId]
  );
  useEffect(() => {
    current.current = conversationId;
    pending.current = false;
    setState(undefined);
    setError('');
    setBusy(false);
    void call('companion-state');
    const timer = setInterval(() => {
      void call('companion-state');
    }, 2500);
    return () => {
      clearInterval(timer);
      current.current = '';
      ++sequence.current;
    };
  }, [call]);
  return { state, error, busy, call };
}
