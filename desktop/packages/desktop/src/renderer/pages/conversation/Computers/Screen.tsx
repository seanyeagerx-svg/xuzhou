import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Select, Space, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { ComputerFrame } from '@/common/types/platform/computer';
import { workspaceCall } from '@/renderer/components/layout/Sider/SiderNav/WorkspacePanel/api';
import type { ComputerControls } from './api';
import { screenPoint } from './api';
import styles from './Computers.module.css';

export default function Screen({ controls }: { controls: ComputerControls }) {
  const { t } = useTranslation(),
    { state, call } = controls;
  const [frame, setFrame] = useState<ComputerFrame>(),
    [text, setText] = useState(''),
    [display, setDisplay] = useState<string>();
  const [captureError, setCaptureError] = useState(false),
    pending = useRef(false);
  const [rightClick, setRightClick] = useState(false);
  const [dragMode, setDragMode] = useState(false),
    [dragStart, setDragStart] = useState<{ x: number; y: number }>();
  const [refreshMs, setRefreshMs] = useState(1300);
  useEffect(() => {
    setDragStart(undefined);
  }, [state?.screen.mode, state?.screen.displayId, state?.conversationId]);
  const mode = state?.screen.mode,
    shared = mode === 'human' || mode === 'ai',
    desktop = !!window.electronAPI?.workspaceCall;
  useEffect(() => {
    let active = true;
    setFrame(undefined);
    if (!shared || !state) return;
    const capture = async () => {
      if (pending.current) return;
      pending.current = true;
      try {
        const next = await workspaceCall<ComputerFrame>('computer-screen', {
          conversationId: state.conversationId,
          operation: 'frame',
        });
        if (active) {
          setFrame(next);
          setCaptureError(false);
        }
      } catch {
        if (active) {
          setCaptureError(true);
          setFrame(undefined);
        }
      } finally {
        pending.current = false;
      }
    };
    void capture();
    const timer = setInterval(() => {
      void capture();
    }, refreshMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [shared, state?.conversationId, mode, refreshMs]);
  const send = (input: Record<string, unknown>) => {
    if (!frame) return;
    void call('computer-screen', { operation: 'input', input: { ...input, frameId: frame.frameId } });
  };
  const point = (event: Event, button: 'left' | 'right') => {
    const pointer = event as Event & { clientX?: number; clientY?: number; detail?: number };
    if (
      !frame ||
      mode !== 'human' ||
      pointer.detail === 0 ||
      typeof pointer.clientX !== 'number' ||
      typeof pointer.clientY !== 'number' ||
      !(event.currentTarget instanceof HTMLElement)
    )
      return;
    const p = screenPoint(event.currentTarget.getBoundingClientRect(), frame, pointer.clientX, pointer.clientY);
    if (p) {
      if (dragMode) {
        if (!dragStart) setDragStart(p);
        else {
          send({ type: 'drag', ...dragStart, toX: p.x, toY: p.y });
          setDragStart(undefined);
        }
      } else send({ type: 'click', button, ...p });
    }
  };
  if (!state?.screen.available) return <Alert type='info' content={t('conversation.computers.screenUnavailable')} />;
  if (state.deviceId !== 'local') return <Alert type='info' content={t('conversation.computers.screenLocalOnly')} />;
  return (
    <div className={styles.stack}>
      <Typography.Paragraph>{t('conversation.computers.screenHint')}</Typography.Paragraph>
      {desktop && (
        <Select
          value={display || state.screen.displayId}
          onChange={setDisplay}
          aria-label={t('conversation.computers.display')}
          options={(state.screen.displays || []).map((d) => ({
            label: `${d.name} · ${d.width}×${d.height}`,
            value: d.id,
          }))}
        />
      )}
      <Space wrap>
        <Button
          type={dragMode ? 'primary' : 'secondary'}
          disabled={!shared}
          onClick={() => {
            setDragMode(!dragMode);
            setDragStart(undefined);
          }}
        >
          {t('conversation.computers.dragMode')}
        </Button>
        <Select
          aria-label={t('conversation.computers.refreshRate')}
          value={refreshMs}
          onChange={setRefreshMs}
          options={[
            { value: 1300, label: t('conversation.computers.refreshLow') },
            { value: 700, label: t('conversation.computers.refreshMedium') },
            { value: 350, label: t('conversation.computers.refreshHigh') },
          ]}
        />
        {desktop && (
          <Button
            type='primary'
            onClick={() => {
              void call('computer-screen', { operation: 'start', mode: 'human', displayId: display });
            }}
          >
            {t('conversation.computers.shareScreen')}
          </Button>
        )}
        {desktop && (
          <Button
            onClick={() => {
              void call('computer-screen', { operation: 'start', mode: 'ai', displayId: display });
            }}
          >
            {t('conversation.computers.giveAI')}
          </Button>
        )}
        <Button
          disabled={!shared}
          onClick={() => {
            void call('computer-screen', { operation: 'claim' });
          }}
        >
          {t('conversation.computers.takeOver')}
        </Button>
        <Button
          status='danger'
          disabled={!shared}
          onClick={() => {
            setFrame(undefined);
            void call('computer-screen', { operation: 'pause' });
          }}
        >
          {t('conversation.computers.pause')}
        </Button>
      </Space>
      {!shared && (
        <Alert
          type='info'
          content={t(desktop ? 'conversation.computers.screenOff' : 'conversation.computers.desktopMustShare')}
        />
      )}
      {shared && (
        <Typography.Text type='secondary'>
          {t(mode === 'ai' ? 'conversation.computers.aiControlling' : 'conversation.computers.humanControlling')} ·{' '}
          {t('conversation.computers.emergencyStop', { shortcut: state.screen.stopShortcut })}
        </Typography.Text>
      )}
      {captureError && <Alert type='warning' content={t('conversation.computers.captureFailed')} />}
      {dragMode && (
        <Alert
          type='info'
          content={t(dragStart ? 'conversation.computers.dragEnd' : 'conversation.computers.dragStart')}
        />
      )}
      {frame && (
        <Button
          className={styles.screenSurface}
          aria-label={t('conversation.computers.screenSurface')}
          onClick={(event) => point(event, rightClick ? 'right' : 'left')}
          onContextMenu={(event) => {
            event.preventDefault();
          }}
          onWheel={(event) => {
            if (mode === 'human') {
              event.preventDefault();
              send({ type: 'scroll', delta: event.deltaY > 0 ? -2 : 2 });
            }
          }}
        >
          <img
            src={`data:image/jpeg;base64,${frame.base64}`}
            alt={t('conversation.computers.sharedScreen')}
            draggable={false}
          />
        </Button>
      )}
      {shared && (
        <>
          <Button type={rightClick ? 'primary' : 'secondary'} onClick={() => setRightClick((value) => !value)}>
            {t('conversation.computers.rightClick')}
          </Button>
          <Input.TextArea
            disabled={mode !== 'human'}
            value={text}
            onChange={setText}
            autoSize={{ minRows: 2, maxRows: 5 }}
            aria-label={t('conversation.computers.typeText')}
            placeholder={t('conversation.computers.typeText')}
          />
          <Button
            disabled={mode !== 'human' || !frame || !text}
            onClick={() => {
              send({ type: 'text', text });
              setText('');
            }}
          >
            {t('conversation.computers.sendText')}
          </Button>
          <Space wrap>
            {(['Enter', 'Tab', 'Backspace', 'Escape', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight'] as const).map(
              (key) => (
                <Button key={key} disabled={mode !== 'human' || !frame} onClick={() => send({ type: 'key', key })}>
                  {t(`conversation.computers.keys.${key}`)}
                </Button>
              )
            )}
          </Space>
        </>
      )}
    </div>
  );
}
