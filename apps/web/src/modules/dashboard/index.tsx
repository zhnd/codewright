'use client';

import {
  ArrowUpRight,
  Clock4,
  GitMerge,
  Plus,
  Sparkles,
  Workflow,
  ZapOff,
} from 'lucide-react';
import Link from 'next/link';
import { PanelCard } from '@/components/common/panel-card';
import { StatTile } from '@/components/common/stat-tile';
import { Tally } from '@/components/common/tally';
import { AppShell } from '@/components/layout/app-shell';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { AwaitingReviewTable } from './components/awaiting-review-table';
import { RecentActivity } from './components/recent-activity';
import { useService } from './use-service';

export function Dashboard() {
  const {
    loading,
    projects,
    summary,
    awaitingRows,
    activityRows,
    stageDistribution,
    projectActivity,
  } = useService();

  return (
    <AppShell>
      <PageHeader
        segments={[{ label: 'Dashboard' }]}
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
        {/* Hero — mono eyebrow + sans hero, period selector right */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-1.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-foreground-subtle">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-accent codewright-pulse" />
              live · auto-refresh
            </div>
            <h1 className="m-0 text-[26px] font-semibold leading-[1.05] tracking-normal text-foreground">
              Operations
            </h1>
            <p className="mt-1.5 max-w-110 text-[12.5px] text-foreground-muted">
              Agent workforce across {projects.length}{' '}
              {projects.length === 1 ? 'project' : 'projects'} · auto-refreshed
              every 5s.
            </p>
          </div>
        </div>

        {/* Stat tiles row */}
        <div className="mb-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4 xl:grid-cols-5">
          <StatTile
            index="01"
            label="Awaiting review"
            value={loading ? '—' : summary.awaitingCount}
            hint={
              summary.awaitingCount > 0
                ? `${summary.awaitingCount} ${summary.awaitingCount === 1 ? 'task needs' : 'tasks need'} you`
                : 'All clear · nothing waiting'
            }
            icon={Clock4}
            emphasis={summary.awaitingCount > 0}
            href="/tasks?status=AWAITING_REVIEW"
          />
          <StatTile
            index="02"
            label="Active tasks"
            value={loading ? '—' : summary.activeCount}
            hint={`${summary.runningCount} running · ${summary.queuedCount} queued`}
            icon={Workflow}
            href="/tasks?status=RUNNING"
          />
          <StatTile
            index="03"
            label="Success rate"
            value={
              loading
                ? '—'
                : summary.successRate !== null
                  ? `${summary.successRate}%`
                  : '—'
            }
            hint={
              summary.recentOutcomeCount > 0
                ? `${summary.completedCount}/${summary.completedCount + summary.failedCount} merged`
                : 'No outcomes yet'
            }
            icon={GitMerge}
            href="/tasks?status=COMPLETED"
          />
          <StatTile
            index="04"
            label="Failures · 7d"
            value={loading ? '—' : summary.failedCount}
            hint={
              summary.failedCount > 0
                ? `Investigate the failed runs`
                : 'No failures recorded'
            }
            icon={ZapOff}
            emphasis={summary.failedCount > 0}
            tone="danger"
            href="/tasks?status=FAILED"
          />
          <StatTile
            index="05"
            label="Tokens · today"
            value="—"
            hint="Not tracked yet"
            icon={Sparkles}
          />
        </div>

        {/* Three-column secondary panels */}
        <div className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <PanelCard
            title="Stage distribution"
            caption={`${summary.activeCount} active`}
          >
            <StageDistribution
              rows={stageDistribution}
              total={summary.activeCount}
            />
          </PanelCard>

          <PanelCard
            title="Project activity"
            action={
              <Link
                href="/projects"
                className="font-mono text-[10.5px] text-foreground-muted no-underline hover:text-foreground"
              >
                view all
              </Link>
            }
          >
            <ProjectActivity rows={projectActivity} />
          </PanelCard>

          <PanelCard title="Agent pool" caption="Not tracked yet">
            <AgentPool />
          </PanelCard>
        </div>

        {/* Awaiting + Recent activity, side-by-side at xl, stacked otherwise */}
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[2fr_1fr]">
          <PanelCard
            title="Awaiting your review"
            caption={`${summary.awaitingCount} ${summary.awaitingCount === 1 ? 'task' : 'tasks'}`}
            action={
              <Button variant="ghost" size="sm" asChild className="h-7">
                <Link
                  href="/tasks?status=AWAITING_REVIEW"
                  className="text-[11.5px]"
                >
                  View all
                  <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            }
            noPad
          >
            <AwaitingReviewTable rows={awaitingRows} />
          </PanelCard>

          <PanelCard title="Recent activity" caption="last 10" noPad>
            <RecentActivity rows={activityRows} />
          </PanelCard>
        </div>
      </div>
    </AppShell>
  );
}

// ── Sub-widgets local to dashboard ──────────────────────────────────

function StageDistribution({
  rows,
  total,
}: {
  rows: { key: string; label: string; count: number; percent: number }[];
  total: number;
}) {
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-3">
          <span className="w-19 text-[12px] font-medium text-foreground">
            {r.label}
          </span>
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-inset">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-foreground transition-[width] duration-500"
              style={{ width: `${Math.max(r.count > 0 ? 4 : 0, r.percent)}%` }}
            />
          </div>
          <span className="w-7 text-right font-mono text-[11px] tabular-nums text-foreground-muted">
            {r.count}
          </span>
        </div>
      ))}
      {total === 0 && (
        <div className="py-1 text-center text-[11.5px] text-foreground-subtle">
          No active tasks
        </div>
      )}
      <Tally className="mt-3" />
    </div>
  );
}

function ProjectActivity({
  rows,
}: {
  rows: {
    id: string;
    name: string;
    total: number;
    active: number;
    awaiting: number;
  }[];
}) {
  if (rows.length === 0) {
    return (
      <div className="py-2 text-center text-[11.5px] text-foreground-subtle">
        No projects yet
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      {rows.map((p) => (
        <Link
          key={p.id}
          href={`/projects/${p.id}`}
          className="-mx-1 flex items-center gap-2.5 rounded-sm px-1 py-0.5 no-underline transition-colors hover:bg-surface-2"
        >
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-[11px] font-bold text-background"
            style={{ background: 'oklch(0.32 0.02 70)' }}
          >
            {p.name.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
            {p.name}
          </span>
          {p.awaiting > 0 && (
            <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent-ink">
              {p.awaiting} ●
            </span>
          )}
          <span className="font-mono text-[11px] text-foreground-muted">
            {p.active}/{p.total}
          </span>
        </Link>
      ))}
    </div>
  );
}

/**
 * Worker concurrency / queue / throughput would be sourced from
 * Temporal worker telemetry — not wired yet. Renders a neutral
 * placeholder so the panel doesn't surface fabricated metrics.
 */
function AgentPool() {
  return (
    <div className="flex flex-col gap-3 py-4">
      <div className="font-mono text-[28px] font-medium leading-none tabular-nums tracking-normal text-foreground-faint">
        —
      </div>
      <p className="text-[11.5px] leading-normal text-foreground-subtle">
        Worker pool telemetry (queue depth, throughput, error rate) is not wired
        up yet. Will surface here once the worker exposes these metrics.
      </p>
      <Tally className="mt-1" />
    </div>
  );
}
