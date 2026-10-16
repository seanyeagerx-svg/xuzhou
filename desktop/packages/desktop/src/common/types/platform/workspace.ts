export type WorkspaceAction =
  | 'operations-state'
  | 'backup-configure'
  | 'backup-run'
  | 'update-configure'
  | 'update-check-own'
  | 'chat-continuity'
  | 'chat-sync-now'
  | 'chat-sync-toggle'
  | 'computer-state'
  | 'computer-probe'
  | 'computer-select'
  | 'computer-command'
  | 'computer-cancel'
  | 'computer-files'
  | 'computer-decision'
  | 'computer-screen'
  | 'computer-pair'
  | 'computer-unpair'
  | 'computer-phone-stop'
  | 'state'
  | 'companion-state'
  | 'companion-configure'
  | 'companion-request'
  | 'companion-cancel'
  | 'companion-read'
  | 'chat-options'
  | 'chat-create'
  | 'codex-catalog'
  | 'codex-open'
  | 'history-list'
  | 'history-preview'
  | 'history-import'
  | 'history-create-v3'
  | 'history-snapshot'
  | 'history-sync-state'
  | 'history-sync-toggle'
  | 'history-check-updates'
  | 'history-accept-updates'
  | 'choose-directory'
  | 'grok-open'
  | 'grok-hide'
  | 'grok-layout'
  | 'grok-status'
  | 'grok-choose';
export type WorkspaceCall = (action: WorkspaceAction, data?: Record<string, unknown>) => Promise<unknown>;
export type ContinuityState = {
  available: boolean;
  conversationId?: string;
  activeProvider?: string | null;
  model?: string | null;
  running?: boolean;
  totalMessages?: number;
  totalCharacters?: number;
  contextMode?: string;
  routes?: Array<{
    provider: string;
    model: string | null;
    connected: boolean;
    pendingMessages: number;
    uncertain: boolean;
  }>;
  handoffs?: Array<{
    id: string;
    provider: string;
    mode: string;
    historyCount: number;
    status: string;
    finishedAt: number;
  }>;
  sync?: {
    id: string;
    enabled: boolean;
    provider: string;
    revision: number;
    inbound: HistorySyncDirection;
    outbound: HistorySyncDirection;
    error?: string;
  } | null;
};
export type UnifiedChatOptions = { available: boolean; assistantId?: string };
export type NativeHistoryItem = {
  id: string;
  agentId: string;
  title: string;
  cwd: string;
  updatedAt: number;
  model?: string;
  projectId?: string | null;
};
export type NativeCodexCatalog = {
  items: NativeHistoryItem[];
  projects: Array<{ id: string; name: string; roots: string[] }>;
  bindings: Record<string, string>;
  updatedAt: number;
  projectWarning?: string;
  catalogWarning?: string;
  loading?: boolean;
};
export type HistoryMessage = { id: string; role: string; text: string; agentName?: string };
export type HistorySource = NativeHistoryItem & { messages: HistoryMessage[] };
export type HistoryPreview = { token: string; source: HistorySource; createdAt: number };
export type HistorySnapshot = { id: string; cwd: string; source: HistorySource; createdAt: number; revision: number };
export type HistoryUpdatePreview = HistoryPreview & { importId: string; added: HistoryMessage[]; revision: number };
export type HistoryUpdateResult = { snapshot: HistorySnapshot; added: number; existing: boolean };
export type HistorySyncDirection = {
  state: 'pending' | 'ready' | 'settling' | 'sending' | 'waiting' | 'conflict' | 'retrying' | 'unsupported';
  records?: number;
  lastCheckedAt?: number;
  lastSuccessAt?: number;
  detail?: string;
};
export type HistorySyncState = {
  id: string;
  enabled: boolean;
  inbound: HistorySyncDirection;
  outbound: HistorySyncDirection;
  snapshot: HistorySnapshot;
  error?: string;
};
export type GrokState = { installed: boolean; attached: boolean; state: string; visible?: boolean; detail?: string };

export type CompanionNote = {
  id: string;
  kind: string;
  text: string;
  question: string;
  createdAt: number;
  read: boolean;
  sourceCount: number;
  sourceMessageIds: string[];
  clipped: boolean;
};
export type CompanionState = {
  available: boolean;
  ready: boolean;
  conversationId: string;
  title: string;
  gatewayConnected: boolean;
  sourceCount: number;
  entry: {
    mode: 'off' | 'turn' | 'periodic';
    intervalMinutes: number;
    status: string;
    paused?: boolean;
    error?: string | null;
    run?: { id: string; text: string; sourceCount: number } | null;
    notes: CompanionNote[];
  };
};
