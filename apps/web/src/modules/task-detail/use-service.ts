'use client';

import { useMutation, useQuery, useSubscription } from '@apollo/client/react';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  CANCEL_TASK,
  GET_TASK,
  RETRY_TASK,
  REVIEW_TASK,
  TASK_UPDATED,
} from '@/modules/tasks/graphql';
import { type ApiTask, transformTaskToDetail } from '@/modules/tasks/transform';
import { computeHitlWaited, computeStageTimings } from './libs';
import type {
  AttemptView,
  DetailTab,
  StageDataMap,
  StageKey,
  StageStatusMap,
} from './types';

interface UseServiceInput {
  taskId: string;
}

/**
 * Task detail data layer.
 *
 * Single query (`GET_TASK`) carries everything web renders. Subscription
 * fires `refetch()` on each tick — workflow is the only writer.
 *
 * Why refetch instead of `client.writeQuery` with the subscription
 * payload: writing the full Task tree directly into the GET_TASK cache
 * key is finicky around nested-entity normalization (events →
 * agentInvocations → turns / toolCalls), and we observed UI staleness
 * with that path. Refetch guarantees the cache reflects the database
 * truth at the cost of one extra HTTP round-trip per state change,
 * which is negligible at the tick rate the workflow produces.
 *
 * Server returns `stages: StageView[]` with each attempt embedding its
 * own HITL review (if any). We fold to `StageDataMap` keyed by web's
 * StageKey so each body looks up its stage's data O(1).
 */
interface TaskDetailQueryShape {
  task:
    | (ApiTask & {
        currentStageKey?: string | null;
        stages?: ServerStageView[];
      })
    | null;
}

export function useService({ taskId }: UseServiceInput) {
  const { data, loading, refetch } = useQuery<TaskDetailQueryShape>(GET_TASK, {
    variables: { id: taskId },
  });

  useSubscription(TASK_UPDATED, {
    variables: { id: taskId },
    onData: () => {
      refetch();
    },
  });

  const task = data?.task;
  const detail = useMemo(
    () => (task ? transformTaskToDetail(task) : null),
    [task]
  );

  const stageData = useMemo<StageDataMap>(
    () => buildStageDataMap(task?.stages ?? []),
    [task]
  );

  const stages = useMemo<StageStatusMap>(() => {
    const map = {} as StageStatusMap;
    for (const k of WEB_STAGE_KEYS) {
      map[k] = stageData[k].status;
    }
    return map;
  }, [stageData]);

  const initialStage: StageKey = useMemo(() => {
    if (!task?.currentStageKey) return 'analyze';
    // When critic is gating on HITL, focus the HITL pane (not critic).
    if (
      task.currentStageKey === 'CRITIC' &&
      stageData.hitl.status === 'awaiting'
    ) {
      return 'hitl';
    }
    const remapped = mapServerStageKey(task.currentStageKey) ?? 'analyze';
    return remapped;
  }, [task, stageData]);

  const [selectedStage, setSelectedStage] = useState<StageKey>(initialStage);
  const [tab, setTab] = useState<DetailTab>('overview');

  const timings = useMemo(
    () => (detail ? computeStageTimings(detail.timeline) : {}),
    [detail]
  );
  const hitlWaited = useMemo(
    () =>
      detail
        ? computeHitlWaited(detail.timeline, stages.hitl === 'awaiting')
        : null,
    [detail, stages.hitl]
  );

  const [reviewTask, { loading: reviewing }] = useMutation(REVIEW_TASK);
  const router = useRouter();
  const [retryTask, { loading: retrying }] = useMutation<{
    retryTask?: { id: string } | null;
  }>(RETRY_TASK);
  const [cancelTask, { loading: canceling }] = useMutation(CANCEL_TASK);

  const submitReview = useCallback(
    async (lane: string, feedback: string) => {
      const action = lane === 'approve' ? 'approve' : 'reject';
      try {
        await reviewTask({
          variables: { taskId, action, feedback: feedback || null },
        });
        toast.success(
          lane === 'approve' ? 'Approved — opening PR' : 'Feedback sent'
        );
        await refetch();
      } catch {
        // Error already surfaced by the Apollo error link (toast).
        // No additional handling needed here.
      }
    },
    [reviewTask, refetch, taskId]
  );

  const retry = useCallback(async () => {
    try {
      const { data } = await retryTask({ variables: { taskId } });
      const newId = data?.retryTask?.id;
      if (newId) {
        toast.success('Retry queued — opening new task');
        router.push(`/tasks/${newId}`);
      }
    } catch {
      // Error already surfaced by the Apollo error link.
    }
  }, [retryTask, router, taskId]);

  // Cancellation requests a workflow stop; the workflow's cancellation
  // branch writes the CANCELLED status back, which the subscription pushes
  // here. No navigation — the user stays on the same task. We still refetch
  // to close the gap before the next subscription tick lands.
  const cancel = useCallback(async () => {
    try {
      await cancelTask({ variables: { taskId } });
      toast.success('Cancellation requested');
      await refetch();
    } catch {
      // Error already surfaced by the Apollo error link.
    }
  }, [cancelTask, refetch, taskId]);

  return {
    loading,
    detail,
    stages,
    stageData,
    selectedStage,
    setSelectedStage,
    tab,
    setTab,
    timings,
    hitlWaited,
    submitReview,
    reviewing,
    retry,
    retrying,
    cancel,
    canceling,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

const WEB_STAGE_KEYS: StageKey[] = [
  'analyze',
  'reproduce',
  'implement',
  'filter',
  'critic',
  'hitl',
  'pr',
];

interface ServerStageView {
  key: string;
  status: string;
  attempts: AttemptView[];
}

function buildStageDataMap(serverStages: ServerStageView[]): StageDataMap {
  const map = {} as StageDataMap;
  for (const k of WEB_STAGE_KEYS) {
    map[k] = { status: 'pending', attempts: [] };
  }
  for (const s of serverStages) {
    const webKey = mapServerStageKey(s.key);
    if (!webKey) continue;
    map[webKey] = {
      status: normalizeStatus(s.status),
      attempts: s.attempts,
    };
  }

  // The synthetic 'hitl' slot is the post-critic human gate. We split
  // critic vs hitl so the pipeline doesn't show two in-progress states
  // when the gate is active:
  //   - If HITL ever engaged on critic (any attempt is AWAITING/REJECTED,
  //     or any attempt has a review): hitl mirrors critic's status, and
  //     critic itself shows as `done` (the critic agent already finished
  //     its work the moment the gate appeared).
  //   - Otherwise (auto-approved or critic-agent-self-failure): hitl
  //     stays pending, critic keeps its actual status.
  const critic = map.critic;
  const hitlEngaged = critic.attempts.some(
    (a) =>
      a.status === 'AWAITING' || a.status === 'REJECTED' || a.review != null
  );
  if (hitlEngaged) {
    map.hitl = { status: critic.status, attempts: critic.attempts };
    map.critic = { status: 'done', attempts: critic.attempts };
  }

  return map;
}

function mapServerStageKey(key: string): StageKey | null {
  switch (key.toUpperCase()) {
    case 'ANALYSIS':
      return 'analyze';
    case 'REPRODUCE':
      return 'reproduce';
    case 'IMPLEMENT':
      return 'implement';
    case 'FILTER':
      return 'filter';
    case 'CRITIC':
      return 'critic';
    case 'PR':
      return 'pr';
    default:
      return null;
  }
}

function normalizeStatus(s: string): StageStatusMap[StageKey] {
  const v = s.toLowerCase();
  if (v === 'running') return 'running';
  if (v === 'awaiting') return 'awaiting';
  if (v === 'completed') return 'done';
  if (v === 'rejected') return 'failed'; // visually treat as failed for the bar
  if (v === 'failed') return 'failed';
  if (v === 'skipped') return 'skipped';
  return 'pending';
}
