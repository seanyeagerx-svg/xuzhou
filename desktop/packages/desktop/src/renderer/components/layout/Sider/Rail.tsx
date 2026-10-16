// Xuzhou contribution, Apache-2.0. Navigation follows conversation -> sources -> operations.
import React from 'react';
import { Button, Tooltip } from '@arco-design/web-react';
import { Add, Control, Message, Robot, Time } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import styles from './Sider.module.css';
export default function XuzhouRail({
  collapsed,
  onNewChat,
  onAssistant,
  onScheduled,
}: {
  collapsed: boolean;
  onNewChat: () => void;
  onAssistant: () => void;
  onScheduled: () => void;
}) {
  const { t } = useTranslation(),
    navigate = useNavigate(),
    { pathname } = useLocation();
  const entries = [
    { id: 'chat', icon: <Add />, action: onNewChat, selected: pathname === '/guid' },
    { id: 'assistant', icon: <Robot />, action: onAssistant, selected: pathname === '/assistants' },
    { id: 'schedule', icon: <Time />, action: onScheduled, selected: pathname === '/scheduled' },
    {
      id: 'control',
      icon: <Control />,
      action: () => {
        void navigate('/settings/workbench');
      },
      selected: pathname === '/settings/workbench',
    },
  ];
  return (
    <section className={styles.xuzhouRail} data-testid='xuzhou-navigation'>
      {!collapsed && (
        <div className={styles.xuzhouCaption}>
          <Message /> {t('settings.xuzhou.navigation')}
        </div>
      )}
      {entries.map((entry) => (
        <Tooltip key={entry.id} content={t(`settings.xuzhou.nav.${entry.id}`)} position='right' disabled={!collapsed}>
          <Button
            long
            type={entry.selected ? 'secondary' : 'text'}
            className={styles.xuzhouEntry}
            onClick={entry.action}
            aria-current={entry.selected ? 'page' : undefined}
          >
            {entry.icon}
            {!collapsed && t(`settings.xuzhou.nav.${entry.id}`)}
          </Button>
        </Tooltip>
      ))}
    </section>
  );
}
