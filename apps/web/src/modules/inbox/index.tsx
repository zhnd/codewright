'use client';

import {
  ArrowUpRight,
  Check,
  Clock4,
  Inbox as InboxIcon,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { Dot } from '@/components/common/dot';
import { EmptyState } from '@/components/common/empty-state';
import { PanelCard } from '@/components/common/panel-card';
import { StatTile } from '@/components/common/stat-tile';
import { AppShell } from '@/components/layout/app-shell';
import { PageHeader } from '@/components/layout/page-header';
import type { AwaitingItem, DecisionItem } from './types';
import { useService } from './use-service';

const RISK_COLOR: Record<string, string> = {
  trivial: 'var(--foreground-subtle)',
  low: 'var(--ok)',
  medium: 'var(--warn)',
  high: 'var(--accent)',
  critical: 'var(--danger)',
};

const DECISION_META: Record<
  string,
  { label: string; tone: 'ok' | 'danger' | 'accent' }
> = {
  'approved · merged': { label: 'Approved · merged', tone: 'ok' },
  failed: { label: 'Failed', tone: 'danger' },
  resumed: { label: 'Resumed', tone: 'accent' },
};

export function Inbox() {
  const { loading, awaiting, decisions, summary } = useService();

  return (
    <AppShell>
      <PageHeader segments={[{ label: 'Inbox' }]} />

      <div className="px-6 py-6 lg:px-7 lg:py-7">
        {/* Hero — focused on the wait number */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-1.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-foreground-subtle">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-accent codewright-pulse" />
              inbox · live · 5s
            </div>
            <h1 className="text-[26px] font-semibold leading-[1.05] tracking-normal text-foreground">
              Awaiting your review
            </h1>
            <p className="mt-1.5 text-[12.5px] text-foreground-muted">
              {summary.awaitingCount === 0 ? (
                <>All clear. Nothing in your queue right now.</>
              ) : (
                <>
                  <span className="font-mono tabular-nums text-foreground">
                    {String(summary.awaitingCount).padStart(2, '0')}
                  </span>{' '}
                  {summary.awaitingCount === 1 ? 'task' : 'tasks'} need a
                  decision · oldest waited{' '}
                  <span className="font-mono tabular-nums text-accent">
                    {summary.oldestWait}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Stat tiles */}
        <div className="mb-5 grid grid-cols-2 gap-2.5 lg:grid-cols-3">
          <StatTile
            index="01"
            label="In your queue"
            value={loading ? '—' : summary.awaitingCount}
            hint={
              summary.awaitingCount > 0
                ? 'Decide to keep agents moving'
                : 'You are caught up'
            }
            icon={InboxIcon}
            emphasis={summary.awaitingCount > 0}
          />
          <StatTile
            index="02"
            label="Oldest wait"
            value={loading ? '—' : summary.oldestWait}
            hint={
              summary.oldestId
                ? `tsk_${summary.oldestId.slice(-6)}`
                : 'no waiting tasks'
            }
            icon={Clock4}
          />
          <StatTile
            index="03"
            label="Decisions · 24h"
            value={loading ? '—' : summary.decisionsToday}
            hint="completed or failed in the last day"
            icon={Check}
          />
        </div>

        {/* Main: queue + decisions side panel */}
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[2fr_1fr]">
          <PanelCard
            title="Review queue"
            caption={`${summary.awaitingCount} ${summary.awaitingCount === 1 ? 'task' : 'tasks'}`}
            noPad
            emphasis={summary.awaitingCount > 0}
          >
            <ReviewQueue items={awaiting} loading={loading} />
          </PanelCard>

          <PanelCard title="Recent decisions" caption="last 12" noPad>
            <DecisionList items={decisions} loading={loading} />
          </PanelCard>
        </div>
      </div>
    </AppShell>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function ReviewQueue({
  items,
  loading,
}: {
  items: AwaitingItem[];
  loading: boolean;
}) {
  if (loading && items.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-[12px] text-foreground-subtle">
        Loading queue…
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="px-4 py-7">
        <EmptyState
          title="Inbox zero"
          description="No tasks are waiting on you. Agents will surface anything that needs a human eye here."
        />
      </div>
    );
  }
  return (
    <ol className="divide-y divide-border-faint">
      {items.map((t, i) => (
        <li key={t.id}>
          <Link
            href={`/tasks/${t.id}`}
            className="group flex items-center gap-4 px-4 py-3 no-underline transition-colors hover:bg-surface-2"
          >
            <span className="font-mono text-[10px] tabular-nums text-foreground-faint">
              {String(i + 1).padStart(2, '0')}
            </span>
            <Dot className="sv-awaiting" size={6} pulse />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] font-semibold text-foreground">
                  {t.title}
                </span>
                <span className="rounded-[3px] border border-border-faint bg-surface-2 px-1.5 py-px font-mono text-[10px] font-medium uppercase tracking-[0.04em] text-foreground-muted">
                  {t.stage}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 font-mono text-[10.5px] text-foreground-subtle">
                <span>{t.projectName}</span>
                <span aria-hidden="true">·</span>
                <span>{t.branch}</span>
              </div>
            </div>
            <span className="hidden items-center gap-1.5 font-mono text-[10.5px] text-foreground-muted md:inline-flex">
              <Dot color={RISK_COLOR[t.risk] ?? RISK_COLOR.low} size={4} />
              {t.risk}
            </span>
            <div className="text-right">
              <div className="font-mono text-[12px] font-medium tabular-nums text-foreground">
                {t.waited}
              </div>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-foreground-subtle">
                waiting
              </div>
            </div>
            <span className="text-foreground-faint transition-colors group-hover:text-foreground">
              <ArrowUpRight className="h-4 w-4" />
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function DecisionList({
  items,
  loading,
}: {
  items: DecisionItem[];
  loading: boolean;
}) {
  if (loading && items.length === 0) {
    return (
      <div className="px-4 py-7 text-center text-[11.5px] text-foreground-subtle">
        Loading…
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="px-4 py-7 text-center text-[11.5px] text-foreground-subtle">
        No recent decisions.
      </div>
    );
  }
  return (
    <ol className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-3 top-3 w-px bg-border-faint"
        style={{ left: '22.5px' }}
      />
      {items.map((d) => {
        const meta = DECISION_META[d.decision] ?? {
          label: d.decision,
          tone: 'accent' as const,
        };
        const Icon = meta.tone === 'danger' ? X : Check;
        return (
          <li key={`${d.taskId}-${d.time}`} className="relative">
            <Link
              href={`/tasks/${d.taskId}`}
              className="flex items-start gap-3 px-4 py-2 no-underline transition-colors hover:bg-surface-2"
            >
              <span className="relative z-10 mt-1 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                <span
                  className="flex h-3 w-3 shrink-0 items-center justify-center rounded-full ring-2 ring-card"
                  style={{
                    background:
                      meta.tone === 'danger'
                        ? 'var(--danger)'
                        : meta.tone === 'ok'
                          ? 'var(--ok)'
                          : 'var(--accent)',
                  }}
                >
                  <Icon
                    className="h-2.25 w-2.25 shrink-0 text-white"
                    strokeWidth={2.5}
                  />
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-foreground">
                  <span className="font-medium">{meta.label}</span>
                  <span className="ml-1.5 font-mono text-[10.5px] uppercase tracking-[0.04em] text-foreground-subtle">
                    {d.stage}
                  </span>
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-[10.5px] text-foreground-subtle">
                  <span className="shrink-0">{d.time}</span>
                  <span className="shrink-0" aria-hidden="true">
                    ·
                  </span>
                  <span className="truncate">{d.projectName}</span>
                  <span className="shrink-0" aria-hidden="true">
                    ·
                  </span>
                  <span className="shrink-0 text-foreground-muted">
                    {d.taskId.length > 8
                      ? `tsk_${d.taskId.slice(-4)}`
                      : d.taskId}
                  </span>
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
