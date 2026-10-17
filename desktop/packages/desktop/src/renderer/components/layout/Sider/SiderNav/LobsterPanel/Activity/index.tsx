// Copyright 2026 Xuzhou contributors. SPDX-License-Identifier: Apache-2.0
import React from 'react';
import { Alert, Card, Empty, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { LobsterControls } from '../useLobster';
import { activityRows, activityStatusKey } from './rows';
import styles from '../LobsterPanel.module.css';

export default function Activity({ controls, projectId }: { controls: LobsterControls; projectId: string }) {
  const { t } = useTranslation();
  if (!controls.state?.available) return null;
  const rows = activityRows(controls.state, projectId);
  return (
    <section className={styles.stack} data-testid='lobster-activity'>
      <Typography.Paragraph type='secondary'>{t('settings.lobster.activityHint')}</Typography.Paragraph>
      {!rows.length && <Empty description={t('settings.lobster.activityEmpty')} />}
      {rows.map((row) => (
        <Card key={row.id} size='small' data-testid='lobster-activity-row'>
          <div className={styles.row}>
            <Typography.Text bold>
              {row.sender === 'openclaw'
                ? t('settings.lobster.title')
                : row.sender === 'user'
                  ? t('settings.lobster.you')
                  : row.sender === 'maintenance'
                    ? t('settings.lobster.repairChannel')
                    : row.sender}
            </Typography.Text>
            <Tag
              color={row.status === 'delivered' || row.status === 'completed' ? 'green' : row.error ? 'red' : 'gray'}
            >
              {t(`settings.lobster.${activityStatusKey(row)}`)}
            </Tag>
          </div>
          <Typography.Text type='secondary'>
            {row.title ||
              t(row.sender === 'openclaw' ? 'settings.lobster.activityReply' : 'settings.lobster.activitySent')}{' '}
            · {new Date(row.time).toLocaleString()}
          </Typography.Text>
          <Typography.Paragraph className={styles.output} ellipsis={{ rows: 4, expandable: true }}>
            {row.text || (row.status === 'running' ? t('settings.lobster.replying') : '')}
          </Typography.Paragraph>
          {row.receipt && (
            <Typography.Text className={styles.path}>
              {t('settings.lobster.receipt')}: {row.receipt}
            </Typography.Text>
          )}
          {row.error && <Alert type='error' content={row.error} />}
        </Card>
      ))}
    </section>
  );
}
