'use client';

import { useQuery } from '@apollo/client/react';
import { useEffect, useMemo, useState } from 'react';
import { GET_TASKS, TASKS_CHANGED } from './graphql';
import { countByStatus, filterTasks, toListRow } from './libs';
import type { ApiListTask, TaskListStatusFilter } from './types';

/**
 * Tasks-list data layer. Loads all tasks and live-refreshes them via the
 * `tasksChanged` subscription (replaces the old 5s poll), then exposes the
 * active status filter, derived counts, filtered rows, and a router-aware
 * `openTask` callback.
 */
export function useService() {
  const { data, loading, subscribeToMore } = useQuery<{ tasks: ApiListTask[] }>(
    GET_TASKS
  );

  useEffect(() => {
    const unsubscribe = subscribeToMore({
      document: TASKS_CHANGED,
      updateQuery: (prev, { subscriptionData }) => {
        const tasks = (
          subscriptionData.data as { tasksChanged?: ApiListTask[] } | undefined
        )?.tasksChanged;
        return tasks
          ? { tasks }
          : { tasks: (prev.tasks ?? []) as ApiListTask[] };
      },
    });
    return unsubscribe;
  }, [subscribeToMore]);
  const [status, setStatus] = useState<TaskListStatusFilter>(() => {
    if (typeof window === 'undefined') return 'all';
    const initialStatus = new URLSearchParams(window.location.search).get(
      'status'
    );
    return initialStatus &&
      ['AWAITING_REVIEW', 'RUNNING', 'PENDING', 'COMPLETED', 'FAILED'].includes(
        initialStatus
      )
      ? (initialStatus as TaskListStatusFilter)
      : 'all';
  });
  const [query, setQuery] = useState('');

  const all = useMemo(() => (data?.tasks ?? []).map(toListRow), [data?.tasks]);

  const counts = useMemo(() => countByStatus(all), [all]);
  const rows = useMemo(
    () => filterTasks(all, status, query),
    [all, status, query]
  );

  return {
    loading,
    status,
    setStatus,
    query,
    setQuery,
    all,
    counts,
    rows,
  };
}
