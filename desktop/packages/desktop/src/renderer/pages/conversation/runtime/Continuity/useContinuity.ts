// Copyright 2026 Xuzhou contributors. SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContinuityState, HistorySnapshot } from '@/common/types/platform/workspace';
import { workspaceCall } from '@/renderer/components/layout/Sider/SiderNav/WorkspacePanel/api';

/** Ignore old-chat responses and stale polls crossing a pause/resume operation. */
export function useContinuity(conversationId: string, onSnapshot?: (snapshot: HistorySnapshot) => void) {
  const [state, setState] = useState<ContinuityState>(),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  const generation = useRef(0),
    changed = useRef(0),
    callback = useRef(onSnapshot),
    revision = useRef('');
  const mutating = useRef(false);
  callback.current = onSnapshot;
  const receive = useCallback(async (value: ContinuityState, own: number) => {
    if (own !== generation.current) return;
    setState(value);
    setError(value.sync?.error || '');
    if (!value.sync || !callback.current) return;
    const key = value.sync.id + ':' + value.sync.revision;
    if (key === revision.current) return;
    const snapshot = await workspaceCall<HistorySnapshot>('history-snapshot', { id: value.sync.id });
    if (own !== generation.current) return;
    revision.current = key;
    callback.current?.(snapshot);
  }, []);
  useEffect(() => {
    const own = ++generation.current;
    let timer: ReturnType<typeof setTimeout>;
    let polling = false,
      queued = false;
    setState(undefined);
    setError('');
    setSaving(false);
    revision.current = '';
    mutating.current = false;
    const poll = async () => {
      if (polling) {
        queued = true;
        return;
      }
      polling = true;
      const version = changed.current;
      try {
        const value = await workspaceCall<ContinuityState>('chat-continuity', { conversationId });
        if (version === changed.current) await receive(value, own);
      } catch (e) {
        if (own === generation.current && version === changed.current) setError(String(e));
      } finally {
        polling = false;
        if (own === generation.current) {
          clearTimeout(timer);
          timer = setTimeout(() => void poll(), queued ? 0 : document.hidden ? 15000 : 3500);
          queued = false;
        }
      }
    };
    const refresh = (event: Event) => {
      if (event instanceof CustomEvent && event.detail !== conversationId) return;
      if (event.type === 'visibilitychange' && document.hidden) return;
      clearTimeout(timer);
      void poll();
    };
    window.addEventListener('workbench:continuity-changed', refresh);
    document.addEventListener('visibilitychange', refresh);
    void poll();
    return () => {
      ++generation.current;
      clearTimeout(timer);
      window.removeEventListener('workbench:continuity-changed', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [conversationId, receive]);
  const perform = useCallback(
    async (action: 'chat-sync-now' | 'chat-sync-toggle', enabled?: boolean) => {
      if (mutating.current) return;
      const own = generation.current;
      mutating.current = true;
      ++changed.current;
      setSaving(true);
      try {
        await receive(
          await workspaceCall<ContinuityState>(action, {
            conversationId,
            ...(enabled === undefined ? {} : { enabled }),
          }),
          own
        );
      } catch (e) {
        if (own === generation.current) setError(String(e));
      } finally {
        if (own === generation.current) {
          ++changed.current;
          mutating.current = false;
          setSaving(false);
        }
      }
    },
    [conversationId, receive]
  );
  return { state, error, saving, perform };
}
