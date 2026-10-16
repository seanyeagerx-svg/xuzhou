import React, { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Drawer, Input, Select, Space, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useCompanion } from './useCompanion';
import Art from './Art';
import styles from './Companion.module.css';

export default function LobsterCompanion({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation();
  const { state, busy, error, call } = useCompanion(conversationId);
  const [open, setOpen] = useState(false),
    [question, setQuestion] = useState(''),
    [wave, setWave] = useState(false);
  const waveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    setOpen(false);
    setQuestion('');
    setWave(false);
    return () => clearTimeout(waveTimer.current);
  }, [conversationId]);
  useEffect(() => {
    const listener = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== 'companion') setOpen(false);
    };
    window.addEventListener('workbench:panel', listener);
    return () => window.removeEventListener('workbench:panel', listener);
  }, []);
  if (!state?.available) return null;
  const entry = state.entry;
  const unread = entry.notes.filter((note) => !note.read).length;
  const pose = wave
    ? 'wave'
    : entry.run
      ? 'thinking'
      : entry.error
        ? 'error'
        : unread
          ? 'notify'
          : entry.mode !== 'off'
            ? 'listening'
            : entry.paused
              ? 'sleep'
              : 'idle';
  const statusKey = entry.run
    ? 'working'
    : entry.error
      ? 'needsAttention'
      : unread
        ? 'newNote'
        : entry.mode !== 'off'
          ? 'listening'
          : 'ready';
  const mode = entry.mode === 'periodic' ? String(entry.intervalMinutes) : entry.mode;
  const canAsk = state.ready && state.sourceCount > 0 && !entry.run && !busy;
  const openAssistant = (tab: string) => {
    window.dispatchEvent(new CustomEvent('workbench:lobster-tab', { detail: tab }));
    window.dispatchEvent(new CustomEvent('workbench:panel', { detail: 'lobster' }));
  };
  return (
    <>
      <div className={styles.bar}>
        <Button
          type='text'
          className={styles.petButton}
          data-testid='companion-open'
          onClick={() => {
            window.dispatchEvent(new CustomEvent('workbench:panel', { detail: 'companion' }));
            setOpen(true);
            setWave(true);
            clearTimeout(waveTimer.current);
            waveTimer.current = setTimeout(() => setWave(false), 1100);
            if (unread) void call('companion-read');
          }}
        >
          <Badge count={unread}>
            <Art pose={pose} />
          </Badge>
          <span className={styles.caption}>
            <strong>{t('settings.companion.title')}</strong>
            <span>{t(`settings.companion.${statusKey}`)}</span>
          </span>
        </Button>
      </div>
      <Drawer
        visible={open}
        onCancel={() => setOpen(false)}
        width='min(400px, 100vw)'
        mask={false}
        footer={null}
        title={t('settings.companion.title')}
      >
        <div className={styles.stack} data-testid='companion-panel'>
          <div className={styles.hero}>
            <Art pose={pose} />
            <div className={styles.caption}>
              <Typography.Text bold>{state.title || t('settings.companion.currentChat')}</Typography.Text>
              <Typography.Text type='secondary'>{t(`settings.companion.${statusKey}`)}</Typography.Text>
            </div>
          </div>
          <Typography.Paragraph type='secondary'>{t('settings.companion.hint')}</Typography.Paragraph>
          <Tag color={state.gatewayConnected ? 'green' : 'gray'}>
            {state.gatewayConnected ? t('settings.lobster.connected') : t('settings.lobster.offline')}
          </Tag>
          {(!state.ready || !state.sourceCount) && <Alert content={t('settings.companion.empty')} />}
          {(error || entry.error) && <Alert type='error' content={error || entry.error} />}
          <Select
            aria-label={t('settings.companion.mode')}
            value={mode}
            disabled={!state.ready || busy}
            onChange={(value: string) => {
              void call('companion-configure', {
                mode: value === 'off' || value === 'turn' ? value : 'periodic',
                intervalMinutes: value === '15' ? 15 : 5,
              });
            }}
            options={[
              { value: 'off', label: t('settings.companion.manual') },
              { value: 'turn', label: t('settings.companion.perTurn') },
              { value: '5', label: t('settings.companion.everyFive') },
              { value: '15', label: t('settings.companion.everyFifteen') },
            ]}
          />
          <Typography.Text type='secondary'>{t('settings.companion.automaticHint')}</Typography.Text>
          <Space wrap>
            <Button
              type='primary'
              disabled={!canAsk}
              onClick={() => {
                void call('companion-request', { kind: 'summary' });
              }}
              data-testid='companion-summary'
            >
              {t('settings.companion.summarize')}
            </Button>
            {entry.run && (
              <Button
                disabled={busy}
                onClick={() => {
                  void call('companion-cancel');
                }}
              >
                {t('settings.companion.stop')}
              </Button>
            )}
            <Button
              disabled={!state.ready || busy}
              onClick={() => {
                void call('companion-configure', { mode: 'off' });
              }}
            >
              {t('settings.companion.sleep')}
            </Button>
          </Space>
          <Input.TextArea
            aria-label={t('settings.companion.question')}
            placeholder={t('settings.companion.question')}
            value={question}
            maxLength={4000}
            onChange={setQuestion}
            autoSize={{ minRows: 2, maxRows: 6 }}
          />
          <Button
            disabled={!canAsk || !question.trim()}
            onClick={() => {
              void call('companion-request', { kind: 'ask', question }).then((result) => {
                if (result) setQuestion('');
              });
            }}
          >
            {t('settings.companion.ask')}
          </Button>
          {entry.run && (
            <div className={styles.note}>
              <Tag>{t('settings.companion.working')}</Tag>
              <pre>{entry.run.text}</pre>
            </div>
          )}
          {entry.notes.map((note) => (
            <article key={note.id} className={styles.note}>
              <Typography.Text bold>
                {note.kind === 'ask' ? note.question : t('settings.companion.summary')}
              </Typography.Text>
              <pre>{note.text}</pre>
              <Typography.Text type='secondary'>
                {t('settings.companion.sources', { count: note.sourceCount })}
                {note.clipped ? ` · ${t('settings.companion.clipped')}` : ''}
              </Typography.Text>
              <div>
                <Typography.Text type='secondary'>{new Date(note.createdAt).toLocaleString()}</Typography.Text>
              </div>
            </article>
          ))}
          <Space wrap>
            <Button onClick={() => openAssistant('sync')}>{t('settings.companion.reports')}</Button>
            <Button onClick={() => openAssistant('maintenance')}>{t('settings.companion.repair')}</Button>
          </Space>
          <Typography.Paragraph type='secondary'>{t('settings.companion.attribution')}</Typography.Paragraph>
        </div>
      </Drawer>
    </>
  );
}
