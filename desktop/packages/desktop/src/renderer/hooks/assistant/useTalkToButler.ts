/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { workspaceCall } from '@/renderer/components/layout/Sider/SiderNav/WorkspacePanel/api';
import { globalNavigate } from '@/renderer/utils/navigation';
import { Message } from '@arco-design/web-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { mutate as swrMutate } from 'swr';

export type TalkToButlerArgs = {
  /** Prompt pre-filled into the home chat input. */
  prompt: string;
  /** Optional file paths pre-attached to the input (e.g. report screenshots). */
  files?: string[];
};

/**
 * Modified for Xuzhou: all settings and diagnosis shortcuts use the same
 * software-selectable chat. They never enable an upstream preset assistant.
 *
 * Reuses the home page's `prefillPrompt` navigation contract (added with the
 * scheduled-tasks "create via chat" entry) and extends it with `prefillFiles`.
 * Uses `globalNavigate` rather than `useNavigate` so it is safe to call from
 * components mounted outside the Router (e.g. the global FeedbackReportModal).
 */
export const useTalkToButler = (): ((args: TalkToButlerArgs) => Promise<void>) => {
  const { t } = useTranslation();

  return useCallback(
    async ({ prompt, files }: TalkToButlerArgs) => {
      let selectedAssistantId: string;
      try {
        const options = await workspaceCall<{ assistantId?: string }>('chat-options');
        if (!options.assistantId) throw new Error(t('settings.assistantAgentUnavailable'));
        selectedAssistantId = options.assistantId;
        await swrMutate('assistants.list');
      } catch (error) {
        Message.error(t('settings.assistantAgentUnavailable'));
        throw error;
      }

      globalNavigate('/guid', {
        state: {
          selectedAssistantId,
          prefillPrompt: prompt,
          prefillFiles: files,
        },
      });
    },
    [t]
  );
};

export default useTalkToButler;
