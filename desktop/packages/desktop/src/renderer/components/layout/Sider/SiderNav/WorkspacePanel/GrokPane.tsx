import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, Space } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { GrokState } from '@/common/types/platform/workspace';
import { workspaceCall } from './api';
import styles from './WorkspacePanel.module.css';

export default function GrokPane({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const viewport = useRef<HTMLDivElement>(null),
    active = useRef(true);
  const [state, setState] = useState<GrokState>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const bounds = () => {
    const r = viewport.current?.getBoundingClientRect();
    return r && { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  async function show() {
    const rect = bounds();
    if (!rect || rect.width < 1 || rect.height < 1) return;
    setBusy(true);
    setError('');
    try {
      const result = await workspaceCall<GrokState>('grok-open', { bounds: rect });
      if (active.current) setState(result);
      else await workspaceCall('grok-hide');
    } catch (e) {
      if (active.current) setError(String(e));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  useEffect(() => {
    active.current = true;
    const observer = new ResizeObserver(() => {
      const rect = bounds();
      if (rect) void workspaceCall('grok-layout', { bounds: rect }).catch(() => {});
    });
    if (viewport.current) observer.observe(viewport.current);
    return () => {
      active.current = false;
      observer.disconnect();
      void workspaceCall('grok-hide').catch(() => {});
    };
  }, []);
  return (
    <Drawer
      visible
      title={t('settings.workspace.grok')}
      width='calc(100vw - 250px)'
      mask={false}
      footer={null}
      onCancel={onClose}
      afterOpen={() => void show()}
      unmountOnExit
    >
      <div className={styles.grokBody}>
        <Alert type='info' content={t('settings.workspace.grokHint')} />
        <Space>
          <Button loading={busy} onClick={() => void show()}>
            {t('settings.workspace.reconnect')}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void workspaceCall<GrokState>('grok-choose')
                .then((value) => {
                  setState(value);
                  if (value.installed) void show();
                })
                .catch((e) => setError(String(e)))
            }
          >
            {t('settings.workspace.chooseGrok')}
          </Button>
          <span>{state?.attached ? t('settings.workspace.attached') : ''}</span>
        </Space>
        {error && <Alert type='error' content={error} />}
        <div className={styles.nativeViewport} ref={viewport} data-testid='grok-viewport' />
      </div>
    </Drawer>
  );
}
