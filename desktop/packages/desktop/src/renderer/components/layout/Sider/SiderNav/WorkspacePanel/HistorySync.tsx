import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Switch, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { HistorySnapshot, HistorySyncState } from '@/common/types/platform/workspace';
import { workspaceCall } from './api';
import styles from './WorkspacePanel.module.css';

export default function HistorySync({ id, onSnapshot }: { id: string; onSnapshot: (value: HistorySnapshot) => void }) {
  const { t } = useTranslation();
  const [state, setState] = useState<HistorySyncState>();
  const [open, setOpen] = useState(false),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  const generation = useRef(0),
    changed = useRef(0),
    callback = useRef(onSnapshot);
  callback.current = onSnapshot;
  useEffect(() => {
    const own = ++generation.current;
    let timer: ReturnType<typeof setTimeout>;
    setState(undefined);
    setOpen(false);
    setError('');
    setSaving(false);
    const poll = async () => {
      const version = changed.current;
      try {
        const value = await workspaceCall<HistorySyncState>('history-sync-state', { id });
        if (own === generation.current && version === changed.current) {
          setState(value);
          setError(value.error || '');
          callback.current(value.snapshot);
        }
      } catch (e) {
        if (own === generation.current && version === changed.current) setError(String(e));
      } finally {
        if (own === generation.current) timer = setTimeout(() => void poll(), 5000);
      }
    };
    void poll();
    return () => {
      ++generation.current;
      clearTimeout(timer);
    };
  }, [id]);
  async function toggle(enabled: boolean) {
    if (saving) return;
    const own = generation.current;
    ++changed.current;
    setSaving(true);
    try {
      const value = await workspaceCall<HistorySyncState>('history-sync-toggle', { id, enabled });
      if (own === generation.current) {
        setState(value);
        setError(value.error || '');
      }
    } catch (e) {
      if (own === generation.current) setError(String(e));
    } finally {
      if (own === generation.current) {
        ++changed.current;
        setSaving(false);
      }
    }
  }
  const attention =
    error || [state?.inbound.state, state?.outbound.state].some((s) => ['conflict', 'retrying'].includes(s || ''));
  return (
    <>
      <Button type='text' data-testid='history-sync-status' onClick={() => setOpen(true)}>
        {t(
          attention
            ? 'settings.workspace.sync.attention'
            : !state
              ? 'settings.workspace.sync.loading'
              : !state.enabled
                ? 'settings.workspace.sync.paused'
                : state.outbound.state === 'unsupported'
                  ? 'settings.workspace.sync.partial'
                  : 'settings.workspace.sync.active'
        )}
      </Button>
      <Modal
        visible={open}
        title={t('settings.workspace.sync.title')}
        onCancel={() => setOpen(false)}
        footer={null}
        style={{ width: 'min(620px, 94vw)' }}
      >
        <p>{t('settings.workspace.sync.hint')}</p>
        <Alert type='info' content={t('settings.workspace.sync.longContext')} className='mb-12px' />
        {error && <Alert type='error' content={error} className='mb-12px' />}
        {state && (
          <>
            <div className={styles.toolbar}>
              <Switch
                checked={state.enabled}
                loading={saving}
                onChange={(value) => void toggle(value)}
                aria-label={t('settings.workspace.sync.toggle')}
                data-testid='history-sync-toggle'
              />
              <span>{t('settings.workspace.sync.toggle')}</span>
            </div>
            {(['inbound', 'outbound'] as const).map((direction) => {
              const status = state[direction];
              return (
                <div className={styles.message} key={direction} data-testid={'history-sync-' + direction}>
                  <strong>
                    {t(
                      direction === 'inbound' ? 'settings.workspace.sync.inbound' : 'settings.workspace.sync.outbound',
                      { provider: state.snapshot.source.agentId }
                    )}
                  </strong>
                  <p>{t(`settings.workspace.sync.states.${status.state}`)}</p>
                  {status.detail && <p>{status.detail}</p>}
                  {status.records !== undefined && (
                    <div className={styles.meta}>{t('settings.workspace.sync.records', { count: status.records })}</div>
                  )}
                  {status.lastSuccessAt && (
                    <div className={styles.meta}>
                      {t('settings.workspace.sync.lastSuccess', {
                        time: new Date(status.lastSuccessAt).toLocaleString(),
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            <Alert
              type='info'
              content={t(
                state.snapshot.source.agentId === 'codex'
                  ? 'settings.workspace.sync.codexHint'
                  : state.snapshot.source.agentId === 'kiro-v3'
                    ? 'settings.workspace.sync.kiroV3Hint'
                    : 'settings.workspace.sync.kiroHint'
              )}
            />
            {state.snapshot.source.agentId === 'kiro-v3' && (
              <>
                <p>{t('settings.workspace.sync.openV3')}</p>
                <Typography.Paragraph copyable data-testid='kiro-v3-resume-command'>
                  {`kiro-cli chat --v3 --resume-id ${state.snapshot.source.id}`}
                </Typography.Paragraph>
              </>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
