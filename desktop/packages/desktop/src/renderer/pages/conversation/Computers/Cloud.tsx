import React, { useEffect, useRef } from 'react';
import { Alert, Button, Collapse, Descriptions, Space, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import ConnectionForm from '@/renderer/components/layout/Sider/SiderNav/LobsterPanel/ConnectionForm';
import { useLobster } from '@/renderer/components/layout/Sider/SiderNav/LobsterPanel/useLobster';
import type { ComputerControls } from './api';
import { bytesLabel } from './api';
import styles from './Computers.module.css';

export default function Cloud({ controls }: { controls: ComputerControls }) {
  const { t } = useTranslation(),
    lobster = useLobster(),
    { state, call, busy } = controls;
  const checked = useRef('');
  const connection = lobster.state?.maintenance;
  useEffect(() => {
    const key = connection?.ready ? `${connection.profile.host}:${connection.generation}` : '';
    if (key && key !== checked.current) {
      checked.current = key;
      void call('computer-probe');
    }
  }, [connection?.ready, connection?.generation, connection?.profile.host, call]);
  if (!state) return null;
  const resource = state.cloud.resource;
  return (
    <div className={styles.stack}>
      <Typography.Paragraph>{t('conversation.computers.cloudHint')}</Typography.Paragraph>
      {state.cloud.reason === 'CLOUD_SPACE_LOW' && (
        <Alert type='warning' content={t('conversation.computers.spaceLow')} />
      )}
      {state.cloud.reason === 'CLOUD_MEMORY_LOW' && (
        <Alert type='warning' content={t('conversation.computers.memoryLow')} />
      )}
      {resource && (
        <Descriptions
          column={1}
          data={[
            { label: t('conversation.computers.host'), value: resource.hostname },
            {
              label: t('conversation.computers.diskFree'),
              value: `${bytesLabel(resource.diskFree)} / ${bytesLabel(resource.diskTotal)}`,
            },
            {
              label: t('conversation.computers.memoryFree'),
              value: `${bytesLabel(resource.memoryAvailable)} / ${bytesLabel(resource.memoryTotal)}`,
            },
            { label: t('conversation.computers.checkedAt'), value: new Date(resource.checkedAt).toLocaleString() },
          ]}
        />
      )}
      <Space wrap>
        <Button
          disabled={!connection?.ready}
          loading={busy === 'computer-probe'}
          onClick={() => {
            void call('computer-probe');
          }}
        >
          {t('conversation.computers.checkCapacity')}
        </Button>
        <Button
          type='primary'
          disabled={!state.cloud.usable || state.busy}
          onClick={() => {
            void call('computer-select', { deviceId: 'cloud' });
          }}
        >
          {t('conversation.computers.useCloud')}
        </Button>
      </Space>
      <Typography.Paragraph type='secondary'>{t('conversation.computers.capacityRule')}</Typography.Paragraph>
      <Collapse defaultActiveKey={connection?.ready ? [] : ['connection']}>
        <Collapse.Item name='connection' header={t('conversation.computers.cloudConnection')}>
          <ConnectionForm controls={lobster} visible sshOnly />
        </Collapse.Item>
      </Collapse>
    </div>
  );
}
