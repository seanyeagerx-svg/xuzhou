import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Input, Spin } from '@arco-design/web-react';
import { FolderClose, Right, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import type { NativeCodexCatalog, NativeHistoryItem } from '@/common/types/platform/workspace';
import { emitter } from '@/renderer/utils/emitter';
import { workspaceCall } from '../api';
import { useNativeCatalog } from './useNativeCatalog';
import styles from './NativeChats.module.css';

export function nativeGroups(catalog: NativeCodexCatalog, query: string, freeName: string) {
  const groups = new Map(catalog.projects.map((p) => [p.id, { ...p, items: [] as NativeHistoryItem[] }]));
  const keyPath = (s: string) => s.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  for (const item of catalog.items) {
    // An explicit null projectId is a free chat, even if cwd matches a project.
    const fallback =
      item.projectId === undefined
        ? catalog.projects.find((p) => p.roots.some((r) => keyPath(r) === keyPath(item.cwd)))?.id
        : undefined;
    const key =
      item.projectId || fallback || (item.projectId === undefined && item.cwd ? 'cwd:' + keyPath(item.cwd) : 'free');
    if (!groups.has(key))
      groups.set(key, {
        id: key,
        name: key === 'free' ? freeName : item.cwd.split(/[\\/]/).filter(Boolean).at(-1) || item.cwd || freeName,
        roots: item.cwd ? [item.cwd] : [],
        items: [],
      });
    groups.get(key)!.items.push(item);
  }
  const needle = query.trim().toLowerCase();
  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: group.items
        .filter(
          (item) =>
            !needle || [group.name, ...group.roots, item.title, item.cwd].some((s) => s.toLowerCase().includes(needle))
        )
        .sort((a, b) => b.updatedAt - a.updatedAt),
    }))
    .filter(
      (group) =>
        !needle || group.items.length || [group.name, ...group.roots].some((s) => s.toLowerCase().includes(needle))
    )
    .sort((a, b) => (b.items[0]?.updatedAt || 0) - (a.items[0]?.updatedAt || 0));
}

export default function NativeChats({
  collapsed,
  onSessionClick,
  onBindings,
}: {
  collapsed?: boolean;
  onSessionClick?: () => void;
  onBindings: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { available, catalog, error, loading, refresh, bind } = useNativeCatalog();
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [opening, setOpening] = useState<string>();
  const [openError, setOpenError] = useState('');
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const groups = useMemo(
    () => (catalog ? nativeGroups(catalog, query, t('settings.workspace.native.free')) : []),
    [catalog, query, t]
  );
  useEffect(() => {
    onBindings(catalog ? catalog.items.map((item) => catalog.bindings[item.id]).filter(Boolean) : []);
  }, [catalog, onBindings]);
  async function open(item: NativeHistoryItem) {
    if (pending.current) return;
    pending.current = true;
    setOpening(item.id);
    setOpenError('');
    try {
      const result = await workspaceCall<{ conversationId: string }>('codex-open', { id: item.id });
      if (!mounted.current) return;
      bind(item.id, result.conversationId);
      emitter.emit('chat.history.refresh');
      void navigate('/conversation/' + result.conversationId);
      onSessionClick?.();
    } catch (e) {
      if (mounted.current) setOpenError(String(e));
    } finally {
      pending.current = false;
      if (mounted.current) setOpening(undefined);
    }
  }
  if (collapsed || !available) return null;
  return (
    <section className={styles.section} data-testid='native-codex-chats'>
      <div className={styles.heading}>
        <Button type='text' onClick={() => setClosed((v) => !v)} aria-expanded={!closed}>
          <Right size={12} className={closed ? '' : 'rotate-90'} />
          {t('settings.workspace.native.title')}
          {catalog && <span className={styles.count}>{catalog.items.length}</span>}
        </Button>
        <Button
          type='text'
          size='mini'
          icon={<Refresh size={13} />}
          aria-label={t('settings.workspace.refresh')}
          loading={loading}
          onClick={() => void refresh()}
        />
      </div>
      {!closed && (
        <>
          <Input
            size='small'
            allowClear
            value={query}
            onChange={setQuery}
            placeholder={t('settings.workspace.search')}
            className='mb-6px'
          />
          {error && <Alert type='error' content={error} />}
          {openError && <Alert type='error' content={openError} closable onClose={() => setOpenError('')} />}
          {catalog?.projectWarning && <Alert type='warning' content={catalog.projectWarning} />}
          {catalog?.catalogWarning && <Alert type='warning' content={catalog.catalogWarning} />}
          {catalog?.loading && <div className={styles.hint}>{t('settings.workspace.native.loading')}</div>}
          {!catalog && loading && <Spin loading />}
          {catalog && !groups.length && <div className={styles.hint}>{t('settings.workspace.noHistory')}</div>}
          {groups.map((group, index) => {
            const active = group.items.some((item) => catalog?.bindings[item.id] === id);
            const isOpen = query.length > 0 || (expanded[group.id] ?? (active || index === 0));
            const limit = limits[group.id] || 6;
            return (
              <div key={group.id}>
                <Button
                  type='text'
                  className={styles.project}
                  title={group.roots.join('\n')}
                  aria-expanded={isOpen}
                  onClick={() => setExpanded((old) => ({ ...old, [group.id]: !isOpen }))}
                >
                  <Right size={10} className={isOpen ? 'rotate-90' : ''} />
                  <FolderClose size={14} />
                  <span className={styles.label}>{group.name}</span>
                  <span className={styles.count}>{group.items.length}</span>
                </Button>
                {isOpen && (
                  <>
                    {!group.items.length && (
                      <div className={styles.hint}>{t('settings.workspace.native.emptyProject')}</div>
                    )}
                    {group.items.slice(0, limit).map((item) => (
                      <Button
                        type='text'
                        key={item.id}
                        className={styles.chat}
                        data-selected={catalog?.bindings[item.id] === id}
                        data-native-id={item.id}
                        title={item.title + '\n' + item.cwd}
                        disabled={!!opening}
                        loading={opening === item.id}
                        onClick={() => void open(item)}
                      >
                        <span className={styles.label}>{item.title}</span>
                      </Button>
                    ))}
                    {group.items.length > limit && (
                      <Button
                        type='text'
                        size='mini'
                        className='ms-24px'
                        onClick={() => setLimits((old) => ({ ...old, [group.id]: limit + 20 }))}
                      >
                        {t('settings.workspace.more')}
                      </Button>
                    )}
                  </>
                )}
              </div>
            );
          })}
          <div className={styles.hint}>{t('settings.workspace.native.hint')}</div>
        </>
      )}
    </section>
  );
}
