'use client';

import { useMutation, useQuery } from '@apollo/client/react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { SET_TAPD_WORKSPACE_PROJECT_MAP, TAPD_INBOX_QUERY } from './graphql';
import type {
  TapdBugRow,
  TapdInboxData,
  TapdInboxMapping,
  TapdProjectRef,
} from './types';

const POLL_INTERVAL_MS = 30_000;

export interface WorkspaceMapEntry {
  workspaceId: string;
  /** null = no Codewright project mapped yet. */
  mapping: TapdInboxMapping | null;
}

export function useService() {
  const { data, loading, refetch } = useQuery<TapdInboxData>(TAPD_INBOX_QUERY, {
    pollInterval: POLL_INTERVAL_MS,
  });

  const [setMap, { loading: mapping }] = useMutation(
    SET_TAPD_WORKSPACE_PROJECT_MAP,
    { refetchQueries: [{ query: TAPD_INBOX_QUERY }] }
  );

  const status = data?.tapdCredentialStatus;
  const configured = Boolean(status?.configured);
  const tapdNick = status?.tapdNick ?? null;

  const bugs: TapdBugRow[] = data?.tapdAssignedBugs ?? [];
  const allMappings = data?.tapdWorkspaceMappings ?? [];
  const projects: TapdProjectRef[] = data?.projects ?? [];

  // Surface every distinct workspace_id we saw on bugs so the UI can
  // prompt the user to map any unmapped ones inline.
  const workspaceMap: Record<string, TapdInboxMapping | null> = useMemo(() => {
    const seen: Record<string, TapdInboxMapping | null> = {};
    for (const bug of bugs) {
      if (!bug.workspaceId) continue;
      if (seen[bug.workspaceId] !== undefined) continue;
      seen[bug.workspaceId] =
        allMappings.find((m) => m.workspaceId === bug.workspaceId) ?? null;
    }
    return seen;
  }, [bugs, allMappings]);

  const [activeBug, setActiveBug] = useState<TapdBugRow | null>(null);

  function getMappingForWorkspace(
    workspaceId: string
  ): TapdInboxMapping | null {
    return workspaceMap[workspaceId] ?? null;
  }

  async function mapWorkspace(workspaceId: string, projectId: string) {
    if (!projectId) return;
    try {
      await setMap({ variables: { workspaceId, projectId } });
      toast.success('Workspace mapped');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Mapping failed');
    }
  }

  return {
    loading,
    refetch,
    configured,
    tapdNick,
    bugs,
    projects,
    workspaceMap,
    activeBug,
    setActiveBug,
    mapping,
    mapWorkspace,
    getMappingForWorkspace,
  };
}
