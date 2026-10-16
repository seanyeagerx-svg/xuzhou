export type ComputerJob = {
  id: string;
  kind: string;
  deviceId: string;
  state: string;
  startedAt: number;
  finishedAt?: number;
  summary: string;
  output?: string;
  error?: string;
  exitCode?: number;
  stopped?: string;
};
export type ComputerState = {
  available: boolean;
  conversationId: string;
  canonicalReady: boolean;
  deviceId: 'local' | 'cloud';
  localRoot: string;
  remoteRoot: string | null;
  busy: boolean;
  cloud: {
    connected: boolean;
    usable: boolean;
    reason: string | null;
    resource: {
      diskFree: number;
      diskTotal: number;
      memoryAvailable: number;
      memoryTotal: number;
      checkedAt: number;
      hostname: string;
    } | null;
  };
  limits: { minimumDiskBytes: number; minimumMemoryBytes: number; maxFileBytes: number };
  screen: {
    available: boolean;
    mode: string;
    actor?: string;
    displayId?: string;
    stopShortcut?: string;
    displays?: Array<{ id: string; name: string; width: number; height: number }>;
  };
  mobile: {
    running: boolean;
    origin: string | null;
    privateNetwork: boolean;
    devices: Array<{ id: string; label: string; createdAt: number; expiresAt: number }>;
  };
  jobs: ComputerJob[];
  approvals: Array<{ id: string; title: string; details: Record<string, unknown> }>;
};
export type ComputerFrame = { frameId: string; width: number; height: number; capturedAt: number; base64: string };
export type ComputerFile = { path: string; size: number; sha256: string; base64: string };
