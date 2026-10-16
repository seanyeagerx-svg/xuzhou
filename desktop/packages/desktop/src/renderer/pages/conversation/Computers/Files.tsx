import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, List, Space, Typography, Upload } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { ComputerFile } from '@/common/types/platform/computer';
import type { ComputerControls } from './api';
import styles from './Computers.module.css';

type Listing = { entries: Array<{ name: string; directory: boolean; link: boolean }>; truncated: boolean };
function toBase64(bytes: Uint8Array) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
function fileBytes(file: ComputerFile) {
  return Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
}

export default function Files({ controls }: { controls: ComputerControls }) {
  const { t } = useTranslation(),
    { state, call } = controls;
  const [folder, setFolder] = useState(''),
    [typedFolder, setTypedFolder] = useState(''),
    [listing, setListing] = useState<Listing>();
  const [file, setFile] = useState<ComputerFile>(),
    [text, setText] = useState(''),
    [name, setName] = useState(''),
    [binary, setBinary] = useState(false);
  const [tooLarge, setTooLarge] = useState(false);
  const refresh = useCallback(async () => {
    const value = await call<Listing>('computer-files', { operation: 'list', path: folder });
    if (value) setListing(value);
  }, [call, folder]);
  useEffect(() => {
    setListing(undefined);
    setFile(undefined);
    setText('');
    void refresh();
  }, [refresh, state?.deviceId]);
  const open = async (path: string) => {
    const value = await call<ComputerFile>('computer-files', { operation: 'read', path });
    if (!value) return;
    setFile(value);
    setName(value.path);
    try {
      setText(new TextDecoder('utf-8', { fatal: true }).decode(fileBytes(value)));
      setBinary(false);
    } catch {
      setText('');
      setBinary(true);
    }
  };
  const save = async () => {
    const target = file?.path || [folder, name].filter(Boolean).join('/');
    const value = await call<{ sha256: string }>('computer-files', {
      operation: 'write',
      path: target,
      base64: toBase64(new TextEncoder().encode(text)),
      expectedSha256: file?.sha256 ?? null,
    });
    if (value) {
      await open(target);
      await refresh();
    }
  };
  const download = () => {
    if (!file) return;
    const url = URL.createObjectURL(new Blob([fileBytes(file)]));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.path.split('/').at(-1) || 'download';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className={styles.stack}>
      <Typography.Text type='secondary'>{t('conversation.computers.fileHint')}</Typography.Text>
      <Space wrap>
        <Input
          value={typedFolder}
          onChange={setTypedFolder}
          placeholder={t('conversation.computers.relativeFolder')}
          aria-label={t('conversation.computers.relativeFolder')}
        />
        <Button
          onClick={() => {
            setFolder(typedFolder);
          }}
        >
          {t('conversation.computers.openFolder')}
        </Button>
        <Button
          onClick={() => {
            void refresh();
          }}
        >
          {t('common.refresh')}
        </Button>
      </Space>
      <Typography.Text className={styles.path}>
        {state?.deviceId === 'cloud' ? state.remoteRoot : state?.localRoot} / {folder}
      </Typography.Text>
      <Space wrap>
        <Upload
          showUploadList={false}
          beforeUpload={async (upload) => {
            if (upload.size > (state?.limits.maxFileBytes || 0)) {
              setTooLarge(true);
              return false;
            }
            setTooLarge(false);
            const value = await call('computer-files', {
              operation: 'write',
              path: [folder, upload.name].filter(Boolean).join('/'),
              base64: toBase64(new Uint8Array(await upload.arrayBuffer())),
              expectedSha256: null,
            });
            if (value) await refresh();
            return false;
          }}
        >
          <Button>{t('conversation.computers.upload')}</Button>
        </Upload>
        <Button
          onClick={() => {
            void call('computer-files', { operation: 'mkdir', path: [folder, name].filter(Boolean).join('/') }).then(
              () => refresh()
            );
          }}
          disabled={!name.trim()}
        >
          {t('conversation.computers.newFolder')}
        </Button>
      </Space>
      {tooLarge && <Alert type='warning' content={t('conversation.computers.fileLimit')} />}
      <List
        size='small'
        dataSource={listing?.entries || []}
        render={(entry) => (
          <List.Item key={entry.name}>
            <Button
              type='text'
              disabled={entry.link}
              onClick={() => {
                const next = [folder, entry.name].filter(Boolean).join('/');
                if (entry.directory) {
                  setFolder(next);
                  setTypedFolder(next);
                } else void open(next);
              }}
            >
              {entry.directory ? '▸ ' : ''}
              {entry.name}
              {entry.link ? ` · ${t('conversation.computers.linkSkipped')}` : ''}
            </Button>
          </List.Item>
        )}
      />
      {listing?.truncated && (
        <Typography.Text type='secondary'>{t('conversation.computers.listTruncated')}</Typography.Text>
      )}
      <Input
        value={name}
        onChange={setName}
        disabled={!!file}
        placeholder={t('conversation.computers.fileName')}
        aria-label={t('conversation.computers.fileName')}
      />
      {binary ? (
        <Alert content={t('conversation.computers.binaryFile')} />
      ) : (
        <Input.TextArea
          value={text}
          onChange={setText}
          autoSize={{ minRows: 5, maxRows: 15 }}
          aria-label={t('conversation.computers.fileContent')}
        />
      )}
      <Space wrap>
        <Button
          type='primary'
          disabled={!name.trim() || binary || state?.busy}
          onClick={() => {
            void save();
          }}
        >
          {t('common.save')}
        </Button>
        <Button disabled={!file} onClick={download}>
          {t('conversation.computers.download')}
        </Button>
        <Button
          onClick={() => {
            setFile(undefined);
            setName('');
            setText('');
            setBinary(false);
          }}
        >
          {t('conversation.computers.newFile')}
        </Button>
      </Space>
    </div>
  );
}
