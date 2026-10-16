import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Input, Modal, Select, Spin, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { emitter } from '@/renderer/utils/emitter';
import type { HistoryPreview, HistorySource, NativeHistoryItem } from '@/common/types/platform/workspace';
import { workspaceCall } from './api';
import styles from './WorkspacePanel.module.css';

export function HistoryMessages({ source }: { source: HistorySource }) {
  const { t } = useTranslation();
  return (
    <>
      {source.messages.map((m) => (
        <div className={styles.message} key={m.id}>
          <Typography.Text bold>
            {m.role === 'user'
              ? t('settings.workspace.you')
              : m.role === 'status'
                ? t('settings.workspace.toolRecord')
                : m.agentName || source.agentId}
          </Typography.Text>
          <pre className={styles.text}>{m.text}</pre>
        </div>
      ))}
    </>
  );
}

export default function HistoryBrowser({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [provider, setProvider] = useState('codex'),
    [query, setQuery] = useState('');
  const [items, setItems] = useState<NativeHistoryItem[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [preview, setPreview] = useState<HistoryPreview>(),
    [cwd, setCwd] = useState('');
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const request = useRef(0);
  async function list(next?: string) {
    const own = ++request.current;
    setLoading(true);
    setError('');
    try {
      const result = await workspaceCall<{ items: NativeHistoryItem[]; nextCursor: string | null }>('history-list', {
        agentId: provider,
        cursor: next,
      });
      if (own === request.current) {
        setItems((old) =>
          next ? [...old, ...result.items.filter((x) => !old.some((y) => y.id === x.id))] : result.items
        );
        setCursor(result.nextCursor);
      }
    } catch (e) {
      if (own === request.current) setError(String(e));
    } finally {
      if (own === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    setItems([]);
    setPreview(undefined);
    setCwd('');
    setCursor(null);
    void list();
    return () => {
      ++request.current;
    };
  }, [provider]);
  async function select(item: NativeHistoryItem) {
    const own = ++request.current;
    setLoading(true);
    setError('');
    setPreview(undefined);
    try {
      const value = await workspaceCall<HistoryPreview>('history-preview', { agentId: provider, id: item.id });
      if (own === request.current) {
        setPreview(value);
        setCwd(value.source.cwd.replace(/^\\\\\?\\/, ''));
      }
    } catch (e) {
      if (own === request.current) setError(String(e));
    } finally {
      if (own === request.current) setLoading(false);
    }
  }
  async function importHistory() {
    if (!preview || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await workspaceCall<{ conversationId: string }>('history-import', { token: preview.token, cwd });
      emitter.emit('chat.history.refresh');
      await navigate('/conversation/' + result.conversationId);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      visible
      title={t('settings.workspace.history')}
      style={{ width: 'min(1100px, 94vw)' }}
      footer={null}
      onCancel={() => {
        if (!busy) onClose();
      }}
      maskClosable={!busy}
      unmountOnExit
    >
      <Alert type='info' content={t('settings.workspace.historyHint')} className='mb-12px' />
      <div className={styles.toolbar}>
        <Select
          value={provider}
          onChange={setProvider}
          disabled={busy}
          className='w-180px'
          options={[
            { label: 'Codex', value: 'codex' },
            { label: 'Kiro V3', value: 'kiro-v3' },
            { label: 'Kiro V2 / Crew', value: 'kiro' },
          ]}
        />
        <Input.Search value={query} onChange={setQuery} placeholder={t('settings.workspace.search')} allowClear />
        <Button onClick={() => void list()} disabled={busy || loading}>
          {t('settings.workspace.refresh')}
        </Button>
      </div>
      {error && <Alert type='error' content={error} className='mb-12px' />}
      <div className={styles.browser}>
        <div className={styles.list}>
          {items
            .filter((x) => (x.title + x.cwd).toLowerCase().includes(query.toLowerCase()))
            .map((item) => (
              <Button
                key={item.id}
                long
                type={preview?.source.id === item.id ? 'secondary' : 'text'}
                className={styles.row}
                onClick={() => void select(item)}
                disabled={busy}
              >
                <div>
                  <div>{item.title}</div>
                  <div className={styles.meta}>{item.cwd}</div>
                  <div className={styles.meta}>{new Date(item.updatedAt).toLocaleString()}</div>
                </div>
              </Button>
            ))}
          {!items.length && !loading && <Empty description={t('settings.workspace.noHistory')} />}
          {cursor && (
            <Button long onClick={() => void list(cursor)} disabled={busy || loading}>
              {t('settings.workspace.more')}
            </Button>
          )}
        </div>
        <div className={styles.preview}>
          {loading && <Spin />}
          {preview ? (
            <>
              <Typography.Title heading={6}>{preview.source.title}</Typography.Title>
              <div className={styles.meta}>
                {t('settings.workspace.messages', { count: preview.source.messages.length })}
              </div>
              <div className={styles.toolbar}>
                <Input value={cwd} readOnly aria-label={t('settings.workspace.project')} />
                <Button
                  disabled={busy}
                  onClick={() =>
                    void workspaceCall<string | null>('choose-directory')
                      .then((p) => {
                        if (p) setCwd(p);
                      })
                      .catch((e) => setError(String(e)))
                  }
                >
                  {t('settings.workspace.chooseProject')}
                </Button>
              </div>
              <Button
                type='primary'
                loading={busy}
                disabled={!cwd}
                onClick={() => void importHistory()}
                data-testid='history-import'
              >
                {t('settings.workspace.continue')}
              </Button>
              <HistoryMessages source={preview.source} />
            </>
          ) : (
            !loading && <Empty description={t('settings.workspace.selectHistory')} />
          )}
        </div>
      </div>
    </Modal>
  );
}
