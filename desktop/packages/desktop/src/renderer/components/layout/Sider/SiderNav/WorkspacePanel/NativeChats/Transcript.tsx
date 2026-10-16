import React, { createContext, useContext, useState } from 'react';
import { Alert, Button, Spin } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import type { HistorySnapshot } from '@/common/types/platform/workspace';
import { workspaceCall } from '../api';
import { HistoryMessages } from '../HistoryBrowser';

export const NativeTranscriptContext = createContext<string | undefined>(undefined);

export default function NativeTranscript() {
  const id = useContext(NativeTranscriptContext);
  const { t } = useTranslation();
  const [count, setCount] = useState(20);
  const { data, error, isLoading } = useSWR(
    id ? ['native-transcript', id] : null,
    () => workspaceCall<HistorySnapshot>('history-snapshot', { id }),
    { refreshInterval: 5000 }
  );
  if (!id) return null;
  if (error) return <Alert type='error' content={String(error)} />;
  if (isLoading) return <Spin loading />;
  if (!data?.source.messages.length) return null;
  const source = data.source;
  return (
    <div className='px-8px py-12px' data-testid='native-transcript'>
      <div className='text-12px text-t-secondary mb-10px'>{t('settings.workspace.native.transcript')}</div>
      {source.messages.reduce((size, message) => size + message.text.length, 0) > 55000 && (
        <Alert type='info' content={t('settings.workspace.sync.longContext')} className='mb-12px' />
      )}
      {source.messages.length > count && (
        <Button type='text' onClick={() => setCount((n) => n + 40)}>
          {t('settings.workspace.native.earlier', { count: source.messages.length - count })}
        </Button>
      )}
      <HistoryMessages source={{ ...source, messages: source.messages.slice(-count) }} />
      <div className='text-12px text-t-secondary py-12px'>{t('settings.workspace.native.continue')}</div>
    </div>
  );
}
