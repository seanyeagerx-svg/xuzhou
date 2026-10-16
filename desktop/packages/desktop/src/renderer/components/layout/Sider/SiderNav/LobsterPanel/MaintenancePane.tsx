import React, { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  InputNumber,
  Modal,
  Space,
  Tag,
  Typography,
} from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { LobsterControls } from './useLobster';
import styles from './LobsterPanel.module.css';

export default function MaintenancePane({ controls, projectId }: { controls: LobsterControls; projectId: string }) {
  const { t } = useTranslation(),
    { state, call, busy } = controls;
  const [compact, setCompact] = useState(false),
    [heap, setHeap] = useState<number | undefined>();
  if (!state?.available) return null;
  const profile = state.maintenance.profile,
    diagnosis = state.diagnosis?.projectId === projectId ? state.diagnosis : null;
  const labels: Record<string, string> = {
    service: t('settings.lobster.service'),
    ready: t('settings.lobster.readiness'),
    logs: t('settings.lobster.logs'),
    disk: t('settings.lobster.disk'),
    memory: t('settings.lobster.memory'),
  };
  const confirm = (action: 'start' | 'recover') =>
    Modal.confirm({
      title: action === 'start' ? t('settings.lobster.start') : t('settings.lobster.recover'),
      content: (
        <div className={styles.stack}>
          <Typography.Text bold>
            {profile.username}@{profile.host}:{profile.port}
          </Typography.Text>
          <Typography.Paragraph>
            {action === 'start' ? t('settings.lobster.startHint') : t('settings.lobster.recoverHint')}
          </Typography.Paragraph>
          {action === 'recover' && (
            <Typography.Text>
              {t('settings.lobster.compact')}: {compact ? t('settings.lobster.yes') : t('settings.lobster.no')} ·{' '}
              {t('settings.lobster.heap')}: {heap || t('settings.lobster.keep')}
            </Typography.Text>
          )}
        </div>
      ),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        await call('maintenance', {
          projectId,
          action,
          compactDatabase: action === 'recover' && compact,
          heapMiB: action === 'recover' ? (heap ?? null) : null,
          generation: state.maintenance.generation,
        });
      },
    });
  return (
    <div className={styles.stack}>
      <Typography.Paragraph type='secondary'>{t('settings.lobster.maintenanceHint')}</Typography.Paragraph>
      <Typography.Text bold>
        {profile.username}@{profile.host}:{profile.port}
      </Typography.Text>
      {!state.maintenance.ready && <Alert type='info' content={t('settings.lobster.loginFirst')} />}
      <Space wrap>
        <Button
          type='primary'
          disabled={!projectId || !state.maintenance.ready}
          loading={busy === 'maintenance'}
          onClick={() => {
            void call('maintenance', { projectId, action: 'diagnose' });
          }}
        >
          {t('settings.lobster.diagnose')}
        </Button>
        <Button disabled={!projectId || !state.maintenance.ready} onClick={() => confirm('start')}>
          {t('settings.lobster.start')}
        </Button>
      </Space>
      {diagnosis && (
        <Card
          size='small'
          title={t('settings.lobster.diagnosis')}
          extra={<Typography.Text type='secondary'>{new Date(diagnosis.at).toLocaleString()}</Typography.Text>}
        >
          <Typography.Text type='secondary'>{diagnosis.profile.host}</Typography.Text>
          <Collapse>
            {Object.entries(diagnosis.result).map(([key, value]) => (
              <Collapse.Item key={key} name={key} header={labels[key] || key}>
                <pre className={styles.output}>{value.output || value.error}</pre>
              </Collapse.Item>
            ))}
          </Collapse>
        </Card>
      )}
      <Collapse>
        <Collapse.Item name='recover' header={t('settings.lobster.recover')}>
          <div className={styles.stack}>
            <Typography.Paragraph type='secondary'>{t('settings.lobster.recoverHint')}</Typography.Paragraph>
            <Checkbox checked={compact} onChange={setCompact}>
              {t('settings.lobster.compact')}
            </Checkbox>
            <InputNumber
              aria-label={t('settings.lobster.heap')}
              placeholder={t('settings.lobster.heap')}
              min={128}
              max={16384}
              value={heap}
              onChange={setHeap}
              suffix='MiB'
            />
            <Button
              status='warning'
              disabled={!projectId || !state.maintenance.ready}
              onClick={() => confirm('recover')}
            >
              {t('settings.lobster.recover')}
            </Button>
          </div>
        </Collapse.Item>
      </Collapse>
      <Typography.Text bold>{t('settings.lobster.jobs')}</Typography.Text>
      {state.jobs
        .filter((j) => j.projectId === projectId)
        .map((job) => (
          <Card key={job.id} size='small'>
            <div className={styles.stack}>
              <div className={styles.row}>
                <Typography.Text>
                  {job.action === 'start' ? t('settings.lobster.start') : t('settings.lobster.recover')}
                </Typography.Text>
                <Tag color={job.state === 'completed' ? 'green' : job.state === 'running' ? 'blue' : 'red'}>
                  {job.state === 'completed'
                    ? t('settings.lobster.completed')
                    : job.state === 'running'
                      ? t('settings.lobster.running')
                      : t('settings.lobster.failed')}
                </Tag>
              </div>
              <Typography.Text type='secondary'>
                {job.host} · {new Date(job.startedAt * 1000).toLocaleString()}
              </Typography.Text>
              <Typography.Text className={styles.path}>{job.id}</Typography.Text>
              {job.verification && (
                <Typography.Text>
                  {t('settings.lobster.service')}: {job.verification.service?.ActiveState} /{' '}
                  {job.verification.service?.SubState} · {t('settings.lobster.readiness')}:{' '}
                  {job.verification.readiness?.ready ? t('settings.lobster.yes') : t('settings.lobster.no')}
                </Typography.Text>
              )}
              {(job.error || job.connectionError) && (
                <Alert type='warning' content={job.error || job.connectionError} />
              )}
              <Button
                size='small'
                disabled={!state.maintenance.ready}
                loading={busy === 'job'}
                onClick={() => {
                  void call('job', { projectId, jobId: job.id });
                }}
              >
                {t('settings.lobster.checkJob')}
              </Button>
            </div>
          </Card>
        ))}
      <Typography.Paragraph type='secondary'>{t('settings.lobster.jobHint')}</Typography.Paragraph>
    </div>
  );
}
