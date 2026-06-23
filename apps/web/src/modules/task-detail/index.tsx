'use client';

import { GitBranch } from 'lucide-react';
import { StatusChip } from '@/components/common/status-chip';
import { Tally } from '@/components/common/tally';
import { AppShell } from '@/components/layout/app-shell';
import { PageHeader } from '@/components/layout/page-header';
import { ActivityView } from './components/activity-view';
import { DetailTabsBar } from './components/detail-tabs-bar';
import { HeaderActions } from './components/header-actions';
import { HeroStat } from './components/hero-stat';
import { TimelineView } from './components/timeline-view';
import { AnalyzeRepositoryView } from './components/views/analyze-repository-view';
import { InputView } from './components/views/input-view';
import { ResolveDefectView } from './components/views/resolve-defect-view';
import { TAB_CONTENT_WIDTH, TAB_SCROLL_PADDING } from './constants';
import { useService } from './use-service';

interface TaskDetailProps {
  taskId: string;
}

export function TaskDetail({ taskId }: TaskDetailProps) {
  const {
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
  } = useService({ taskId });

  if (loading && !detail) {
    return (
      <AppShell scroll={false}>
        <PageHeader
          segments={[{ label: 'Tasks', href: '/tasks' }, { label: 'Loading…' }]}
        />
        <div className="flex flex-1 items-center justify-center text-[12px] text-foreground-subtle">
          Loading task…
        </div>
      </AppShell>
    );
  }
  if (!detail) {
    return (
      <AppShell scroll={false}>
        <PageHeader
          segments={[
            { label: 'Tasks', href: '/tasks' },
            { label: 'Not found' },
          ]}
        />
        <div className="flex flex-1 items-center justify-center text-[12.5px] text-foreground-muted">
          Task not found
        </div>
      </AppShell>
    );
  }

  // Breadcrumb leaf: the humanized workflow type (e.g. "Resolve defect").
  // The full task id lives in the hero for copying.
  const workflowLabel = detail.task.workflow
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

  return (
    <AppShell scroll={false}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PageHeader
          segments={[
            { label: 'Tasks', href: '/tasks' },
            { label: workflowLabel },
          ]}
          actions={
            <HeaderActions
              taskId={taskId}
              status={detail.task.status}
              prUrl={detail.summary.prUrl}
              onCancel={cancel}
              canceling={canceling}
              onRetry={retry}
              retrying={retrying}
            />
          }
        />

        {/* Hero */}
        <div className="shrink-0 border-b border-border-faint bg-card px-4 pt-5 pb-3 sm:px-6 lg:px-7">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusChip status={detail.task.status.toUpperCase()} />
            <span className="font-mono text-[10.5px] tabular-nums text-foreground-subtle">
              {taskId}
            </span>
            {detail.task.repo && (
              <span className="inline-flex items-center gap-1.25 rounded-sm border border-border-faint bg-surface-2 px-1.75 py-px font-mono text-[10.5px] text-foreground-muted">
                <GitBranch className="h-2.75 w-2.75" />
                {detail.task.repo.replace(/^https?:\/\/github\.com\//, '')}
              </span>
            )}
          </div>
          <div className="flex items-start justify-between gap-5">
            <div className="min-w-0 flex-1">
              <h1 className="m-0 text-[15px] font-semibold leading-[1.35] tracking-normal text-foreground">
                <button
                  type="button"
                  onClick={() => setTab('input')}
                  title="View full request"
                  className="line-clamp-1 cursor-pointer border-none bg-transparent p-0 text-left text-inherit hover:underline"
                >
                  {detail.summary.description || detail.task.title}
                </button>
              </h1>
            </div>
            <div className="hidden items-stretch gap-0 rounded-sm border border-border bg-card md:flex">
              <HeroStat label="DURATION" value={detail.task.duration} />
              <span className="my-2 w-px bg-border-faint" />
              <HeroStat label="COST" value={detail.task.cost} />
            </div>
          </div>
          <Tally className="mt-3" />
        </div>

        <div className="shrink-0 overflow-x-auto border-b border-border bg-card px-4 sm:px-6 lg:px-7">
          <DetailTabsBar tab={tab} onChange={setTab} />
        </div>

        {/* Body — overview is per-task-type; input + activity + visual are shared */}
        {tab === 'overview' &&
          (detail.task.workflow === 'ANALYZE_REPOSITORY' ? (
            <AnalyzeRepositoryView
              detail={detail}
              analyzeStage={stageData.analyze}
            />
          ) : (
            <ResolveDefectView
              detail={detail}
              stages={stages}
              stageData={stageData}
              selectedStage={selectedStage}
              setSelectedStage={setSelectedStage}
              timings={timings}
              submitReview={submitReview}
              reviewing={reviewing}
              hitlWaited={hitlWaited}
            />
          ))}

        {tab === 'input' && (
          <div
            className={`min-h-0 flex-1 overflow-y-auto ${TAB_SCROLL_PADDING}`}
          >
            <div className={TAB_CONTENT_WIDTH}>
              <InputView detail={detail} />
            </div>
          </div>
        )}

        {tab === 'activity' && (
          <ActivityView
            taskId={taskId}
            isRunning={detail.task.status === 'running'}
            workflow={detail.task.workflow}
            stages={detail.stageTimings}
          />
        )}

        {tab === 'timeline' && (
          <div
            className={`min-h-0 flex-1 overflow-y-auto ${TAB_SCROLL_PADDING}`}
          >
            <div className={TAB_CONTENT_WIDTH}>
              <TimelineView
                stageTimings={detail.stageTimings}
                onSelectStage={(stage) => {
                  setSelectedStage(stage);
                  setTab('overview');
                }}
              />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
