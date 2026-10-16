import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Checkbox, Input, Space, Typography } from '@arco-design/web-react';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import type { ComputerControls } from './api';
import styles from './Computers.module.css';

export default function Phone({ controls }: { controls: ComputerControls }) {
  const { t } = useTranslation(),
    { state, call, busy } = controls;
  const [pair, setPair] = useState<{ url: string; expiresAt: number }>(),
    [now, setNow] = useState(Date.now()),
    [ownerConsent, setOwnerConsent] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setOwnerConsent(false);
    setPair(undefined);
  }, [state?.conversationId]);
  if (!window.electronAPI?.workspaceCall) return <Alert content={t('conversation.computers.phoneConnected')} />;
  const active = pair && pair.expiresAt > now;
  return (
    <div className={styles.stack}>
      <Typography.Paragraph>{t('conversation.computers.phoneHint')}</Typography.Paragraph>
      <Alert type='info' content={t('conversation.computers.phoneNetwork')} />
      <Alert type='warning' content={t('conversation.computers.phoneOwnerScope')} />
      <Checkbox checked={ownerConsent} onChange={setOwnerConsent}>
        {t('conversation.computers.phoneOwnerConsent')}
      </Checkbox>
      <Space wrap>
        <Button
          type='primary'
          loading={busy === 'computer-pair'}
          disabled={!ownerConsent}
          onClick={() => {
            void call<{ url: string; expiresAt: number }>('computer-pair', { ownerConsent }).then((value) => {
              if (value) {
                setPair(value);
                setOwnerConsent(false);
              }
            });
          }}
        >
          {t('conversation.computers.createPair')}
        </Button>
        <Button
          disabled={!state?.mobile.running}
          onClick={() => {
            setPair(undefined);
            void call('computer-phone-stop');
          }}
        >
          {t('conversation.computers.closePhone')}
        </Button>
      </Space>
      {active && (
        <div className={styles.pairing} data-private-pairing>
          <QRCodeSVG value={pair.url} size={192} />
          <Input readOnly value={pair.url} aria-label={t('conversation.computers.pairLink')} />
          <Typography.Text>
            {t('conversation.computers.pairExpires', {
              seconds: Math.max(0, Math.ceil((pair.expiresAt - now) / 1000)),
            })}
          </Typography.Text>
        </div>
      )}
      {pair && !active && <Typography.Text type='secondary'>{t('conversation.computers.pairExpired')}</Typography.Text>}
      {state?.mobile.devices.map((device) => (
        <Card
          key={device.id}
          size='small'
          title={device.label}
          extra={
            <Button
              type='text'
              status='danger'
              onClick={() => {
                void call('computer-unpair', { id: device.id });
              }}
            >
              {t('conversation.computers.revokePhone')}
            </Button>
          }
        >
          <Typography.Text type='secondary'>{new Date(device.createdAt).toLocaleString()}</Typography.Text>
        </Card>
      ))}
    </div>
  );
}
