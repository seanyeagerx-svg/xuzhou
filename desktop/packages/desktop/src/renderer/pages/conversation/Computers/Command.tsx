import React, { useState } from 'react';
import { Button, Card, Collapse, Input, Space, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { ComputerControls } from './api';
import styles from './Computers.module.css';

export default function Command({ controls }: { controls: ComputerControls }) {
  const { t } = useTranslation(),
    { state, call } = controls;
  const [command, setCommand] = useState('');
  const editor = (
    <div className={styles.stack}>
      <Typography.Text type='secondary'>{t('conversation.computers.commandHint')}</Typography.Text>
      <Input.TextArea
        value={command}
        onChange={setCommand}
        autoSize={{ minRows: 3, maxRows: 8 }}
        aria-label={t('conversation.computers.command')}
      />
      <Space>
        <Button
          type='primary'
          disabled={!command.trim() || state?.busy}
          onClick={() => {
            void call('computer-command', { command });
          }}
        >
          {t('conversation.computers.runCommand')}
        </Button>
        <Button
          disabled={!state?.busy}
          onClick={() => {
            void call('computer-cancel');
          }}
        >
          {t('conversation.computers.stop')}
        </Button>
      </Space>
    </div>
  );
  return (
    <div className={styles.stack}>
      <Typography.Paragraph>{t('conversation.computers.taskHint')}</Typography.Paragraph>
      {window.electronAPI?.workspaceCall ? (
        editor
      ) : (
        <Collapse>
          <Collapse.Item name='command' header={t('conversation.computers.advancedCommand')}>
            {editor}
          </Collapse.Item>
        </Collapse>
      )}
      {!state?.jobs.length && (
        <Typography.Text type='secondary'>{t('conversation.computers.noOperations')}</Typography.Text>
      )}
      {[...(state?.jobs || [])].reverse().map((job) => (
        <Card
          key={job.id}
          size='small'
          title={job.summary}
          extra={
            <Tag>
              {t(
                `conversation.computers.jobStates.${['running', 'completed', 'failed', 'interrupted'].includes(job.state) ? job.state : 'interrupted'}`
              )}
            </Tag>
          }
        >
          <Typography.Text type='secondary'>
            {t(job.deviceId === 'cloud' ? 'conversation.computers.cloud' : 'conversation.computers.local')} ·{' '}
            {new Date(job.startedAt).toLocaleTimeString()}
          </Typography.Text>
          {job.output && <pre className={styles.output}>{job.output}</pre>}
          {job.error && <Typography.Text type='error'>{t('conversation.computers.operationFailed')}</Typography.Text>}
          {job.exitCode !== undefined && (
            <Typography.Text type='secondary'>
              {t('conversation.computers.exitCode', { code: job.exitCode })}
            </Typography.Text>
          )}
        </Card>
      ))}
    </div>
  );
}
