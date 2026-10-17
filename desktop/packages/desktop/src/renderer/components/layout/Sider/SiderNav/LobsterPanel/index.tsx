// Modified for Xuzhou, 2026-10-16: unavailable startup status must not crash the sidebar.
import React, { useEffect, useState } from 'react';
import { Alert, Badge, Button, Drawer, Select, Space, Tabs, Tag, Tooltip, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { ipcBridge } from '@/common';
import { useLobster } from './useLobster';
import SyncPane from './SyncPane';
import MaintenancePane from './MaintenancePane';
import ConnectionForm from './ConnectionForm';
import Activity from './Activity';
import PetLauncher from './Companion/PetLauncher';
import LobsterCompanion from './Companion';
import styles from './LobsterPanel.module.css';

export default function LobsterPanel({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(() => localStorage.getItem('workbench:lobster-open') === 'true'),
    [projectId, setProjectId] = useState(() => localStorage.getItem('workbench:lobster-project') || '');
  const controls = useLobster(projectId),
    { state, call, error } = controls;
  const [tab, setTab] = useState(() => localStorage.getItem('workbench:lobster-tab') || 'sync');
  useEffect(() => {
    const listener = (e: Event) => {
      setOpen((e as CustomEvent<string>).detail === 'lobster');
    };
    window.addEventListener('workbench:panel', listener);
    return () => window.removeEventListener('workbench:panel', listener);
  }, []);
  useEffect(() => {
    const listener = (e: Event) => {
      const value = (e as CustomEvent<string>).detail;
      if (['activity', 'sync', 'maintenance', 'connection'].includes(value)) setTab(value);
    };
    window.addEventListener('workbench:lobster-tab', listener);
    return () => window.removeEventListener('workbench:lobster-tab', listener);
  }, []);
  useEffect(() => {
    localStorage.setItem('workbench:lobster-open', String(open));
  }, [open]);
  useEffect(() => {
    localStorage.setItem('workbench:lobster-project', projectId);
  }, [projectId]);
  useEffect(() => {
    localStorage.setItem('workbench:lobster-tab', tab);
  }, [tab]);
  const [workspace, setWorkspace] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [contextTitle, setContextTitle] = useState('');
  const location = useLocation();
  useEffect(() => {
    let current = true;
    const id = location.pathname.match(/\/conversation\/([^/]+)/)?.[1];
    const teamId = location.pathname.match(/\/team\/([^/]+)/)?.[1];
    setWorkspace('');
    setConversationId('');
    setContextTitle('');
    if (id || teamId) setProjectId('');
    if (teamId) {
      void ipcBridge.team.get
        .invoke({ id: teamId })
        .then((team) => {
          if (!current) return;
          setWorkspace(team?.workspace || '');
          setContextTitle(team?.name || '');
          setConversationId(team?.assistants.find((member) => member.role === 'leader')?.conversation_id || '');
        })
        .catch(() => {});
    } else if (id)
      void ipcBridge.conversation.get
        .invoke({ id })
        .then((c) => {
          if (current) {
            setWorkspace(c?.extra?.workspace || '');
            setConversationId(id);
            setContextTitle(c?.name || '');
          }
        })
        .catch(() => {});
    return () => {
      current = false;
    };
  }, [location.pathname]);
  useEffect(() => {
    if (!state?.available) return;
    const matching = state.projects.find(
      (p) =>
        p.root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() ===
        workspace.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    );
    if (matching) setProjectId(matching.id);
    else if (workspace) setProjectId('');
    else if (!/\/(?:conversation|team)\//.test(location.pathname))
      setProjectId((current) => (state.projects.some((p) => p.id === current) ? current : state.projects[0]?.id || ''));
  }, [workspace, location.pathname, state?.projects?.map((p) => p.id).join(',')]);
  if (!state || (!state.available && !state.error)) return null;
  const selected = state.projects?.find((p) => p.id === projectId);
  return (
    <>
      <PetLauncher
        state={state}
        projectId={projectId}
        conversationId={conversationId}
        contextTitle={contextTitle}
        onOpen={(value) => {
          setTab(value);
          window.dispatchEvent(new CustomEvent('workbench:panel', { detail: 'lobster' }));
          setOpen(true);
        }}
      />
      {conversationId && <LobsterCompanion key={conversationId} conversationId={conversationId} showLauncher={false} />}
      <Tooltip content={t('settings.lobster.title')} position='right'>
        <Button
          type='text'
          long
          className={styles.entry}
          onClick={() => {
            window.dispatchEvent(new CustomEvent('workbench:panel', { detail: 'lobster' }));
            setOpen(true);
          }}
          data-testid='lobster-open'
        >
          <Badge count={state.approvals?.length || 0}>
            <span aria-hidden>🦞</span>
          </Badge>
          {!collapsed && <span>{t('settings.lobster.title')}</span>}
        </Button>
      </Tooltip>
      <Drawer
        visible={open}
        onCancel={() => setOpen(false)}
        title={t('settings.lobster.title')}
        width='min(640px, 100vw)'
        footer={null}
        mask={false}
        className={styles.drawer}
      >
        {error && <Alert type='error' content={error} />}
        {!state.available ? (
          <Alert type='error' content={state.error} />
        ) : (
          <div className={styles.stack}>
            <Typography.Paragraph type='secondary'>{t('settings.lobster.intro')}</Typography.Paragraph>
            <Select
              aria-label={t('settings.lobster.project')}
              value={projectId}
              onChange={setProjectId}
              options={state.projects.map((p) => ({ label: p.name, value: p.id }))}
            />
            <Typography.Text type='secondary' className={styles.path}>
              {selected?.root}
            </Typography.Text>
            <Space wrap>
              <Tag color={state.gateway.state === 'connected' ? 'green' : 'gray'}>
                {t('settings.lobster.gateway')} ·{' '}
                {state.gateway.state === 'connected' ? t('settings.lobster.connected') : t('settings.lobster.offline')}
              </Tag>
              <Tag color={state.maintenance.ready ? 'green' : 'gray'}>
                {t('settings.lobster.repairChannel')} ·{' '}
                {state.maintenance.ready ? t('settings.lobster.connected') : t('settings.lobster.offline')}
              </Tag>
            </Space>
            {state.approvals
              .filter((a) => a.projectId === projectId)
              .map((a) => (
                <Alert
                  key={a.id}
                  type='warning'
                  title={`${a.agentId} · ${a.title}`}
                  content={
                    <div className={styles.stack}>
                      <Typography.Text>{state.projects.find((p) => p.id === a.projectId)?.name}</Typography.Text>
                      <pre className={styles.output}>{JSON.stringify(a.details, null, 2)}</pre>
                      <Space>
                        <Button
                          type='primary'
                          onClick={() => {
                            void call('decision', { id: a.id, allow: true });
                          }}
                        >
                          {t('settings.lobster.allowOnce')}
                        </Button>
                        <Button
                          onClick={() => {
                            void call('decision', { id: a.id, allow: false });
                          }}
                        >
                          {t('settings.lobster.deny')}
                        </Button>
                      </Space>
                    </div>
                  }
                />
              ))}
            <Tabs activeTab={tab} onChange={setTab} destroyOnHide={false}>
              <Tabs.TabPane key='activity' title={t('settings.lobster.activity')}>
                <Activity controls={controls} projectId={projectId} />
              </Tabs.TabPane>
              <Tabs.TabPane key='sync' title={t('settings.lobster.sync')}>
                <SyncPane controls={controls} projectId={projectId} />
              </Tabs.TabPane>
              <Tabs.TabPane key='maintenance' title={t('settings.lobster.maintenance')}>
                <MaintenancePane controls={controls} projectId={projectId} />
              </Tabs.TabPane>
              <Tabs.TabPane key='connection' title={t('settings.lobster.connection')}>
                <ConnectionForm controls={controls} visible={open} />
              </Tabs.TabPane>
            </Tabs>
          </div>
        )}
      </Drawer>
    </>
  );
}
