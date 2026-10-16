import React, { useState } from 'react';
import { Alert, Button, Card, Collapse, Empty, Input, Space, Switch, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { LobsterControls } from './useLobster';
import styles from './LobsterPanel.module.css';

export default function SyncPane({ controls, projectId }: { controls: LobsterControls; projectId: string }) {
  const { t } = useTranslation(),
    { state, call, busy } = controls;
  const [message, setMessage] = useState('');
  if (!state?.available) return null;
  const counts = state.sync.projects[projectId] || { pending: 0, delivered: 0 };
  const chats = state.conversations.filter((c) => c.projectId === projectId && c.gateway === state.gateway.url);
  const messages = chats.flatMap((c) => c.messages).slice(-30);
  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        <Typography.Text bold>{t('settings.lobster.autoSync')}</Typography.Text>
        <Switch
          aria-label={t('settings.lobster.autoSync')}
          checked={state.sync.enabled}
          onChange={(enabled) => {
            void call('sync-settings', { enabled });
          }}
        />
      </div>
      <Typography.Paragraph type='secondary'>{t('settings.lobster.syncHint')}</Typography.Paragraph>
      <Space wrap>
        <Tag>{t('settings.lobster.delivered', { count: counts.delivered })}</Tag>
        <Tag>{t('settings.lobster.pending', { count: counts.pending })}</Tag>
        <Button
          size='small'
          loading={busy === 'sync-retry'}
          onClick={() => {
            void call('sync-retry');
          }}
        >
          {t('common.retry')}
        </Button>
      </Space>
      {state.sync.error && <Alert type='error' content={state.sync.error} />}
      <Collapse bordered={false}>
        <Collapse.Item name='records' header={t('settings.lobster.records')}>
          <div className={styles.records}>
            {state.sync.items
              .filter((x) => x.projectId === projectId)
              .map((item) => {
                const batch = state.sync.batches.find((b) => b.id === item.batchId);
                return (
                  <Card key={item.id} size='small'>
                    <div className={styles.row}>
                      <Typography.Text>
                        {item.agentName} · {item.label}
                      </Typography.Text>
                      <Tag color={item.state === 'delivered' ? 'green' : 'orange'}>
                        {item.state === 'delivered' ? t('settings.lobster.received') : t('settings.lobster.queued')}
                      </Tag>
                    </div>
                    <Typography.Text type='secondary'>{new Date(item.createdAt).toLocaleString()}</Typography.Text>
                    {batch?.receipt && (
                      <div className={styles.path}>
                        {t('settings.lobster.receipt')}: {batch.receipt}
                      </div>
                    )}
                    {batch?.error && <Alert type='warning' content={batch.error} />}
                  </Card>
                );
              })}
          </div>
        </Collapse.Item>
      </Collapse>
      {state.tasks
        .filter((x) => x.projectId === projectId && x.status === 'awaiting-review')
        .map((task) => (
          <Card key={task.id} size='small'>
            <div className={styles.row}>
              <Typography.Text>
                {task.agentId} · {task.title}
              </Typography.Text>
              <Button
                size='small'
                onClick={() => {
                  void call('accept', { taskId: task.id, projectId });
                }}
              >
                {t('settings.lobster.accept')}
              </Button>
            </div>
          </Card>
        ))}
      <div className={styles.row}>
        <Typography.Text bold>{t('settings.lobster.assistantChat')}</Typography.Text>
        <Button
          size='small'
          disabled={state.gateway.state !== 'connected'}
          loading={busy === 'history-refresh'}
          onClick={() => {
            void call('history-refresh', { projectId });
          }}
        >
          {t('common.refresh')}
        </Button>
      </div>
      <div className={styles.messages} data-testid='lobster-messages'>
        {messages.length ? (
          messages.map((m) => (
            <Card key={m.id} size='small' className={styles.message}>
              <Typography.Text type='secondary'>
                {m.role === 'assistant'
                  ? t('settings.lobster.title')
                  : m.role === 'report'
                    ? t('settings.lobster.workReport')
                    : t('settings.lobster.you')}
              </Typography.Text>
              <pre className={styles.output}>
                {m.text || (m.status === 'running' ? t('settings.lobster.replying') : '')}
              </pre>
              {m.error && <Alert type='error' content={m.error} />}
            </Card>
          ))
        ) : (
          <Empty description={t('settings.lobster.noMessages')} />
        )}
      </div>
      <Input.TextArea
        aria-label={t('settings.lobster.message')}
        placeholder={t('settings.lobster.message')}
        value={message}
        onChange={setMessage}
        maxLength={20000}
        autoSize={{ minRows: 2, maxRows: 6 }}
      />
      <Button
        type='primary'
        disabled={
          !message.trim() ||
          !projectId ||
          state.gateway.state !== 'connected' ||
          chats.some((c) => c.status === 'running')
        }
        loading={busy === 'message'}
        onClick={() => {
          void call('message', { projectId, message }).then((result) => {
            if (result) setMessage('');
          });
        }}
      >
        {t('settings.lobster.send')}
      </Button>
    </div>
  );
}
