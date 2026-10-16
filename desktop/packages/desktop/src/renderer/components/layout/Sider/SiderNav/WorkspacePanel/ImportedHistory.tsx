import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { HistorySnapshot, HistoryUpdatePreview, HistoryUpdateResult } from '@/common/types/platform/workspace';
import { workspaceCall } from './api';
import { HistoryMessages } from './HistoryBrowser';
import HistorySync from './HistorySync';
import styles from './WorkspacePanel.module.css';

export default function ImportedHistory({
  id,
  onSnapshot,
  showSync = true,
  externalSnapshot,
}: {
  id?: string;
  onSnapshot?: (snapshot: HistorySnapshot) => void;
  showSync?: boolean;
  externalSnapshot?: HistorySnapshot;
}) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<HistorySnapshot>(),
    [open, setOpen] = useState(false),
    [error, setError] = useState(''),
    [preview, setPreview] = useState<HistoryUpdatePreview>(),
    [checking, setChecking] = useState(false),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    if (externalSnapshot?.id === id) setSnapshot(externalSnapshot);
  }, [externalSnapshot, id]);
  useEffect(() => {
    if (snapshot) onSnapshot?.(snapshot);
  }, [snapshot, onSnapshot]);
  useEffect(() => {
    const own = ++request.current;
    setOpen(false);
    setSnapshot(undefined);
    setError('');
    setPreview(undefined);
    setChecking(false);
    setSaving(false);
    setSaved(false);
    if (id)
      void workspaceCall<HistorySnapshot>('history-snapshot', { id })
        .then((value) => {
          if (own === request.current) setSnapshot(value);
        })
        .catch((e) => {
          if (own === request.current) setError(String(e));
        });
    return () => {
      ++request.current;
    };
  }, [id]);
  async function checkUpdates() {
    if (!id || checking || saving) return;
    const own = ++request.current;
    setOpen(true);
    setChecking(true);
    setSaved(false);
    setPreview(undefined);
    setError('');
    try {
      const value = await workspaceCall<HistoryUpdatePreview>('history-check-updates', { id });
      if (own === request.current) setPreview(value);
    } catch (e) {
      if (own === request.current) setError(String(e));
    } finally {
      if (own === request.current) setChecking(false);
    }
  }
  async function acceptUpdates() {
    if (!preview?.added.length || saving) return;
    const own = ++request.current;
    setSaving(true);
    setError('');
    try {
      const result = await workspaceCall<HistoryUpdateResult>('history-accept-updates', { token: preview.token });
      if (own === request.current) {
        setSnapshot(result.snapshot);
        setPreview(undefined);
        setSaved(true);
      }
    } catch (e) {
      if (own === request.current) setError(String(e));
    } finally {
      if (own === request.current) setSaving(false);
    }
  }
  if (!id) return null;
  return (
    <div className={styles.banner}>
      {error && !snapshot ? (
        <Alert type='error' content={error} />
      ) : snapshot?.source.messages.length ? (
        <Button type='text' disabled={!snapshot} onClick={() => setOpen(true)} data-testid='imported-history'>
          {t('settings.workspace.carried', {
            provider:
              snapshot.source.agentId === 'kiro-v3'
                ? 'Kiro V3'
                : snapshot.source.agentId === 'codex'
                  ? 'Codex'
                  : 'Kiro V2',
            count: snapshot?.source.messages.length || 0,
          })}
        </Button>
      ) : null}
      {showSync && <HistorySync id={id} onSnapshot={setSnapshot} />}
      <Modal
        visible={open}
        title={snapshot?.source.title}
        onCancel={() => {
          if (saving) return;
          ++request.current;
          setChecking(false);
          setOpen(false);
        }}
        maskClosable={!saving}
        footer={null}
        style={{ width: 'min(850px, 94vw)' }}
      >
        <Alert type='info' content={t('settings.workspace.snapshotHint')} className='mb-12px' />
        <div className={styles.toolbar}>
          <Button
            loading={checking}
            disabled={saving}
            onClick={() => void checkUpdates()}
            data-testid='history-update-check'
          >
            {t('settings.workspace.checkUpdates')}
          </Button>
          {!!preview?.added.length && (
            <Button
              type='primary'
              loading={saving}
              onClick={() => void acceptUpdates()}
              data-testid='history-update-accept'
            >
              {t('settings.workspace.bringUpdates', { count: preview.added.length })}
            </Button>
          )}
        </div>
        {error && <Alert type='error' content={error} className='mb-12px' />}
        {saved && <Alert type='success' content={t('settings.workspace.updatesSaved')} className='mb-12px' />}
        {preview && (
          <Alert
            type='info'
            content={
              preview.added.length
                ? t('settings.workspace.newRecords', { count: preview.added.length })
                : t('settings.workspace.noUpdates')
            }
            className='mb-12px'
          />
        )}
        <div className='max-h-60vh overflow-auto' data-testid='history-update-preview'>
          {preview?.added.length ? (
            <HistoryMessages source={{ ...preview.source, messages: preview.added }} />
          ) : snapshot ? (
            <HistoryMessages source={snapshot.source} />
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
