import React, { useEffect, useState } from 'react';
import { Button, Tooltip } from '@arco-design/web-react';
import { History, Application } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { workspaceCall, showWorkbenchPanel } from './api';
import HistoryBrowser from './HistoryBrowser';
import GrokPane from './GrokPane';
import styles from './WorkspacePanel.module.css';

export default function WorkspacePanel({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation(),
    location = useLocation();
  const [available, setAvailable] = useState(false),
    [panel, setPanel] = useState('');
  useEffect(() => {
    void workspaceCall<{ available: boolean }>('state')
      .then((s) => setAvailable(s.available))
      .catch(() => {});
  }, []);
  useEffect(() => {
    setPanel('');
  }, [location.pathname]);
  useEffect(() => {
    const listener = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== 'workspace') setPanel('');
    };
    window.addEventListener('workbench:panel', listener);
    return () => window.removeEventListener('workbench:panel', listener);
  }, []);
  if (!available) return null;
  const open = (which: string) => {
    showWorkbenchPanel('workspace');
    setPanel(which);
  };
  return (
    <>
      <Tooltip content={t('settings.workspace.history')} position='right'>
        <Button long type='text' className={styles.entry} onClick={() => open('history')} data-testid='history-open'>
          <History />
          {!collapsed && t('settings.workspace.history')}
        </Button>
      </Tooltip>
      <Tooltip content={t('settings.workspace.grok')} position='right'>
        <Button long type='text' className={styles.entry} onClick={() => open('grok')} data-testid='grok-open'>
          <Application />
          {!collapsed && t('settings.workspace.grok')}
        </Button>
      </Tooltip>
      {panel === 'history' && <HistoryBrowser onClose={() => setPanel('')} />}
      {panel === 'grok' && <GrokPane onClose={() => setPanel('')} />}
    </>
  );
}
