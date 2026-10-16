// Xuzhou contribution, Apache-2.0. Own operations console; never stores recovery keys in the browser.
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Typography,
} from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { workspaceCall } from '@/renderer/components/layout/Sider/SiderNav/WorkspacePanel/api';
import type { WorkspaceAction } from '@/common/types/platform/workspace';
import LobsterPanel from '@/renderer/components/layout/Sider/SiderNav/LobsterPanel';
import styles from './Xuzhou.module.css';
type Snapshot = {
  backup: {
    config: { sources?: string[]; deviceId?: string; enabled?: boolean; intervalMinutes?: number };
    status: { state: string; reason?: string; files?: number };
    volumes: Array<{ id: string; root: string; label: string }>;
    keyLoaded: boolean;
  };
  updates: { config: { url?: string; publicKey?: string }; status: { state: string } };
};
export default function XuzhouConsole() {
  const { t } = useTranslation(),
    navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<Snapshot>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [sources, setSources] = useState(''),
    [deviceId, setDeviceId] = useState<string>(),
    [key, setKey] = useState(''),
    [interval, setInterval] = useState(60),
    [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState(''),
    [publicKey, setPublicKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const exportKey = () => {
    const blob = new Blob([key + '\n'], { type: 'text/plain;charset=utf-8' }),
      link = document.createElement('a'),
      address = URL.createObjectURL(blob);
    link.href = address;
    link.download = 'xuzhou-recovery-key.txt';
    link.click();
    URL.revokeObjectURL(address);
  };
  const refresh = useCallback(async () => {
    const value = await workspaceCall<Snapshot>('operations-state');
    setSnapshot(value);
    return value;
  }, []);
  useEffect(() => {
    let current = true;
    void refresh()
      .then((value) => {
        if (!current) return;
        setSources((value.backup.config.sources || []).join('\n'));
        setDeviceId(value.backup.config.deviceId);
        setEnabled(value.backup.config.enabled || false);
        setInterval(value.backup.config.intervalMinutes || 60);
        setUrl(value.updates.config.url || '');
        setPublicKey(value.updates.config.publicKey || '');
      })
      .catch((e) => {
        if (current) setError(String(e.message));
      });
    return () => {
      current = false;
    };
  }, [refresh]);
  const perform = async (action: WorkspaceAction, data?: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      await workspaceCall(action, data);
      if (action === 'backup-configure') setKey('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.console} data-testid='xuzhou-operations'>
      <header className={styles.hero}>
        <Typography.Title heading={3}>{t('settings.xuzhou.title')}</Typography.Title>
        <Typography.Paragraph>{t('settings.xuzhou.intro')}</Typography.Paragraph>
      </header>
      <Alert type='warning' title={t('settings.xuzhou.betaTitle')} content={t('settings.xuzhou.betaScope')} />
      {error && <Alert type='error' content={error} />}
      <section className={styles.shortcuts}>
        {['agent', 'model', 'webui', 'system', 'appearance', 'about'].map((route) => (
          <Button
            key={route}
            onClick={() => {
              void navigate('/settings/' + route);
            }}
          >
            {t(`settings.xuzhou.${route}`)}
          </Button>
        ))}
      </section>
      <Card title={t('settings.xuzhou.connections')}>
        <Typography.Paragraph>{t('settings.xuzhou.providerScope')}</Typography.Paragraph>
        <Space wrap>
          <LobsterPanel collapsed={false} />
          <Button
            onClick={() => {
              void refresh().catch((e) => setError(String(e.message)));
            }}
          >
            {t('settings.xuzhou.refresh')}
          </Button>
        </Space>
      </Card>
      <Card title={t('settings.xuzhou.backup')}>
        <div className={styles.form}>
          <Alert type='info' content={t('settings.xuzhou.backupHint')} />
          {snapshot && !snapshot.backup.volumes.length && (
            <Alert type='warning' content={t('settings.xuzhou.noDisk')} />
          )}
          <Select
            aria-label={t('settings.xuzhou.disk')}
            placeholder={t('settings.xuzhou.disk')}
            value={deviceId}
            onChange={setDeviceId}
            options={(snapshot?.backup.volumes || []).map((device) => ({
              value: device.id,
              label: device.root + ' ' + device.label,
            }))}
          />
          <Input.TextArea
            aria-label={t('settings.xuzhou.sources')}
            placeholder={t('settings.xuzhou.sources')}
            value={sources}
            onChange={setSources}
            autoSize={{ minRows: 2, maxRows: 5 }}
          />
          <Input.Password
            aria-label={t('settings.xuzhou.key')}
            placeholder={t('settings.xuzhou.key')}
            value={key}
            onChange={(value) => {
              setKey(value);
              setKeySaved(false);
            }}
            autoComplete='off'
          />
          <Space wrap>
            <Button
              onClick={() => {
                const bytes = crypto.getRandomValues(new Uint8Array(32));
                setKey(Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''));
                setKeySaved(false);
              }}
            >
              {t('settings.xuzhou.generateKey')}
            </Button>
            <Button disabled={!key} onClick={exportKey}>
              {t('settings.xuzhou.exportKey')}
            </Button>
            <Checkbox checked={keySaved} onChange={setKeySaved}>
              {t('settings.xuzhou.keySaved')}
            </Checkbox>
          </Space>
          <Space>
            <Typography.Text>{t('settings.xuzhou.interval')}</Typography.Text>
            <InputNumber min={15} max={10080} value={interval} onChange={setInterval} />
            <Switch checked={enabled} onChange={setEnabled} aria-label={t('settings.xuzhou.enable')} />
          </Space>
          <Space>
            <Button
              disabled={busy || !deviceId || (enabled && !keySaved)}
              onClick={() => {
                void perform('backup-configure', {
                  sources: sources
                    .split(/\r?\n/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                  deviceId,
                  key,
                  intervalMinutes: interval,
                  enabled,
                });
              }}
            >
              {t('settings.xuzhou.save')}
            </Button>
            <Button
              disabled={busy || !snapshot?.backup.keyLoaded || !snapshot.backup.config.enabled}
              onClick={() => {
                void perform('backup-run');
              }}
            >
              {t('settings.xuzhou.run')}
            </Button>
          </Space>
          <Typography.Text type='secondary'>
            {t('settings.xuzhou.status')}:{' '}
            {snapshot ? t(`settings.xuzhou.states.${snapshot.backup.status.state}`) : '—'}{' '}
            {snapshot?.backup.status.reason || ''}
          </Typography.Text>
        </div>
      </Card>
      <Card title={t('settings.xuzhou.updates')}>
        <div className={styles.form}>
          <Alert type='info' content={t('settings.xuzhou.updateHint')} />
          <Typography.Text>
            {t('settings.xuzhou.status')}:{' '}
            {snapshot ? t(`settings.xuzhou.states.${snapshot.updates.status.state}`) : '—'}
          </Typography.Text>
          <Button
            disabled={busy || !snapshot?.updates.config.url}
            onClick={() => {
              void perform('update-check-own');
            }}
          >
            {t('settings.xuzhou.check')}
          </Button>
          <Collapse>
            <Collapse.Item name='channel' header={t('settings.xuzhou.advanced')}>
              <div className={styles.form}>
                <Input
                  aria-label={t('settings.xuzhou.manifestUrl')}
                  placeholder={t('settings.xuzhou.manifestUrl')}
                  value={url}
                  onChange={setUrl}
                />
                <Input.TextArea
                  aria-label={t('settings.xuzhou.publicKey')}
                  placeholder={t('settings.xuzhou.publicKey')}
                  value={publicKey}
                  onChange={setPublicKey}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                />
                <Button
                  disabled={busy || !url || !publicKey}
                  onClick={() => {
                    void perform('update-configure', { url, publicKey });
                  }}
                >
                  {t('settings.xuzhou.save')}
                </Button>
              </div>
            </Collapse.Item>
          </Collapse>
        </div>
      </Card>
    </div>
  );
}
