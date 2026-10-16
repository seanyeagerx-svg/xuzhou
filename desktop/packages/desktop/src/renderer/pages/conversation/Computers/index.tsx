import React, { useEffect, useState } from 'react';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { Alert, Button, Card, Select, Space, Tabs, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useComputer, deviceErrorCode } from './api';
import Cloud from './Cloud';
import Command from './Command';
import Files from './Files';
import Screen from './Screen';
import Phone from './Phone';
import styles from './Computers.module.css';

const ERROR_KEYS: Record<string, string> = {
  CLOUD_DISCONNECTED: 'connectFirst',
  CAPACITY_UNKNOWN: 'checkFirst',
  CLOUD_SPACE_LOW: 'spaceLow',
  CLOUD_MEMORY_LOW: 'memoryLow',
  CONNECTION_CHANGED: 'connectionChanged',
  PATH_OUTSIDE: 'pathOutside',
  FILE_CONFLICT: 'fileConflict',
  FILE_TOO_LARGE: 'fileLimit',
  FILE_VERSION_REQUIRED: 'fileConflict',
  BUSY: 'operationBusy',
  PHONE_PRIVATE_NETWORK_REQUIRED: 'phoneNetwork',
  SCREEN_OWNER_REQUIRED: 'desktopMustShare',
  SCREEN_NOT_SHARED: 'screenOff',
  SCREEN_CONTROL_REQUIRED: 'takeOverFirst',
  SCREEN_FRAME_EXPIRED: 'frameExpired',
  CANCELLED: 'cancelled',
  CHAT_UNAVAILABLE: 'chatUnavailable',
  SCREEN_LOCAL_ONLY: 'screenLocalOnly',
  SCREEN_SHORTCUT_UNAVAILABLE: 'shortcutUnavailable',
  SCREEN_UNAVAILABLE: 'screenUnavailable',
  INPUT_FAILED: 'inputFailed',
  TIMEOUT: 'operationTimeout',
  PHONE_UNAUTHORIZED: 'pairExpired',
};

export default function Computers({ conversationId, children }: { conversationId: string; children: React.ReactNode }) {
  const { t } = useTranslation(),
    controls = useComputer(conversationId),
    { state, call, error } = controls;
  const [open, setOpen] = useState(false),
    [tab, setTab] = useState('screen');
  const setComputerPanelOpen = useLayoutContext()?.setComputerPanelOpen;
  useEffect(() => {
    setComputerPanelOpen?.(open && !!state?.available);
    return () => setComputerPanelOpen?.(false);
  }, [open, state?.available, setComputerPanelOpen]);
  const show = (next: string) => {
    setTab(next);
    setOpen(true);
  };
  if (!state?.available) return <>{children}</>;
  return (
    <div className={styles.workspace} data-testid='computer-workspace'>
      <div className={styles.toolbar}>
        <Space wrap>
          <Typography.Text type='secondary'>{t('conversation.computers.executionDevice')}</Typography.Text>
          <Select
            className={styles.deviceSelect}
            value={state.deviceId}
            disabled={state.busy}
            aria-label={t('conversation.computers.executionDevice')}
            options={[
              { value: 'local', label: t('conversation.computers.local') },
              { value: 'cloud', label: t('conversation.computers.cloud'), disabled: !state.cloud.usable },
            ]}
            onChange={(deviceId) => {
              void call('computer-select', { deviceId });
            }}
          />
          {state.busy && <Tag color='arcoblue'>{t('conversation.computers.running')}</Tag>}
          {state.deviceId === 'cloud' && !state.cloud.usable && (
            <Tag color='orange'>{t('conversation.computers.unavailable')}</Tag>
          )}
        </Space>
        <Space wrap>
          <Button size='small' onClick={() => show('cloud')}>
            {t('conversation.computers.cloudConnection')}
          </Button>
          <Button size='small' onClick={() => show('command')}>
            {t('conversation.computers.progress')}
          </Button>
          <Button size='small' onClick={() => show('files')}>
            {t('conversation.computers.files')}
          </Button>
          <Button size='small' onClick={() => show('screen')}>
            {t('conversation.computers.screen')}
          </Button>
          {!!window.electronAPI?.workspaceCall && (
            <Button size='small' onClick={() => show('phone')}>
              {t('conversation.computers.phone')}
            </Button>
          )}
          {(state.busy || state.screen.mode === 'ai' || state.screen.mode === 'human') && (
            <Button
              size='small'
              status='danger'
              onClick={() => {
                void call('computer-cancel');
              }}
            >
              {t('conversation.computers.pause')}
            </Button>
          )}
        </Space>
      </div>
      {error && (
        <Alert
          type='warning'
          content={t(`conversation.computers.${ERROR_KEYS[deviceErrorCode(error)] || 'operationFailed'}`)}
        />
      )}
      {state.approvals.map((approval) => (
        <Card
          key={approval.id}
          size='small'
          title={t('conversation.computers.approvalTitle')}
          className={styles.approval}
        >
          <pre className={styles.output}>{JSON.stringify(approval.details, null, 2)}</pre>
          <Space>
            <Button
              type='primary'
              onClick={() => {
                void call('computer-decision', { id: approval.id, allow: true });
              }}
            >
              {t('conversation.computers.allowOnce')}
            </Button>
            <Button
              onClick={() => {
                void call('computer-decision', { id: approval.id, allow: false });
              }}
            >
              {t('conversation.computers.deny')}
            </Button>
          </Space>
        </Card>
      ))}
      <div className={styles.body}>
        <div className={styles.chat}>{children}</div>
        {open && (
          <aside className={styles.panel} aria-label={t('conversation.computers.panel')}>
            <div className={styles.panelHeader}>
              <Typography.Text bold>{t('conversation.computers.panel')}</Typography.Text>
              <Button size='small' type='text' onClick={() => setOpen(false)}>
                {t('common.close')}
              </Button>
            </div>
            <Tabs activeTab={tab} onChange={setTab} destroyOnHide>
              <Tabs.TabPane key='cloud' title={t('conversation.computers.cloud')}>
                <Cloud controls={controls} />
              </Tabs.TabPane>
              <Tabs.TabPane key='command' title={t('conversation.computers.progress')}>
                <Command controls={controls} />
              </Tabs.TabPane>
              <Tabs.TabPane key='files' title={t('conversation.computers.files')}>
                <Files controls={controls} />
              </Tabs.TabPane>
              <Tabs.TabPane key='screen' title={t('conversation.computers.screen')}>
                <Screen controls={controls} />
              </Tabs.TabPane>
              {!!window.electronAPI?.workspaceCall && (
                <Tabs.TabPane key='phone' title={t('conversation.computers.phone')}>
                  <Phone controls={controls} />
                </Tabs.TabPane>
              )}
            </Tabs>
          </aside>
        )}
      </div>
    </div>
  );
}
