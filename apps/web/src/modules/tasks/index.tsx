'use client';

import { ArrowUpRight, Plus, Search, X } from 'lucide-react';
import Link from 'next/link';
import {
  type MiniStageStatus,
  MiniTrack,
} from '@/components/common/mini-track';
import { PanelCard } from '@/components/common/panel-card';
import { StatusChip } from '@/components/common/status-chip';
import { AppShell } from '@/components/layout/app-shell';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { cn } from '@/utils/cn';
import { TASK_FILTERS } from './constants';
import {
  effectiveStatus,
  formatCost,
  formatDuration,
  humanizeTaskType,
} from './libs';
import { useService } from './use-service';

export function Tasks() {
  const { loading, status, setStatus, query, setQuery, all, counts, rows } =
    useService();

  return (
    <AppShell>
      <PageHeader
        segments={[{ label: 'Tasks' }]}
        actions={
          <Button asChild size="sm" variant="default" className="h-8">
            <Link href="/projects/new">
              <Plus className="mr-1 h-3.5 w-3.5" />
              Connect repo
            </Link>
          </Button>
        }
      />

      <div className="px-6 py-6 lg:px-7 lg:py-7">
        {/* Hero */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-1.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-foreground-subtle">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-accent codewright-pulse" />
              tasks · live · 5s
            </div>
            <h1 className="text-[26px] font-semibold leading-[1.05] tracking-normal text-foreground">
              Task ledger
            </h1>
            <p className="mt-1.5 text-[12.5px] text-foreground-muted">
              <span className="font-mono tabular-nums text-foreground">
                {String(all.length).padStart(3, '0')}
              </span>{' '}
              total ·{' '}
              <span className="font-mono tabular-nums text-accent">
                {String(counts.AWAITING_REVIEW).padStart(2, '0')}
              </span>{' '}
              awaiting your review.
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="-translate-y-1/2 pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 text-foreground-subtle" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tasks"
              className="h-8 w-full rounded-sm border border-border bg-card px-8 text-[12px] outline-none transition-colors placeholder:text-foreground-subtle focus:border-border-strong focus:ring-2 focus:ring-ring/20"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                title="Clear search"
                className="-translate-y-1/2 absolute right-2 top-1/2 flex h-4.5 w-4.5 items-center justify-center rounded-sm text-foreground-subtle hover:bg-surface-2 hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Filter pills */}
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {TASK_FILTERS.map((f) => {
            const isActive = status === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setStatus(f.key)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-sm border px-2.5 text-[11.5px] transition-colors',
                  isActive
                    ? 'border-foreground bg-foreground font-semibold text-background'
                    : 'border-border bg-card font-medium text-foreground-muted hover:border-border-strong hover:text-foreground'
                )}
              >
                {f.label}
                <span
                  className={cn(
                    'rounded-[3px] px-1.25 font-mono text-[10px] tabular-nums',
                    isActive
                      ? 'bg-background/15 text-background'
                      : 'bg-surface-inset text-foreground-subtle'
                  )}
                >
                  {String(counts[f.key]).padStart(2, '0')}
                </span>
              </button>
            );
          })}
        </div>

        <PanelCard title="All tasks" caption={`${rows.length} shown`} noPad>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-faint bg-surface-cream/40">
                  {[
                    { label: 'Task', mobile: true },
                    { label: 'Project', mobile: false },
                    { label: 'Status', mobile: true },
                    { label: 'Pipeline', mobile: false },
                    { label: 'Duration', mobile: false },
                    { label: 'Cost', mobile: false },
                    { label: '', mobile: true },
                  ].map((h, i) => (
                    <th
                      key={h.label || `h-${i}`}
                      className={cn(
                        'whitespace-nowrap px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.06em] text-foreground-subtle',
                        (h.label === 'Duration' || h.label === 'Cost') &&
                          'text-right',
                        !h.mobile && 'hidden md:table-cell'
                      )}
                    >
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="[&_tr:last-child_td]:border-b-0">
                {rows.map((t) => (
                  <tr
                    key={t.id}
                    className="group transition-colors hover:bg-surface-2"
                  >
                    <td className="border-b border-border-faint px-4 py-3 align-middle">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm font-mono text-[11px] font-medium text-background"
                          style={{
                            background:
                              effectiveStatus(t) === 'FAILED'
                                ? 'var(--danger)'
                                : effectiveStatus(t) === 'AWAITING_REVIEW'
                                  ? 'var(--accent)'
                                  : effectiveStatus(t) === 'COMPLETED'
                                    ? 'var(--ok)'
                                    : 'oklch(0.32 0.012 264)',
                          }}
                        >
                          {humanizeTaskType(t.type).charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/tasks/${t.id}`}
                            className="block truncate text-[12.5px] font-semibold text-foreground no-underline"
                          >
                            {humanizeTaskType(t.type)}
                          </Link>
                          <div className="mt-px truncate font-mono text-[10.5px] text-foreground-subtle">
                            {t.id}
                          </div>
                          {/* Mobile-only: project name shown below the title since the column is hidden */}
                          {t.project?.name && (
                            <div className="mt-0.5 truncate text-[11px] text-foreground-muted md:hidden">
                              {t.project.name}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="hidden border-b border-border-faint px-4 py-3 align-middle text-[12px] text-foreground-muted md:table-cell">
                      {t.project?.name ?? '—'}
                    </td>
                    <td className="border-b border-border-faint px-4 py-3 align-middle">
                      <StatusChip status={effectiveStatus(t)} />
                    </td>
                    <td className="hidden border-b border-border-faint px-4 py-3 align-middle md:table-cell">
                      <MiniTrack
                        stages={
                          (t.stages ?? {}) as Partial<
                            Record<string, MiniStageStatus>
                          >
                        }
                      />
                    </td>
                    <td className="hidden border-b border-border-faint px-4 py-3 text-right align-middle font-mono text-[12px] text-foreground-muted md:table-cell">
                      {formatDuration(t.durationMs)}
                    </td>
                    <td className="hidden border-b border-border-faint px-4 py-3 text-right align-middle font-mono text-[12px] text-foreground md:table-cell">
                      {formatCost(t.totalCostUsd)}
                    </td>
                    <td className="border-b border-border-faint px-4 py-3 align-middle">
                      <div className="flex justify-end opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                        <Link
                          href={`/tasks/${t.id}`}
                          aria-label={`Open ${humanizeTaskType(t.type)} task`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-foreground-muted no-underline hover:bg-surface-inset hover:text-foreground"
                        >
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && !loading && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-12 text-center text-[12px] text-foreground-subtle"
                    >
                      {status !== 'all'
                        ? 'No tasks match the current filter.'
                        : query
                          ? 'No tasks match the current search.'
                          : 'No tasks yet. Connect a repository to get started.'}
                    </td>
                  </tr>
                )}
                {loading && rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-12 text-center text-[12px] text-foreground-subtle"
                    >
                      Loading…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </PanelCard>
      </div>
    </AppShell>
  );
}
