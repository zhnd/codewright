import type { EventLevel, StageStatus, TaskStage } from '@codewright/domain';
import type {
  ActivityLevel,
  ActivityLogEntry,
  AgentInvocationView,
  AttemptView,
  CostBreakdown,
  DiffFile,
  EventInvocationsView,
  ExecutionView,
  HealthAlert,
  RetrospectiveView,
  ReviewView,
  SampleView,
  StageDetail,
  StageTimingView,
  StageView,
  TaskDetail,
  TaskItem,
  TimelineEvent,
  ToolCallView,
  TurnView,
} from './types';

// ── API response shapes ─────────────────────────────────────

// task_event row as returned by server (matches Prisma TaskEvent).
interface ApiEvent {
  id: string;
  kind: string; // 'STAGE' | 'REVIEW'
  stageKey: string; // 'ANALYSIS' | 'REPRODUCE' | ...
  attemptNumber: number;
  status: string;
  input?: unknown;
  output?: unknown;
  error?: string | null;
  decidedBy?: string | null;
  startedAt: string;
  endedAt?: string | null;
  durationMs?: number | null;
  agentInvocations?: ApiInvocation[];
}

interface ApiToolCall {
  id: string;
  agentTurnId: string | null;
  toolUseId: string;
  name: string;
  input: unknown;
  output: string | null;
  outputTruncatedAt: number | null;
  success: boolean | null;
  errorText: string | null;
  spanId: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
}

interface ApiTurn {
  id: string;
  turnIndex: number;
  role: string;
  textContent: string | null;
  textTruncatedAt: number | null;
  toolUseCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  startedAt: string;
}

interface ApiInvocation {
  id: string;
  agentName: string;
  model: string;
  status: string;
  errorText: string | null;
  spanId: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  totalCostUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  turns: ApiTurn[];
  toolCalls: ApiToolCall[];
}

interface ApiAttempt {
  id: string;
  attemptNumber: number;
  triggerKind: string;
  triggerPayload: unknown;
  spanId: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  invocations: ApiInvocation[];
}

interface ApiStage {
  id: string;
  stageName: string;
  order: number;
  status: string;
  spanId: string;
  parentSpanId: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  attempts: ApiAttempt[];
}

interface ApiRetrospective {
  id: string;
  summary: string | null;
  bottlenecks: unknown;
  recommendations: unknown;
  riskFactors: unknown;
  stats: unknown;
  model: string | null;
  costUsd: number | null;
  createdAt: string;
}

interface ApiExecution {
  id: string;
  workflowKind: string;
  workflowVersion: number;
  traceId: string;
  temporalWorkflowId?: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  stages: ApiStage[];
  retrospective: ApiRetrospective | null;
}

export interface ApiTask {
  id: string;
  type: string;
  status: string;
  error?: string | null;
  workflowId?: string | null;
  events?: ApiEvent[];
  executions?: ApiExecution[];
  project?: { id: string; name: string; repositoryUrl?: string } | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

// ── Status mapping ──────────────────────────────────────────

type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'blocked'
  | 'needs_review'
  | 'completed'
  | 'failed';

function mapStatus(status: string): ExecutionStatus {
  switch (status) {
    case 'PENDING':
      return 'queued';
    case 'RUNNING':
      return 'running';
    case 'COMPLETED':
      return 'completed';
    case 'FAILED':
    case 'CANCELLED':
      return 'failed';
    default:
      return 'queued';
  }
}

const KNOWN_STAGES: TaskStage[] = [
  'analysis',
  'plan',
  'implement',
  'test',
  'pr',
];

// ── Transform ──────────────────────────────────────────────

export function transformTaskToItem(apiTask: ApiTask): TaskItem {
  const totals = computeAgentTotals(apiTask.events ?? []);
  return {
    id: apiTask.id,
    title: apiTask.type.replace(/_/g, ' '),
    status: mapStatus(apiTask.status),
    repo: apiTask.project?.repositoryUrl ?? '',
    branch: '',
    workflow: apiTask.type,
    model: totals.model ?? '',
    currentStage: 'analysis' as TaskStage,
    stages: {} as Partial<Record<TaskStage, StageStatus>>,
    stageDetails: {} as Partial<Record<TaskStage, StageDetail>>,
    duration: formatTaskDuration(
      apiTask.startedAt ?? null,
      apiTask.completedAt ?? null,
      apiTask.status
    ),
    cost: formatCostUsd(totals.totalCostUsd),
    sandbox: '',
    badges: [],
    createdAt: apiTask.createdAt,
    projectName: apiTask.project?.name ?? '',
    triggerSource: 'manual',
    error: apiTask.error ?? null,
    completedAt: apiTask.completedAt ?? null,
  };
}

export function transformTaskToDetail(apiTask: ApiTask): TaskDetail {
  const task = transformTaskToItem(apiTask);
  const events = apiTask.events ?? [];
  const executions = (apiTask.executions ?? []).map(mapExecution);
  const currentExecution = executions[0] ?? null;

  const timeline: TimelineEvent[] = events.map(mapEvent);

  // Phase 1 trace view: pair each STAGE-kind event with its agent
  // invocations. Drop events with zero invocations (REVIEW-kind, FILTER,
  // PR, anything else with no agent run) so TraceView only shows useful
  // rows.
  const eventInvocations: EventInvocationsView[] = events
    .filter((e) => e.kind === 'STAGE' && (e.agentInvocations ?? []).length > 0)
    .map((e) => ({
      eventId: e.id,
      stageKey: e.stageKey,
      attemptNumber: e.attemptNumber,
      status: e.status,
      startedAt: e.startedAt,
      endedAt: e.endedAt ?? null,
      durationMs: e.durationMs ?? null,
      invocations: (e.agentInvocations ?? []).map(mapInvocation),
    }));

  // Visual tab Gantt + breakdown source: every STAGE-kind TaskEvent
  // becomes one timing entry. Includes stages without agents (FILTER,
  // PR) since they still take wall time worth visualizing.
  const stageTimings: StageTimingView[] = events
    .filter((e) => e.kind === 'STAGE')
    .map((e) => ({
      eventId: e.id,
      stageKey: e.stageKey,
      attemptNumber: e.attemptNumber,
      status: e.status,
      startedAt: e.startedAt,
      endedAt: e.endedAt ?? null,
      durationMs: e.durationMs ?? null,
    }));

  // Activity log: stage transitions + agent invocations + tool calls
  // merged into one chronological feed.
  const activityLog = buildActivityLog(events);

  // Cost rollup is deferred to the agent_log work — empty for now.
  const cost: CostBreakdown[] = [];
  const diff: DiffFile[] = [];

  // Health: derived from FAILED stage events on the latest attempt.
  const failedStageKeys = new Set<string>();
  const completedStageKeys = new Set<string>();
  const latestStageStatus = new Map<string, string>();
  for (const e of events) {
    if (e.kind !== 'STAGE') continue;
    const prev = latestStageStatus.get(e.stageKey);
    // Keep latest by attempt order (events sorted asc by startedAt).
    latestStageStatus.set(e.stageKey, e.status);
    void prev;
  }
  for (const [key, status] of latestStageStatus.entries()) {
    if (status === 'FAILED') failedStageKeys.add(key.toLowerCase());
    if (status === 'COMPLETED') completedStageKeys.add(key.toLowerCase());
  }
  const failedStages = KNOWN_STAGES.filter((s) => failedStageKeys.has(s));
  const completedStages = KNOWN_STAGES.filter((s) => completedStageKeys.has(s));
  const alerts: HealthAlert[] = failedStages.map((s) => ({
    type: 'error' as const,
    severity: 'warning' as const,
    message: `Stage "${s}" failed`,
  }));

  const samples: SampleView[] = [];
  const reviews: ReviewView[] = [];

  // PR URL is on the latest PR stage event's output.
  let prUrl = '';
  const prEvent = [...events]
    .reverse()
    .find((e) => e.kind === 'STAGE' && e.stageKey === 'PR' && e.output);
  if (prEvent) {
    const out = prEvent.output as { url?: string };
    if (out.url) prUrl = String(out.url);
  }

  const retryCount =
    currentExecution?.stages.reduce(
      (acc, s) => acc + Math.max(0, s.attempts.length - 1),
      0
    ) ?? 0;

  const totals = computeAgentTotals(events);

  return {
    task,
    timeline,
    logs: [],
    diff,
    cost,
    replay: [],
    health: {
      riskLevel: failedStages.length > 0 ? 'medium' : 'low',
      alerts,
      expectedPath: KNOWN_STAGES,
      actualPath: completedStages,
      missingSteps: [],
    },
    summary: {
      description: apiTask.type.replace(/_/g, ' '),
      issue: '',
      contextFiles: [],
      outputs: [],
      prUrl,
      testsPassed: 0,
      testsFailed: 0,
      confidence: 0,
      pathDeviation: false,
      errorCount: failedStages.length,
      retryCount,
      totalTokens: totals.totalInputTokens + totals.totalOutputTokens,
      totalCost: formatCostUsd(totals.totalCostUsd),
    },
    approvals: [],
    currentExecution,
    executions,
    samples,
    reviews,
    eventInvocations,
    stageTimings,
    activityLog,
  };
}

// ── Activity log derivation ─────────────────────────────────

/**
 * Flatten three event sources into a single chronological feed:
 *   - STAGE transitions (open / terminal) from TaskEvent
 *   - REVIEW events from TaskEvent
 *   - agent invocation start / end
 *   - per-tool calls
 *
 * Each entry carries enough metadata for the row to render without
 * additional lookups; sort is stable by timestamp ascending.
 */
function buildActivityLog(events: ApiEvent[]): ActivityLogEntry[] {
  const out: ActivityLogEntry[] = [];

  for (const e of events) {
    const stage = e.stageKey.toLowerCase();
    const stageDisplay = e.stageKey;

    if (e.kind === 'STAGE') {
      out.push({
        id: `stage-open-${e.id}`,
        timestamp: e.startedAt,
        category: 'stage',
        stage,
        title: `${stageDisplay} attempt ${e.attemptNumber} opened`,
        level: 'info',
      });
      if (e.endedAt) {
        out.push({
          id: `stage-end-${e.id}`,
          timestamp: e.endedAt,
          category: 'stage',
          stage,
          title: `${stageDisplay} attempt ${e.attemptNumber} ${e.status.toLowerCase()}`,
          detail:
            typeof e.durationMs === 'number'
              ? formatActivityDuration(e.durationMs)
              : undefined,
          level: stageStatusLevel(e.status),
        });
      }
    } else if (e.kind === 'REVIEW' && e.endedAt) {
      out.push({
        id: `review-${e.id}`,
        timestamp: e.endedAt,
        category: 'stage',
        stage,
        title: `Review submitted on ${stageDisplay}`,
        level: e.status === 'COMPLETED' ? 'info' : 'warn',
      });
    }

    for (const inv of e.agentInvocations ?? []) {
      out.push({
        id: `agent-start-${inv.id}`,
        timestamp: inv.startedAt,
        category: 'agent',
        stage,
        title: `${inv.agentName} started`,
        detail: inv.model,
        level: 'info',
        name: inv.agentName,
      });
      if (inv.endedAt) {
        const turnCount = inv.turns.length;
        const cost =
          typeof inv.totalCostUsd === 'number'
            ? `$${inv.totalCostUsd.toFixed(4)}`
            : null;
        const duration =
          typeof inv.durationMs === 'number'
            ? formatActivityDuration(inv.durationMs)
            : null;
        const detail = [
          turnCount > 0
            ? `${turnCount} turn${turnCount === 1 ? '' : 's'}`
            : null,
          cost,
          duration,
        ]
          .filter(Boolean)
          .join(' · ');
        out.push({
          id: `agent-end-${inv.id}`,
          timestamp: inv.endedAt,
          category: 'agent',
          stage,
          title: `${inv.agentName} ${inv.status.toLowerCase()}`,
          detail: detail || undefined,
          level: inv.status === 'ERROR' ? 'error' : 'info',
          name: inv.agentName,
          durationMs: inv.durationMs ?? null,
          costUsd: inv.totalCostUsd ?? null,
        });
      }

      for (const tc of inv.toolCalls) {
        out.push({
          id: `tool-${tc.id}`,
          timestamp: tc.startedAt,
          category: 'tool',
          stage,
          title: tc.name,
          detail:
            typeof tc.durationMs === 'number'
              ? formatActivityDuration(tc.durationMs)
              : undefined,
          level: tc.success === false ? 'error' : 'info',
          name: tc.name,
          durationMs: tc.durationMs ?? null,
          success: tc.success,
        });
      }
    }
  }

  out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return out;
}

function stageStatusLevel(status: string): ActivityLevel {
  switch (status) {
    case 'FAILED':
      return 'error';
    case 'REJECTED':
    case 'AWAITING':
      return 'warn';
    default:
      return 'info';
  }
}

// ── Header stat helpers ─────────────────────────────────────

interface AgentTotals {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  /** First non-empty model string seen — used as the "current model"
   *  shown next to the project name in the hero. */
  model: string | null;
}

function computeAgentTotals(events: ApiEvent[]): AgentTotals {
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let model: string | null = null;
  for (const e of events) {
    for (const inv of e.agentInvocations ?? []) {
      totalCostUsd += inv.totalCostUsd ?? 0;
      totalInputTokens += inv.inputTokens ?? 0;
      totalOutputTokens += inv.outputTokens ?? 0;
      if (model == null && inv.model && inv.model !== 'unknown') {
        model = inv.model;
      }
    }
  }
  return { totalCostUsd, totalInputTokens, totalOutputTokens, model };
}

/**
 * Walltime for the task header. Pending → em dash; running → live
 * elapsed since startedAt; terminal → startedAt → completedAt.
 */
function formatTaskDuration(
  startedAt: string | null,
  completedAt: string | null,
  status: string
): string {
  if (!startedAt) return '—';
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const ms = Math.max(0, end - start);
  const formatted = formatActivityDuration(ms);
  // Trailing dot suffix communicates "still ticking" without forcing
  // continuous re-render.
  return status === 'RUNNING' ? `${formatted}+` : formatted;
}

/** Smart-precision USD formatter. Sub-cent amounts keep 4 decimals so
 *  small agent runs don't all round to "$0.00". */
function formatCostUsd(usd: number): string {
  if (usd <= 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatActivityDuration(ms: number): string {
  const total = Math.round(ms);
  if (total < 1000) return `${total}ms`;
  const totalSeconds = Math.round(total / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

// ── Sub-mappers ──────────────────────────────────────────────

function mapEvent(e: ApiEvent): TimelineEvent {
  const stage = e.stageKey.toLowerCase() as TaskStage;
  const event = `${e.kind} attempt ${e.attemptNumber} → ${e.status.toLowerCase()}`;
  const level: EventLevel =
    e.status === 'FAILED' || e.status === 'REJECTED' ? 'warn' : 'info';
  return {
    timestamp: e.startedAt,
    stage,
    event,
    level,
    eventType: e.kind,
    payload: e.output ?? e.input,
    stageExecutionId: null,
    attemptExecutionId: null,
    spanId: null,
  };
}

function mapExecution(e: ApiExecution): ExecutionView {
  return {
    id: e.id,
    workflowKind: e.workflowKind,
    workflowVersion: e.workflowVersion,
    traceId: e.traceId,
    status: e.status,
    startedAt: e.startedAt,
    endedAt: e.endedAt,
    durationMs: e.durationMs,
    stages: e.stages.map(mapStage),
    retrospective: e.retrospective ? mapRetrospective(e.retrospective) : null,
  };
}

function mapStage(s: ApiStage): StageView {
  return {
    id: s.id,
    stageName: s.stageName,
    order: s.order,
    status: s.status,
    spanId: s.spanId,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    durationMs: s.durationMs,
    attempts: s.attempts.map(mapAttempt),
    reviews: [],
  };
}

function mapAttempt(a: ApiAttempt): AttemptView {
  return {
    id: a.id,
    attemptNumber: a.attemptNumber,
    triggerKind: a.triggerKind,
    triggerPayload: a.triggerPayload,
    spanId: a.spanId,
    status: a.status,
    startedAt: a.startedAt,
    endedAt: a.endedAt,
    durationMs: a.durationMs,
    invocations: a.invocations.map(mapInvocation),
    samples: [],
  };
}

function mapInvocation(i: ApiInvocation): AgentInvocationView {
  return {
    id: i.id,
    agentName: i.agentName,
    model: i.model,
    status: i.status,
    errorText: i.errorText,
    spanId: i.spanId,
    startedAt: i.startedAt,
    endedAt: i.endedAt,
    durationMs: i.durationMs,
    totalCostUsd: i.totalCostUsd,
    inputTokens: i.inputTokens,
    outputTokens: i.outputTokens,
    turns: i.turns.map(mapTurn),
    toolCalls: i.toolCalls.map(mapToolCall),
  };
}

function mapTurn(t: ApiTurn): TurnView {
  return {
    id: t.id,
    turnIndex: t.turnIndex,
    role: t.role,
    textContent: t.textContent,
    textTruncatedAt: t.textTruncatedAt,
    toolUseCount: t.toolUseCount,
    inputTokens: t.inputTokens,
    outputTokens: t.outputTokens,
    startedAt: t.startedAt,
  };
}

function mapToolCall(tc: ApiToolCall): ToolCallView {
  return {
    id: tc.id,
    agentTurnId: tc.agentTurnId,
    toolUseId: tc.toolUseId,
    name: tc.name,
    input: tc.input,
    output: tc.output,
    outputTruncatedAt: tc.outputTruncatedAt,
    success: tc.success,
    errorText: tc.errorText,
    spanId: tc.spanId,
    startedAt: tc.startedAt,
    endedAt: tc.endedAt,
    durationMs: tc.durationMs,
  };
}

function mapRetrospective(r: ApiRetrospective): RetrospectiveView {
  return {
    id: r.id,
    summary: r.summary,
    bottlenecks: Array.isArray(r.bottlenecks)
      ? (r.bottlenecks as RetrospectiveView['bottlenecks'])
      : [],
    recommendations: Array.isArray(r.recommendations)
      ? (r.recommendations as RetrospectiveView['recommendations'])
      : [],
    riskFactors: Array.isArray(r.riskFactors)
      ? (r.riskFactors as RetrospectiveView['riskFactors'])
      : [],
    stats: (r.stats as RetrospectiveView['stats']) ?? {
      totalDurationMs: 0,
      perStage: {},
      retryCount: 0,
      sampleCount: 0,
      reviewCount: 0,
      totalCostUsd: 0,
      toolHistogram: {},
    },
    model: r.model,
    costUsd: r.costUsd,
    createdAt: r.createdAt,
  };
}
