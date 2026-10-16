/**
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 * Modified for Xuzhou (续舟), 2026-10-15: prevent upstream update UI.
 */
import React from 'react';
import { UPSTREAM_UPDATES_ENABLED } from '@/common/config/constants';
import UpdateNotificationCard from './UpdateNotificationCard';
export default function UpdateModal() {
  return UPSTREAM_UPDATES_ENABLED ? <UpdateNotificationCard /> : null;
}
