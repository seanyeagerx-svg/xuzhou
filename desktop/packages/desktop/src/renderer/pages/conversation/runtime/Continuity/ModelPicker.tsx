// Copyright 2026 Xuzhou contributors. SPDX-License-Identifier: Apache-2.0
import React, { useEffect, useState } from 'react';
import { Alert, Button, Empty, Input, Modal, Select, Tag } from '@arco-design/web-react';
import { Brain, Check, Down, Search } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useAcpModelInfo } from '@/renderer/hooks/agent/useAcpModelInfo';
import { useConversationRuntimeView } from '../useConversationRuntimeView';
import { groupModels, providerName } from './models';
import styles from './continuity.module.css';

/** Xuzhou's unified software/model chooser, using the existing confirmed IPC port. */
export default function ModelPicker({
  conversationId,
  initialModelId,
  onRuntimeReadyChange,
}: {
  conversationId: string;
  initialModelId?: string;
  onRuntimeReadyChange?: (ready: boolean) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const runtime = useConversationRuntimeView(conversationId);
  const info = useAcpModelInfo({ conversation_id: conversationId, initialModelId });
  const { model_info: catalog, thoughtLevel, isConfigOptionBlocked } = info;
  const busy = Boolean(runtime.activeTurnId || pending || info.setStatus.state === 'setting');
  const selected = catalog?.available_models.find((model) => model.id === catalog.current_model_id);
  const selectedId = catalog?.current_model_id || '';
  const software = providerName(selectedId.split('/')[0]);
  const groups = groupModels(catalog?.available_models || [], query);
  useEffect(() => {
    onRuntimeReadyChange?.(info.isRuntimeReady);
  }, [info.isRuntimeReady, onRuntimeReadyChange]);
  async function choose(id: string) {
    if (busy || !info.canSwitch || isConfigOptionBlocked('model')) return;
    if (id === selectedId) {
      setOpen(false);
      return;
    }
    setPending(id);
    setError('');
    try {
      await info.setConfigOption('model', id);
      setOpen(false);
      window.dispatchEvent(new CustomEvent('workbench:continuity-changed', { detail: conversationId }));
    } catch {
      setError(t('conversation.continuity.modelFailed'));
    } finally {
      setPending('');
    }
  }
  async function resetPermissions() {
    if (busy || isConfigOptionBlocked('tool_permissions')) return;
    setPending('tool_permissions');
    setError('');
    try {
      await info.setConfigOption('tool_permissions', 'ask');
    } catch {
      setError(t('settings.lobster.permissionResetFailed'));
      setOpen(true);
    } finally {
      setPending('');
    }
  }
  return (
    <>
      <Button
        data-testid='xuzhou-model-picker'
        className={styles.picker}
        loading={Boolean(pending)}
        onClick={() => {
          setQuery('');
          setError('');
          setOpen(true);
        }}
        aria-label={t('conversation.continuity.chooseModel')}
      >
        <Brain size={16} />
        <span>{selected?.label || selectedId || t('conversation.continuity.chooseModel')}</span>
        <Down size={12} />
      </Button>
      {info.toolPermissions === 'remembered' && (
        <Button
          type='text'
          size='small'
          disabled={busy || isConfigOptionBlocked('tool_permissions')}
          onClick={() => void resetPermissions()}
          data-testid='xuzhou-permissions-reset'
        >
          {t('settings.lobster.permissionReset')}
        </Button>
      )}
      <Modal
        visible={open}
        title={t('conversation.continuity.chooseModel')}
        footer={null}
        onCancel={() => {
          if (!pending) setOpen(false);
        }}
        className={styles.modelModal}
        maskClosable={!pending}
      >
        <p className={styles.explanation}>{t('conversation.continuity.switchHint')}</p>
        {error && <Alert type='error' content={error} className='mb-12px' />}
        {runtime.activeTurnId && <Alert type='info' content={t('conversation.continuity.waitForReply')} />}
        <Input
          allowClear
          value={query}
          onChange={setQuery}
          prefix={<Search size={16} />}
          placeholder={t('conversation.continuity.searchModels')}
          aria-label={t('conversation.continuity.searchModels')}
          className='mb-12px'
        />
        <div className={styles.modelGroups} data-testid='xuzhou-model-options'>
          {!groups.length && (
            <Empty
              description={t(
                info.isLoading ? 'conversation.continuity.discovering' : 'conversation.continuity.noModels'
              )}
            />
          )}
          {groups.map((group) => (
            <section key={group.provider} className={styles.modelGroup}>
              <div className={styles.groupHeading}>
                <strong>{group.name || t('common.model')}</strong>
                <span>{group.models.length}</span>
              </div>
              {group.models.map((model) => (
                <Button
                  key={model.id}
                  long
                  type='text'
                  className={styles.modelChoice}
                  disabled={busy || !info.canSwitch || isConfigOptionBlocked('model')}
                  onClick={() => void choose(model.id)}
                  data-model-id={model.id}
                  aria-pressed={model.id === selectedId}
                >
                  <span className={styles.modelText}>
                    <strong>{model.label}</strong>
                    {model.description && <small>{model.description}</small>}
                  </span>
                  {model.id === selectedId && <Check size={16} />}
                </Button>
              ))}
            </section>
          ))}
        </div>
        <div className={styles.effort}>
          <span>{t('agent.thoughtLevel.label')}</span>
          {thoughtLevel?.options.length ? (
            <Select
              aria-label={t('agent.thoughtLevel.label')}
              value={thoughtLevel.currentValue}
              disabled={busy || isConfigOptionBlocked(thoughtLevel.id)}
              options={thoughtLevel.options.map((option) => ({ value: option.value, label: option.label }))}
              onChange={(value) => {
                void info
                  .setConfigOption(thoughtLevel.id, value)
                  .catch(() => setError(t('conversation.continuity.modelFailed')));
              }}
            />
          ) : (
            <Tag>{t('conversation.continuity.providerManaged')}</Tag>
          )}
        </div>
        <p className={styles.explanation}>{t('conversation.continuity.nativeAccounts', { provider: software })}</p>
      </Modal>
    </>
  );
}
