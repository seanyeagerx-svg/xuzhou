/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 * Modified for Xuzhou (续舟), 2026-10-15; see public/branding/MODIFICATIONS.md.
 */

import '@/common/platform/register-electron';
// configureChromium sets app name (dev isolation) and Chromium flags — must run before other modules
import '@process/utils/configureChromium';

import { app } from 'electron';

// Force node-gyp-build to skip build/ directory and use prebuilds/ only in production
// This prevents loading wrong architecture binaries from development environment
// Only apply in packaged app to allow development builds to use build/Release/
if (app.isPackaged) {
  process.env.PREBUILDS_ONLY = '1';
}
import initStorage from './utils/initStorage';
import './utils/initBridge';
import './services/i18n'; // Initialize i18n for main process
import { initializeLobsterRuntime } from './services/lobster/runtime';

export const initializeProcess = async () => {
  const t0 = performance.now();
  const mark = (label: string) => console.log(`[AionUi:process] ${label} +${Math.round(performance.now() - t0)}ms`);

  await initStorage();
  await initializeLobsterRuntime();
  mark('initStorage');
};
