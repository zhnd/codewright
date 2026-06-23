'use client';

import { useQuery } from '@apollo/client/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AGENT_MESSAGES_APPENDED,
  GET_AGENT_MESSAGES,
} from '@/modules/tasks/graphql';
import type { StageTimingView } from '@/modules/tasks/types';
import { stageLabel } from './constants';
import {
  buildRail,
  computeUsage,
  groupRowsByEvent,
  itemsForEvent,
} from './libs';
import type { AgentMessageRow, RailStage } from './types';

const PAGE_SIZE = 200;

interface AgentMessagesData {
  agentMessages: AgentMessageRow[];
}

export interface SelectedMeta {
  stageKey: string;
  label: string;
  attemptNumber: number;
  roundCount: number;
  status: string;
  costUsd: number;
  stepCount: number;
}

/**
 * Activity data layer (master-detail). Loads the cursor-paginated
 * agent message log, live-appends while running, and derives:
 *   - `rail`: stages → rounds for the left nav.
 *   - `selectedEventId`: pinned by the user, else follows the latest event
 *     (so a running task auto-shows the current stage/round).
 *   - `selectedItems` / `selectedMeta`: the right pane.
 */
export function useService({
  taskId,
  isRunning,
  stages,
}: {
  taskId: string;
  isRunning: boolean;
  stages: StageTimingView[];
}) {
  const { data, loading, subscribeToMore, fetchMore } =
    useQuery<AgentMessagesData>(GET_AGENT_MESSAGES, {
      variables: { taskId, limit: PAGE_SIZE },
    });

  const rows = useMemo(() => data?.agentMessages ?? [], [data?.agentMessages]);
  // Rows are ascending by cursor: first = oldest held, last = newest held.
  const firstCursor = rows.length > 0 ? rows[0].cursor : null;
  const lastCursor = rows.length > 0 ? rows[rows.length - 1].cursor : null;

  // Newest held cursor, tracked via a ref so the live subscription can resume
  // from the right place WITHOUT listing `lastCursor` as an effect dependency
  // (which would tear down and recreate the websocket on every appended
  // batch — a churn that drops any NOTIFY tick landing in the resubscribe gap).
  const lastCursorRef = useRef<string | null>(null);
  lastCursorRef.current = lastCursor;

  // "Load earlier" walks backwards from firstCursor; we stop once a page
  // comes back short of PAGE_SIZE (reached the beginning). Until the first
  // page has loaded we optimistically allow a fetch when it filled.
  const [earliestReached, setEarliestReached] = useState(false);
  const hasMore = !earliestReached && rows.length >= PAGE_SIZE;

  useEffect(() => {
    if (!isRunning) return;
    // Wait for the initial page before subscribing so `afterCursor` resumes
    // from the newest held row instead of replaying the whole log from 0.
    if (loading) return;
    return subscribeToMore({
      document: AGENT_MESSAGES_APPENDED,
      variables: { taskId, afterCursor: lastCursorRef.current },
      updateQuery: (prev, { subscriptionData }) => {
        const incoming = (
          subscriptionData.data as
            | { agentMessagesAppended?: AgentMessageRow[] }
            | undefined
        )?.agentMessagesAppended;
        const existing = (prev.agentMessages ?? []) as AgentMessageRow[];
        if (!incoming?.length) return { agentMessages: existing };
        // Dedup by cursor: a single long-lived subscription can briefly
        // overlap with the resumed `afterCursor` window, so guard against
        // appending rows already held.
        const seen = new Set(existing.map((r) => r.cursor));
        const fresh = incoming.filter((r) => !seen.has(r.cursor));
        if (!fresh.length) return { agentMessages: existing };
        return { agentMessages: [...existing, ...fresh] };
      },
    });
  }, [taskId, isRunning, subscribeToMore, loading]);

  const rowsByEvent = useMemo(() => groupRowsByEvent(rows), [rows]);
  const rail = useMemo(
    () => buildRail(stages, rowsByEvent),
    [stages, rowsByEvent]
  );

  // Default selection follows the latest activity (running → current
  // stage/round); a manual pick overrides until the user picks again.
  const latestEventId =
    rows.length > 0
      ? rows[rows.length - 1].taskEventId
      : (rail.at(-1)?.rounds.at(-1)?.eventId ?? null);
  const [pinnedEventId, setPinnedEventId] = useState<string | null>(null);
  const selectedEventId = pinnedEventId ?? latestEventId;

  const selectedItems = useMemo(
    () =>
      selectedEventId
        ? itemsForEvent(rowsByEvent.get(selectedEventId) ?? [])
        : [],
    [selectedEventId, rowsByEvent]
  );

  const selectedMeta = useMemo<SelectedMeta | null>(() => {
    if (!selectedEventId) return null;
    const meta = findRound(rail, selectedEventId);
    const cost = computeUsage(rowsByEvent.get(selectedEventId) ?? []);
    if (!meta) {
      return {
        stageKey: '',
        label: 'Agent',
        attemptNumber: 1,
        roundCount: 1,
        status: 'COMPLETED',
        costUsd: cost.costUsd,
        stepCount: 0,
      };
    }
    return {
      stageKey: meta.stage.stageKey,
      label: stageLabel(meta.stage.stageKey),
      attemptNumber: meta.round.attemptNumber,
      roundCount: meta.stage.rounds.length,
      status: meta.round.status,
      costUsd: cost.costUsd,
      stepCount: meta.round.stepCount,
    };
  }, [rail, selectedEventId, rowsByEvent]);

  const usage = useMemo(() => computeUsage(rows), [rows]);

  // Load earlier: fetch the page of OLDER rows before the oldest held.
  // A short page means we've hit the start of the message log.
  const loadMore = () => {
    if (!firstCursor || earliestReached) return;
    void fetchMore({
      variables: { taskId, beforeCursor: firstCursor, limit: PAGE_SIZE },
    }).then((res) => {
      const got = res.data?.agentMessages?.length ?? 0;
      if (got < PAGE_SIZE) setEarliestReached(true);
    });
  };

  return {
    rail,
    selectedEventId,
    selectEvent: setPinnedEventId,
    selectedItems,
    selectedMeta,
    usage,
    loading,
    hasMore,
    loadMore,
    hasRows: rows.length > 0,
  };
}

function findRound(
  rail: RailStage[],
  eventId: string
): { stage: RailStage; round: RailStage['rounds'][number] } | null {
  for (const stage of rail) {
    const round = stage.rounds.find((r) => r.eventId === eventId);
    if (round) return { stage, round };
  }
  return null;
}
