import { isTaskTerminal, type TaskStatus } from '@codewright/domain';
import { builder } from '../../infrastructure/graphql/builder.js';
import {
  type AttemptShape,
  type AwaitingShape,
  loadAwaiting,
  loadCurrentStageKey,
  loadStageView,
  loadTotalCost,
  type ReviewShape,
  type StageViewShape,
} from './loaders/task-stage-view.loader.js';

// ── ObjectRefs for the derived stage view ────────────────────────────

const TaskStageReview = builder
  .objectRef<ReviewShape>('TaskStageReview')
  .implement({
    fields: (t) => ({
      action: t.string({ resolve: (p) => p.action }),
      feedback: t.string({ nullable: true, resolve: (p) => p.feedback }),
      decidedBy: t.string({ nullable: true, resolve: (p) => p.decidedBy }),
      decidedAt: t.field({ type: 'DateTime', resolve: (p) => p.decidedAt }),
    }),
  });

const TaskStageAttempt = builder
  .objectRef<AttemptShape>('TaskStageAttempt')
  .implement({
    fields: (t) => ({
      attemptNumber: t.int({ resolve: (p) => p.attemptNumber }),
      status: t.string({ resolve: (p) => p.status }),
      input: t.field({
        type: 'Json',
        nullable: true,
        resolve: (p) => p.input,
      }),
      output: t.field({
        type: 'Json',
        nullable: true,
        resolve: (p) => p.output,
      }),
      error: t.string({ nullable: true, resolve: (p) => p.error }),
      startedAt: t.field({ type: 'DateTime', resolve: (p) => p.startedAt }),
      endedAt: t.field({
        type: 'DateTime',
        nullable: true,
        resolve: (p) => p.endedAt,
      }),
      durationMs: t.int({ nullable: true, resolve: (p) => p.durationMs }),
      review: t.field({
        type: TaskStageReview,
        nullable: true,
        resolve: (p) => p.review,
      }),
    }),
  });

const TaskStageView = builder
  .objectRef<StageViewShape>('TaskStageView')
  .implement({
    fields: (t) => ({
      key: t.string({ resolve: (p) => p.key }),
      status: t.string({ resolve: (p) => p.status }),
      attempts: t.field({
        type: [TaskStageAttempt],
        resolve: (p) => p.attempts,
      }),
    }),
  });

const TaskAwaiting = builder
  .objectRef<AwaitingShape>('TaskAwaiting')
  .implement({
    fields: (t) => ({
      stageKey: t.string({ resolve: (p) => p.stageKey }),
      attemptNumber: t.int({ resolve: (p) => p.attemptNumber }),
    }),
  });

// ── TaskEvent — direct Prisma row exposure (raw, for the events tab) ─

builder.prismaObject('TaskEvent', {
  fields: (t) => ({
    id: t.exposeID('id'),
    kind: t.exposeString('kind'),
    stageKey: t.exposeString('stageKey'),
    attemptNumber: t.exposeInt('attemptNumber'),
    status: t.exposeString('status'),
    input: t.expose('input', { type: 'Json', nullable: true }),
    output: t.expose('output', { type: 'Json', nullable: true }),
    error: t.exposeString('error', { nullable: true }),
    decidedBy: t.exposeString('decidedBy', { nullable: true }),
    startedAt: t.expose('startedAt', { type: 'DateTime' }),
    endedAt: t.expose('endedAt', { type: 'DateTime', nullable: true }),
    durationMs: t.exposeInt('durationMs', { nullable: true }),
    // Agent cost rollup for this stage attempt (sum across the stage's
    // agent runs). The task hero sums these across stages.
    costUsd: t.exposeFloat('costUsd', { nullable: true }),
    inputTokens: t.exposeInt('inputTokens', { nullable: true }),
    outputTokens: t.exposeInt('outputTokens', { nullable: true }),
    model: t.exposeString('model', { nullable: true }),
  }),
});

// ── Task ─────────────────────────────────────────────────────────────
//
// Resolvers for derived fields (`stages`, `currentStageKey`, `awaiting`)
// are one-liners that delegate to the loaders in `task-stage-view.ts`.
// Terminal-task short-circuits keep orphaned RUNNING/AWAITING stage
// events from being shown as "current" once the workflow has ended.

builder.prismaObject('Task', {
  fields: (t) => ({
    id: t.exposeID('id'),
    type: t.exposeString('type'),
    status: t.exposeString('status'),
    input: t.expose('input', { type: 'Json' }),
    triggerSource: t.exposeString('triggerSource'),
    error: t.exposeString('error', { nullable: true }),
    workflowId: t.exposeString('workflowId', { nullable: true }),

    project: t.relation('project', { nullable: true }),

    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    startedAt: t.expose('startedAt', { type: 'DateTime', nullable: true }),
    completedAt: t.expose('completedAt', { type: 'DateTime', nullable: true }),

    // Wall-clock for the list/hero: completed→span; running→elapsed; else null.
    durationMs: t.int({
      nullable: true,
      resolve: (task) => {
        if (!task.startedAt) return null;
        const end = task.completedAt ?? new Date();
        return Math.max(0, end.getTime() - task.startedAt.getTime());
      },
    }),

    // Agent cost rollup across the task's STAGE events (task hero / list).
    totalCostUsd: t.loadable({
      type: 'Float',
      nullable: true,
      load: (taskIds: readonly string[], ctx) =>
        loadTotalCost(taskIds, ctx.prisma),
      resolve: (parent) => parent.id,
    }),

    stages: t.loadableList({
      type: TaskStageView,
      load: (taskIds: string[], ctx) => loadStageView(taskIds, ctx.prisma),
      resolve: (parent) => parent.id,
    }),

    currentStageKey: t.loadable({
      type: 'String',
      nullable: true,
      load: (taskIds: readonly string[], ctx) =>
        loadCurrentStageKey(taskIds, ctx.prisma),
      // Returning null short-circuits the load (Pothos skips it on nullable
      // fields), so terminal tasks don't surface stale RUNNING/AWAITING
      // events as their "current" stage.
      resolve: (parent) =>
        isTaskTerminal(parent.status as TaskStatus) ? null : parent.id,
    }),

    awaiting: t.loadable({
      type: TaskAwaiting,
      nullable: true,
      load: (taskIds: readonly string[], ctx) =>
        loadAwaiting(taskIds, ctx.prisma),
      resolve: (parent) =>
        isTaskTerminal(parent.status as TaskStatus) ? null : parent.id,
    }),

    events: t.relation('events', {
      query: { orderBy: { startedAt: 'asc' } },
    }),
  }),
});
