/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 * Modified for Xuzhou (续舟), 2026-10-15: independent identity and bundled acknowledgements.
 */
import { Button, Divider, Modal, Typography } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { useSettingsViewMode } from '../settingsViewContext';
import { openExternalUrl } from '@/renderer/utils/platform';
import brandMark from '@renderer/assets/branding/mark.svg';

declare const __APP_VERSION__: string;

const AboutModalContent: React.FC = () => {
  const { t } = useTranslation();
  const isPageMode = useSettingsViewMode() === 'page';
  const [showLicenses, setShowLicenses] = useState(false);
  return (
    <div className={classNames('h-full w-full overflow-y-auto px-24px', isPageMode && 'px-0 overflow-visible')}>
      <div className='flex flex-col max-w-500px mx-auto pb-24px'>
        <div className='flex flex-col items-center gap-12px py-24px'>
          <img src={brandMark} alt='' width={80} height={80} />
          <Typography.Title heading={3} className='!m-0 text-t-primary'>
            {t('settings.brand.name')}
          </Typography.Title>
          <Typography.Text className='text-center text-t-secondary'>{t('settings.brand.tagline')}</Typography.Text>
          <Typography.Text className='text-t-secondary'>
            {t('settings.brand.version', { version: __APP_VERSION__ })}
          </Typography.Text>
        </div>
        <Typography.Paragraph>{t('settings.brand.description')}</Typography.Paragraph>
        <Typography.Paragraph className='text-t-secondary'>{t('settings.brand.updates')}</Typography.Paragraph>
        <Divider />
        <Typography.Title heading={6}>{t('settings.brand.credits')}</Typography.Title>
        <Typography.Paragraph>{t('settings.brand.attribution')}</Typography.Paragraph>
        <Typography.Paragraph className='text-t-secondary'>{t('settings.brand.coreLicense')}</Typography.Paragraph>
        <div className='flex flex-col gap-12px'>
          <Button type='primary' long onClick={() => setShowLicenses(true)}>
            {t('settings.brand.licenses')}
          </Button>
          <Button long onClick={() => void openExternalUrl('https://github.com/iOfficeAI/AionUi')}>
            {t('settings.brand.upstreamSource')}
          </Button>
        </div>
      </div>
      <Modal
        title={t('settings.brand.licenses')}
        visible={showLicenses}
        footer={null}
        style={{ width: 'min(1000px, 92vw)' }}
        onCancel={() => setShowLicenses(false)}
        unmountOnExit
      >
        <iframe
          title={t('settings.brand.licenses')}
          src='./branding/third-party-notices.html'
          sandbox=''
          className='w-full h-65vh border-0 bg-1'
        />
      </Modal>
    </div>
  );
};
export default AboutModalContent;
