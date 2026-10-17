import { useMemo } from 'react';
import useSWR from 'swr';
import { workspaceCall, hasWorkbench } from '@/renderer/components/layout/Sider/SiderNav/WorkspacePanel/api';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { resolveLocaleKey } from '@/common/utils';
import { useConversationAssistants } from '@renderer/pages/conversation/hooks/useConversationAssistants';
import {
  assistantToOption,
  filterTeamSupportedAssistants,
  teamModelOptions,
  type TeamModelCatalog,
  type TeamAssistantOption,
} from '../components/assistantSelectUtils';

export function useTeamAssistantOptions(
  locale = 'en-US',
  workspace?: string
): {
  assistants: TeamAssistantOption[];
  loading: boolean;
  error: unknown;
  refresh: () => Promise<unknown>;
  filterByQuery: (query: string) => TeamAssistantOption[];
} {
  const result = useConversationAssistants() as {
    presetAssistants?: Parameters<typeof assistantToOption>[0][];
    loading?: boolean;
    isLoading?: boolean;
    error?: unknown;
    refresh?: () => Promise<void>;
  };
  const localeKey = resolveLocaleKey(locale);
  const product = useSWR(hasWorkbench() ? ['workbench.team-options', workspace] : null, async () => {
    const [connections, catalog] = await Promise.all([
      workspaceCall<{ assistants: Array<Assistant & { provider: string }> }>('team-options'),
      workspaceCall<TeamModelCatalog>('chat-models', { cwd: workspace }),
    ]);
    return { ...connections, catalog };
  });
  const assistants = useMemo(
    () =>
      product.data
        ? teamModelOptions(product.data.assistants, product.data.catalog, localeKey)
        : hasWorkbench()
          ? []
          : filterTeamSupportedAssistants(
              (result.presetAssistants ?? []).map((assistant) => assistantToOption(assistant, localeKey))
            ),
    [result.presetAssistants, localeKey, product.data]
  );
  const filterByQuery = useMemo(
    () => (query: string) => {
      const q = query.trim().toLowerCase();
      if (!q) return assistants;
      return assistants.filter((assistant) => assistant.name.toLowerCase().includes(q));
    },
    [assistants]
  );

  return {
    assistants,
    loading: Boolean(hasWorkbench() ? product.isLoading : (result.loading ?? result.isLoading)),
    error:
      product.error ||
      (product.data?.catalog.errors.length
        ? new Error(product.data.catalog.errors.map((e) => `${e.provider}: ${e.message}`).join('\n'))
        : hasWorkbench()
          ? undefined
          : result.error),
    refresh: async () => {
      if (!hasWorkbench()) return result.refresh?.();
      await workspaceCall('chat-models', { cwd: workspace, refresh: true });
      return product.mutate();
    },
    filterByQuery,
  };
}
