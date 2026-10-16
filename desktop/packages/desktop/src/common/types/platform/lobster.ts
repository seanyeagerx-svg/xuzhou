/** Local workbench integration. No credential values are returned in snapshots. */
export type LobsterAction =
  | 'state'
  | 'gateway-connect'
  | 'gateway-disconnect'
  | 'gateway-save'
  | 'sync-settings'
  | 'sync-retry'
  | 'history-refresh'
  | 'message'
  | 'accept'
  | 'ssh-connect'
  | 'ssh-disconnect'
  | 'ssh-trust'
  | 'maintenance'
  | 'job'
  | 'decision';

export type LobsterProfile = {
  host: string;
  username: string;
  port: number;
  httpPort: number;
  scope: 'user' | 'system';
  keyFile: string;
};
export type LobsterMessage = {
  id: string;
  role: string;
  text: string;
  status?: string;
  error?: string;
  createdAt?: number;
};
export type LobsterJob = {
  id: string;
  projectId: string;
  action: string;
  state: string;
  phase: string;
  host: string;
  username: string;
  port: number;
  startedAt: number;
  connectionError?: string;
  error?: string;
  backup?: string;
  verification?: {
    service?: { ActiveState?: string; SubState?: string; NRestarts?: string };
    readiness?: { ready?: boolean };
  };
};
export type LobsterState = {
  available: boolean;
  error?: string;
  importedAt: number;
  projects: { id: string; name: string; root: string }[];
  gateway: { state: string; detail: string; url: string; pairing?: { requestId?: string } | null };
  maintenance: {
    state: string;
    detail: string;
    ready: boolean;
    generation: number;
    profile: LobsterProfile;
    hostKey?: { host: string; port: number; fingerprint: string } | null;
  };
  sync: {
    enabled: boolean;
    error?: string;
    counts: { pending: number; delivered: number };
    projects: Record<string, { pending: number; delivered: number }>;
    items: {
      id: string;
      projectId: string;
      agentName: string;
      label: string;
      phase: string;
      state: string;
      createdAt: number;
      taskId?: string;
      batchId?: string;
    }[];
    batches: { id: string; state: string; receipt?: string; error?: string; detail?: string }[];
  };
  diagnosis?: {
    projectId: string;
    at: number;
    profile: LobsterProfile;
    result: Record<string, { output?: string; error?: string; exit?: number }>;
  } | null;
  jobs: LobsterJob[];
  tasks: { id: string; projectId: string; agentId: string; status: string; title: string; conversationId: string }[];
  conversations: {
    id: string;
    projectId: string;
    title: string;
    gateway: string;
    status: string;
    messages: LobsterMessage[];
  }[];
  approvals: {
    id: string;
    projectId: string;
    agentId: string;
    title: string;
    details: Record<string, unknown>;
    createdAt: number;
  }[];
};

export type LobsterCall = (action: LobsterAction, data?: Record<string, unknown>) => Promise<unknown>;
