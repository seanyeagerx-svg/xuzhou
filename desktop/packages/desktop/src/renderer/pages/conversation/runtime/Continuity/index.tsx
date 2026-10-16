// Copyright 2026 Xuzhou contributors. SPDX-License-Identifier: Apache-2.0
import React, { useState } from 'react';
import { Alert, Button, Drawer, Empty, Switch, Tag } from '@arco-design/web-react';
import { CheckOne, Exchange, History, PauseOne, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { HistorySnapshot } from '@/common/types/platform/workspace';
import { providerName } from './models';
import { useContinuity } from './useContinuity';
import styles from './continuity.module.css';

/** A conversation-level handoff and sync desk, independent of provider settings. */
export default function ContinuityDesk({
  conversationId,
  onSnapshot,
}: {
  conversationId: string;
  onSnapshot?: (value: HistorySnapshot) => void;
}) {
  const { t } = useTranslation(),
    [open, setOpen] = useState(false);
  const { state, error, saving, perform } = useContinuity(conversationId, onSnapshot);
  if (!state?.available && !error) return null;
  const sync = state?.sync,
    active = state?.routes?.find((route) => route.provider === state.activeProvider);
  const attention = Boolean(
    error ||
    [sync?.inbound.state, sync?.outbound.state].some((status) => status === 'conflict' || status === 'retrying')
  );
  const syncLabel = attention
    ? 'attention'
    : !sync
      ? 'local'
      : !sync.enabled
        ? 'paused'
        : attention
          ? 'attention'
          : sync.outbound.state === 'unsupported'
            ? 'partial'
            : [sync.inbound.state, sync.outbound.state].every((status) => status === 'ready')
              ? 'ready'
              : 'pending';
  return (
    <>
      <section
        className={styles.desk}
        data-testid='xuzhou-continuity-desk'
        aria-label={t('conversation.continuity.title')}
      >
        <div className={styles.identity}>
          <span className={styles.brand}>{t('conversation.continuity.brand')}</span>
          <span>{t('conversation.continuity.oneConversation')}</span>
        </div>
        <Button
          type='text'
          className={styles.contextButton}
          onClick={() => setOpen(true)}
          data-testid='xuzhou-context-open'
        >
          <History size={15} />
          <span>{t('conversation.continuity.saved', { count: state?.totalMessages || 0 })}</span>
        </Button>
        <Button
          type='text'
          className={styles.statusButton}
          onClick={() => setOpen(true)}
          data-testid='xuzhou-sync-status'
          status={attention ? 'warning' : undefined}
        >
          {sync && !sync.enabled ? (
            <PauseOne size={15} />
          ) : syncLabel === 'ready' ? (
            <CheckOne size={15} />
          ) : (
            <Exchange size={15} />
          )}
          <span>{t(`conversation.continuity.sync.${syncLabel}`)}</span>
        </Button>
      </section>
      <Drawer
        visible={open}
        title={t('conversation.continuity.title')}
        width='min(440px, 100vw)'
        footer={null}
        onCancel={() => setOpen(false)}
      >
        {error && <Alert type='error' content={error} className='mb-12px' />}
        <section className={styles.detailSection}>
          <h3>{t('conversation.continuity.contextTitle')}</h3>
          <div className={styles.metrics}>
            <strong>{state?.totalMessages || 0}</strong>
            <span>{t('conversation.continuity.historyUnit')}</span>
            <Tag>{providerName(state?.activeProvider) || t('conversation.continuity.preparing')}</Tag>
          </div>
          <p>
            {t(active ? 'conversation.continuity.nextTransfer' : 'conversation.continuity.firstTransfer', {
              count: active?.pendingMessages || 0,
            })}
          </p>
          {state?.contextMode === 'searchable-history' && (
            <Alert type='info' content={t('conversation.continuity.searchable')} />
          )}
          <p className={styles.explanation}>{t('conversation.continuity.visibleOnly')}</p>
        </section>
        {sync && (
          <section className={styles.detailSection}>
            <div className={styles.groupHeading}>
              <h3>{t('conversation.continuity.syncTitle')}</h3>
              <Switch
                checked={sync.enabled}
                loading={saving}
                onChange={(enabled) => void perform('chat-sync-toggle', enabled)}
                aria-label={t('settings.workspace.sync.toggle')}
              />
            </div>
            {(['inbound', 'outbound'] as const).map((direction) => (
              <div key={direction} className={styles.direction} data-testid={'xuzhou-sync-' + direction}>
                <strong>
                  {t(direction === 'inbound' ? 'settings.workspace.sync.inbound' : 'settings.workspace.sync.outbound', {
                    provider: providerName(sync.provider),
                  })}
                </strong>
                <span>{t(`settings.workspace.sync.states.${sync[direction].state}`)}</span>
                {sync[direction].detail && <small>{sync[direction].detail}</small>}
                {sync[direction].lastSuccessAt && (
                  <small>
                    {t('settings.workspace.sync.lastSuccess', {
                      time: new Date(sync[direction].lastSuccessAt).toLocaleString(),
                    })}
                  </small>
                )}
              </div>
            ))}
            <Button
              icon={<Refresh size={14} />}
              loading={saving}
              disabled={!sync.enabled}
              onClick={() => void perform('chat-sync-now')}
              data-testid='xuzhou-sync-now'
            >
              {t('conversation.continuity.checkNow')}
            </Button>
            <p className={styles.explanation}>{t('conversation.continuity.syncHint')}</p>
          </section>
        )}
        <section className={styles.detailSection}>
          <h3>{t('conversation.continuity.receiptsTitle')}</h3>
          {!state?.handoffs?.length && <Empty description={t('conversation.continuity.noReceipts')} />}
          {state?.handoffs
            ?.slice(-8)
            .reverse()
            .map((receipt) => (
              <div className={styles.receipt} key={receipt.id}>
                <div className={styles.groupHeading}>
                  <strong>{providerName(receipt.provider)}</strong>
                  <Tag>
                    {t(
                      receipt.status === 'completed'
                        ? 'conversation.continuity.turnCompleted'
                        : 'conversation.continuity.turnIncomplete'
                    )}
                  </Tag>
                </div>
                <p>{t('conversation.continuity.carried', { count: receipt.historyCount })}</p>
                <small>{new Date(receipt.finishedAt).toLocaleString()}</small>
              </div>
            ))}
        </section>
      </Drawer>
    </>
  );
}
