// Copyright 2026 Xuzhou contributors. SPDX-License-Identifier: Apache-2.0
import type { LobsterState } from '@/common/types/platform/lobster';

export type ActivityRow = {
  id: string;
  time: number;
  kind: 'report' | 'message' | 'tool' | 'job';
  sender: string;
  title: string;
  text: string;
  status: string;
  receipt?: string;
  error?: string;
};

const timestamp = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? (parsed < 10_000_000_000 ? parsed * 1000 : parsed) : 0;
};

/** Only material actually received by this project is shown as activity. */
export function activityRows(state: LobsterState, projectId: string): ActivityRow[] {
  const rows: ActivityRow[] = state.sync.items
    .filter((item) => item.projectId === projectId)
    .map((item) => {
      const batch = state.sync.batches.find((value) => value.id === item.batchId);
      return {
        id: 'report:' + item.id,
        time: timestamp(item.createdAt),
        kind: 'report',
        sender: item.agentName,
        title: item.label,
        text: item.text || '',
        status: item.state,
        receipt: batch?.receipt,
        error: batch?.error,
      };
    });
  for (const chat of state.conversations.filter(
    (value) => value.projectId === projectId && value.gateway === state.gateway.url
  )) {
    for (const message of chat.messages.filter((value) => value.role !== 'report')) {
      rows.push({
        id: 'message:' + chat.id + ':' + message.id,
        time: timestamp(message.createdAt),
        kind: 'message',
        sender: message.role === 'assistant' ? 'openclaw' : message.agentId || 'user',
        title: '',
        text: message.text,
        status: message.status || 'recorded',
        error: message.error,
      });
    }
  }
  for (const activity of state.activities || []) {
    if (activity.projectId !== projectId) continue;
    rows.push({
      id: 'tool:' + activity.id,
      time: timestamp(activity.finishedAt || activity.time),
      kind: 'tool',
      sender: activity.agentId,
      title: activity.title,
      text: [activity.input, activity.output].filter(Boolean).join('\n\n'),
      status: activity.status,
      error: activity.error,
    });
  }
  for (const job of state.jobs.filter((value) => value.projectId === projectId)) {
    rows.push({
      id: 'job:' + job.id,
      time: timestamp(job.finishedAt || job.startedAt),
      kind: 'job',
      sender: 'maintenance',
      title: job.action,
      text: job.phase,
      status: job.state === 'completed' && job.verification?.readiness?.ready !== true ? 'review' : job.state,
      error: job.error || job.connectionError,
    });
  }
  return rows.sort((a, b) => b.time - a.time || b.id.localeCompare(a.id)).slice(0, 100);
}

export const activityStatusKey = (row: ActivityRow): string => {
  if (row.kind === 'report') return row.status === 'delivered' ? 'received' : 'queued';
  if (row.status === 'running') return 'activityRunning';
  if (row.status === 'error' || row.status === 'failed') return 'activityFailed';
  if (row.status === 'cancelled' || row.status === 'interrupted') return 'activityStopped';
  if (row.status === 'review') return 'activityReview';
  if (row.status === 'waiting') return 'activityReview';
  if (row.status === 'completed') return row.kind === 'tool' ? 'activityToolDone' : 'activityDone';
  return 'activityRecorded';
};
