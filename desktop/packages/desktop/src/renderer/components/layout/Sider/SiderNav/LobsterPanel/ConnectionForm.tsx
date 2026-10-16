import React, { useEffect, useState } from 'react';
import { Alert, Button, Divider, Form, Input, InputNumber, Select, Space, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { LobsterProfile } from '@/common/types/platform/lobster';
import type { LobsterControls } from './useLobster';
import styles from './LobsterPanel.module.css';

export default function ConnectionForm({
  controls,
  visible,
  sshOnly = false,
}: {
  controls: LobsterControls;
  visible: boolean;
  sshOnly?: boolean;
}) {
  const { t } = useTranslation(),
    { state, call, busy } = controls;
  const [profile, setProfile] = useState<LobsterProfile>({
    host: '',
    username: '',
    port: 22,
    httpPort: 18789,
    scope: 'user',
    keyFile: '',
  });
  const [url, setUrl] = useState(''),
    [token, setToken] = useState(''),
    [password, setPassword] = useState('');
  useEffect(() => {
    if (!visible) {
      setPassword('');
      setToken('');
    }
  }, [visible]);
  useEffect(() => {
    if (state?.available) {
      setProfile(state.maintenance.profile);
      setUrl(state.gateway.url);
    }
  }, [state?.maintenance.profile.host, state?.gateway.url]);
  if (!state?.available) return null;
  const update = (key: keyof LobsterProfile, value: string | number) => setProfile((p) => ({ ...p, [key]: value }));
  const hostKey = state.maintenance.hostKey;
  return (
    <div className={styles.stack}>
      <Typography.Text bold>{t('settings.lobster.repairChannel')}</Typography.Text>
      <Typography.Paragraph type='secondary'>{t('settings.lobster.credentialsHint')}</Typography.Paragraph>
      <Typography.Text>{state.maintenance.detail}</Typography.Text>
      {hostKey && (
        <Alert
          type='warning'
          title={t('settings.lobster.hostIdentity')}
          content={
            <div className={styles.stack}>
              <Typography.Text>
                {hostKey.host}:{hostKey.port}
              </Typography.Text>
              <Typography.Text className={styles.path}>{hostKey.fingerprint}</Typography.Text>
              <Space>
                <Button
                  onClick={() => {
                    void call('ssh-trust', { allow: true, fingerprint: hostKey.fingerprint });
                  }}
                >
                  {t('settings.lobster.trust')}
                </Button>
                <Button
                  onClick={() => {
                    void call('ssh-trust', { allow: false, fingerprint: hostKey.fingerprint });
                  }}
                >
                  {t('settings.lobster.deny')}
                </Button>
              </Space>
            </div>
          }
        />
      )}
      <Form
        layout='vertical'
        onSubmit={() => {
          const credential = password;
          setPassword('');
          void call('ssh-connect', {
            profile,
            ...(profile.keyFile ? { passphrase: credential } : { password: credential }),
          });
        }}
      >
        <Form.Item label={t('settings.lobster.host')}>
          <Input value={profile.host} onChange={(v) => update('host', v)} aria-label={t('settings.lobster.host')} />
        </Form.Item>
        <div className={styles.columns}>
          <Form.Item label={t('settings.lobster.username')}>
            <Input
              value={profile.username}
              onChange={(v) => update('username', v)}
              aria-label={t('settings.lobster.username')}
            />
          </Form.Item>
          <Form.Item label={t('settings.lobster.sshPort')}>
            <InputNumber
              value={profile.port}
              min={1}
              max={65535}
              onChange={(v) => update('port', v)}
              aria-label={t('settings.lobster.sshPort')}
            />
          </Form.Item>
        </div>
        <Form.Item label={t('settings.lobster.password')}>
          <Input.Password
            value={password}
            onChange={setPassword}
            autoComplete='off'
            aria-label={t('settings.lobster.password')}
          />
        </Form.Item>
        <Form.Item label={t('settings.lobster.keyFile')}>
          <Input
            value={profile.keyFile}
            onChange={(v) => update('keyFile', v)}
            aria-label={t('settings.lobster.keyFile')}
          />
        </Form.Item>
        <div className={styles.columns}>
          <Form.Item label={t('settings.lobster.servicePort')}>
            <InputNumber
              value={profile.httpPort}
              min={1}
              max={65535}
              onChange={(v) => update('httpPort', v)}
              aria-label={t('settings.lobster.servicePort')}
            />
          </Form.Item>
          <Form.Item label={t('settings.lobster.scope')}>
            <Select
              value={profile.scope}
              onChange={(v) => update('scope', v)}
              options={[
                { label: t('settings.lobster.userService'), value: 'user' },
                { label: t('settings.lobster.systemService'), value: 'system' },
              ]}
            />
          </Form.Item>
        </div>
        <Space wrap>
          <Button type='primary' htmlType='submit' loading={busy === 'ssh-connect'}>
            {t('settings.lobster.connectSsh')}
          </Button>
          <Button
            onClick={() => {
              setPassword('');
              void call('ssh-disconnect');
            }}
          >
            {t('settings.lobster.disconnect')}
          </Button>
        </Space>
      </Form>
      {!sshOnly && (
        <>
          <Divider />
          <Typography.Text bold>{t('settings.lobster.gateway')}</Typography.Text>
          <Typography.Text type='secondary'>{state.gateway.detail}</Typography.Text>
          <Space wrap>
            <Button
              type='primary'
              loading={busy === 'gateway-connect'}
              onClick={() => {
                void call('gateway-connect');
              }}
            >
              {t('settings.lobster.connectGateway')}
            </Button>
            <Button
              onClick={() => {
                void call('gateway-disconnect');
              }}
            >
              {t('settings.lobster.disconnect')}
            </Button>
          </Space>
          {state.gateway.pairing?.requestId && (
            <Alert type='warning' content={`${t('settings.lobster.pairing')}: ${state.gateway.pairing.requestId}`} />
          )}
          <Form
            layout='vertical'
            onSubmit={() => {
              const credential = token;
              setToken('');
              void call('gateway-save', { url, token: credential });
            }}
          >
            <Form.Item label={t('settings.lobster.gatewayUrl')}>
              <Input value={url} onChange={setUrl} aria-label={t('settings.lobster.gatewayUrl')} />
            </Form.Item>
            <Form.Item label={t('settings.lobster.gatewayToken')}>
              <Input.Password
                value={token}
                onChange={setToken}
                autoComplete='off'
                aria-label={t('settings.lobster.gatewayToken')}
              />
            </Form.Item>
            <Button htmlType='submit' disabled={busy === 'gateway-connect'}>
              {t('common.save')}
            </Button>
          </Form>
        </>
      )}
    </div>
  );
}
