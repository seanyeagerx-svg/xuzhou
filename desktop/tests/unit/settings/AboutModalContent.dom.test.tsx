/**
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 * Modified for Xuzhou (续舟), 2026-10-15: own-brand About behavior.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/utils/platform', () => ({ openExternalUrl: vi.fn() }));
vi.mock('@/renderer/components/settings/SettingsModal/settingsViewContext', () => ({
  useSettingsViewMode: () => 'modal',
}));
import AboutModalContent from '@/renderer/components/settings/SettingsModal/contents/AboutModalContent';
import { openExternalUrl } from '@/renderer/utils/platform';
describe('Xuzhou About', () => {
  beforeEach(() => vi.stubGlobal('__APP_VERSION__', '2.2.2'));
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });
  it('shows the independent product and upstream attribution without an install action', () => {
    render(<AboutModalContent />);
    expect(screen.getByText('settings.brand.name')).toBeTruthy();
    expect(screen.getByText('settings.brand.attribution')).toBeTruthy();
    expect(screen.getByText('settings.brand.coreLicense')).toBeTruthy();
    expect(screen.queryByText('settings.checkForUpdates')).toBeNull();
    expect(screen.queryByText('settings.updateReadyInstall')).toBeNull();
  });
  it('opens bundled notices in a sandboxed read-only view', () => {
    render(<AboutModalContent />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.brand.licenses' }));
    const frame = screen.getByTitle('settings.brand.licenses');
    expect(frame.getAttribute('src')).toBe('./branding/third-party-notices.html');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(openExternalUrl).not.toHaveBeenCalled();
  });
  it('labels the upstream source separately and opens its actual repository', () => {
    render(<AboutModalContent />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.brand.upstreamSource' }));
    expect(openExternalUrl).toHaveBeenCalledWith('https://github.com/iOfficeAI/AionUi');
  });
});
