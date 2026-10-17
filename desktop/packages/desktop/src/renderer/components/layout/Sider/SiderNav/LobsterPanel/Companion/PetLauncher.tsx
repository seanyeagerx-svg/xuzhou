// Copyright 2026 Xuzhou contributors. SPDX-License-Identifier: Apache-2.0
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Badge, Button, Popover, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { LobsterState } from '@/common/types/platform/lobster';
import { activityRows, activityStatusKey } from '../Activity/rows';
import Art from './Art';
import styles from './Companion.module.css';

type Position = { x: number; y: number };
const clamp = (position: Position): Position => ({
  x: Math.max(4, Math.min(position.x, window.innerWidth - 108)),
  y: Math.max(40, Math.min(position.y, window.innerHeight - 108)),
});
function initialPosition(): Position {
  try {
    const saved = JSON.parse(localStorage.getItem('workbench:lobster-position') || 'null');
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return clamp(saved);
  } catch {
    /* A stale layout preference must not hide the pet. */
  }
  return clamp({ x: window.innerWidth - 128, y: window.innerHeight - 216 });
}

export default function PetLauncher({
  state,
  projectId,
  conversationId,
  contextTitle,
  onOpen,
}: {
  state: LobsterState;
  projectId: string;
  conversationId: string;
  contextTitle: string;
  onOpen: (tab: string) => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState(false),
    [position, setPosition] = useState(initialPosition);
  const [seen, setSeen] = useState('');
  const drag = useRef<{ start: Position; origin: Position; moved: boolean } | null>(null);
  const ignoreClick = useRef(false);
  const project = state.projects?.find((item) => item.id === projectId);
  const rows = state.available ? activityRows(state, projectId) : [];
  const latest = rows[0];
  const waiting = state.approvals?.filter((item) => item.projectId === projectId).length || 0;
  const unread = Boolean(latest && latest.id + ':' + latest.status !== seen);
  const pose =
    waiting || latest?.error
      ? 'error'
      : latest?.status === 'running'
        ? 'thinking'
        : unread
          ? 'notify'
          : menu
            ? 'wave'
            : 'idle';
  const open = (tab: string) => {
    setMenu(false);
    if (latest) {
      const value = latest.id + ':' + latest.status;
      setSeen(value);
      localStorage.setItem('workbench:lobster-seen:' + projectId, value);
    }
    onOpen(tab);
  };
  useEffect(() => {
    setMenu(false);
    setSeen(localStorage.getItem('workbench:lobster-seen:' + projectId) || '');
  }, [projectId]);
  useEffect(() => {
    const resize = () => setPosition((current) => clamp(current));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const status = waiting
    ? t('settings.companion.needsAttention')
    : latest
      ? t(`settings.lobster.${activityStatusKey(latest)}`)
      : t('settings.lobster.petHint');
  return createPortal(
    <aside className={styles.floating} style={{ left: position.x, top: position.y }} data-testid='lobster-pet'>
      {latest && (
        <Button
          type='secondary'
          className={`${styles.liveNote} ${position.x < 240 ? styles.noteRight : ''}`}
          onClick={() => open('activity')}
          data-testid='lobster-live-activity'
        >
          <strong>
            {latest.sender === 'openclaw' ? t('settings.lobster.title') : latest.sender} · {status}
          </strong>
          <span>{latest.text || latest.title || t('settings.lobster.replying')}</span>
        </Button>
      )}
      <Popover
        trigger='click'
        position='tl'
        triggerProps={{ className: styles.petPopup }}
        popupVisible={menu}
        onVisibleChange={(value) => {
          if (!ignoreClick.current) {
            if (value) window.dispatchEvent(new CustomEvent('workbench:panel', { detail: 'pet-menu' }));
            setMenu(value);
          }
        }}
        content={
          <div className={styles.petMenu} data-testid='lobster-pet-menu'>
            <Typography.Text bold>{contextTitle || project?.name || t('settings.companion.title')}</Typography.Text>
            <Typography.Text type='secondary'>{t('settings.lobster.petDragHint')}</Typography.Text>
            <Button onClick={() => open('activity')} data-testid='lobster-pet-activity'>
              {t('settings.lobster.activity')}
            </Button>
            <Button onClick={() => open('sync')} data-testid='lobster-pet-sync'>
              {t('settings.lobster.petChat')}
            </Button>
            <Button
              disabled={!conversationId}
              onClick={() => {
                setMenu(false);
                window.dispatchEvent(new CustomEvent('workbench:companion-open', { detail: conversationId }));
              }}
              data-testid='lobster-pet-listen'
            >
              {t('settings.lobster.petListen')}
            </Button>
            <Button onClick={() => open('maintenance')}>{t('settings.lobster.maintenance')}</Button>
            <Button onClick={() => open('connection')}>{t('settings.lobster.connection')}</Button>
          </div>
        }
      >
        <Button
          type='text'
          className={styles.floatingPet}
          aria-label={t('settings.lobster.petOpen')}
          aria-expanded={menu}
          data-testid='lobster-pet-open'
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            ignoreClick.current = false;
            drag.current = { start: { x: event.clientX, y: event.clientY }, origin: position, moved: false };
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={(event) => {
            const current = drag.current;
            if (!current) return;
            const dx = event.clientX - current.start.x,
              dy = event.clientY - current.start.y;
            if (Math.abs(dx) + Math.abs(dy) > 6) current.moved = true;
            if (current.moved) {
              setMenu(false);
              ignoreClick.current = true;
              setPosition(clamp({ x: current.origin.x + dx, y: current.origin.y + dy }));
            }
          }}
          onPointerUp={() => {
            if (drag.current?.moved) localStorage.setItem('workbench:lobster-position', JSON.stringify(position));
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
            ignoreClick.current = false;
          }}
          onKeyDown={() => {
            ignoreClick.current = false;
          }}
        >
          <Badge count={waiting || (unread ? 1 : 0)}>
            <Art pose={pose} />
          </Badge>
          <span className={styles.petName}>{t('settings.companion.title')}</span>
        </Button>
      </Popover>
    </aside>,
    document.body
  );
}
