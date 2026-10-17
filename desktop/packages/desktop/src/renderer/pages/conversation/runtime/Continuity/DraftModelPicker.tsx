// Copyright 2026 Xuzhou contributors. SPDX-License-Identifier: Apache-2.0.
import React, { useRef, useState } from 'react';
import { Alert, Button, Empty, Input, Modal, Select, Spin } from '@arco-design/web-react';
import { Brain, Check, Down } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { workspaceCall } from '@/renderer/components/layout/Sider/SiderNav/WorkspacePanel/api';
import { groupModels, type ModelChoice } from './models';
import styles from './continuity.module.css';
type Choice = ModelChoice & { efforts: Array<{ id: string; name: string }> };
type Catalog = { models: Choice[]; errors: Array<{ provider: string; message: string }> };
export default function DraftModelPicker({
  workspace,
  value,
  onChange,
  effort,
  onEffortChange,
}: {
  workspace?: string;
  value: string | null;
  onChange: (value: string) => void;
  effort?: string;
  onEffortChange?: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [catalog, setCatalog] = useState<Catalog>({ models: [], errors: [] }),
    [error, setError] = useState(''),
    [query, setQuery] = useState('');
  const generation = useRef(0);
  async function load(refresh = false) {
    const own = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const result = await workspaceCall<Catalog>('chat-models', { cwd: workspace, refresh });
      if (own === generation.current) setCatalog(result);
    } catch (e) {
      if (own === generation.current) setError(String(e));
    } finally {
      if (own === generation.current) setLoading(false);
    }
  }
  const selected = catalog.models.find((m) => m.id === value);
  return (
    <>
      <Button
        data-testid='guid-model-selector'
        className={styles.picker}
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <Brain size={15} />
        <span>{selected?.label || value || t('conversation.continuity.chooseModel')}</span>
        <Down size={12} />
      </Button>
      <Modal
        visible={open}
        footer={null}
        title={t('conversation.continuity.chooseModel')}
        onCancel={() => setOpen(false)}
        className={styles.modelModal}
      >
        <p>{t('conversation.continuity.switchHint')}</p>
        {error && <Alert type='error' content={error} />}
        <Input
          value={query}
          onChange={setQuery}
          placeholder={t('conversation.continuity.searchModels')}
          aria-label={t('conversation.continuity.searchModels')}
        />
        <Spin loading={loading} style={{ display: 'block', width: '100%' }}>
          <div className={styles.modelGroups} data-testid='xuzhou-model-options'>
            {!catalog.models.length && !loading && <Empty description={t('conversation.continuity.noModels')} />}
            {groupModels(catalog.models, query).map((group) => (
              <section key={group.provider} className={styles.modelGroup}>
                <strong>{group.name}</strong>
                {group.models.map((model) => (
                  <Button
                    key={model.id}
                    long
                    type='text'
                    className={styles.modelChoice}
                    data-model-id={model.id}
                    aria-pressed={model.id === value}
                    onClick={() => {
                      onChange(model.id);
                      onEffortChange?.(catalog.models.find((m) => m.id === model.id)?.efforts[0]?.id || '');
                      setOpen(false);
                    }}
                  >
                    <span>{model.label}</span>
                    {model.id === value && <Check size={15} />}
                  </Button>
                ))}
              </section>
            ))}
          </div>
        </Spin>
        {catalog.errors.map((item) => (
          <Alert key={item.provider} type='warning' content={`${item.provider}: ${item.message}`} />
        ))}
        {selected?.efforts.length ? (
          <Select
            aria-label={t('agent.thoughtLevel.label')}
            value={effort || selected.efforts[0].id}
            options={selected.efforts.map((e) => ({ value: e.id, label: e.name }))}
            onChange={onEffortChange}
          />
        ) : null}
        <Button onClick={() => void load(true)} loading={loading}>
          {t('common.refresh')}
        </Button>
      </Modal>
    </>
  );
}
