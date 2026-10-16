import { useCallback, useEffect, useRef, useState } from 'react';
import type { NativeCodexCatalog } from '@/common/types/platform/workspace';
import { workspaceCall, hasWorkbench } from '../api';

export function useNativeCatalog() {
  const [catalog, setCatalog] = useState<NativeCodexCatalog>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState(false);
  const availability = useRef<boolean | undefined>(undefined);
  const alive = useRef(false);
  const busy = useRef(false);
  const refresh = useCallback(async () => {
    if (busy.current || availability.current === false || !hasWorkbench()) return;
    busy.current = true;
    setLoading(true);
    try {
      if (availability.current === undefined) {
        try {
          const state = await workspaceCall<{ available: boolean }>('state');
          availability.current = !!state?.available;
        } catch {
          availability.current = false;
        }
        if (alive.current) setAvailable(availability.current);
      }
      if (!availability.current) return;
      const next = await workspaceCall<NativeCodexCatalog>('codex-catalog');
      if (alive.current) {
        setCatalog(next);
        setError('');
      }
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      busy.current = false;
      if (alive.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const focus = (): void => {
      void refresh();
    };
    window.addEventListener('focus', focus);
    return () => {
      alive.current = false;
      window.removeEventListener('focus', focus);
    };
  }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(
      (): void => {
        void refresh();
      },
      catalog?.loading ? 2000 : 30000
    );
    return () => window.clearInterval(timer);
  }, [catalog?.loading, refresh]);
  const bind = useCallback((nativeId: string, conversationId: string) => {
    setCatalog((old) => (old ? { ...old, bindings: { ...old.bindings, [nativeId]: conversationId } } : old));
  }, []);
  return { available, catalog, error, loading, refresh, bind };
}
