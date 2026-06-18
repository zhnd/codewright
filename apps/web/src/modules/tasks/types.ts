import type {
  EventLevel,
  ExecutionStatus,
  LogLevel,
  StageStatus,
  TaskBadge,
  TaskStage,
} from '@codewright/domain';

// ── tasks list types ──────────────────────────────────────────

export type TaskListStatusFilter =
  | 'all'
  | 'AWAITING_REVIEW'
  | 'RUNNING'
  | 'PENDING'
  | 'COMPLETED'
  | 'FAILED';

export interface TaskListRow {
  id: string;
  type: string;
  status: string;
  currentStage: string | null;
  stages: Record<string, string> | null;
  totalCostUsd: number | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
  project: { id: string; name: string } | null;
}

export interface FilterEntry {
  key: TaskListStatusFilter;
  label: string;
}

// ── task detail / shared types (used by task-detail-pane until
//    that module is extracted) ──────────────────────────────────

export interface StageDetail {
  status: StageStatus;
  duration: string;
  toolCalls: number;
  summary: string;
}

export interface TaskItem {
  id: string;
  title: string;
  status: ExecutionStatus;
  repo: string;
  branch: string;
  workflow: string;
  model: string;
  currentStage: TaskStage;
  stages: Partial<Record<TaskStage, StageStatus>>;
  stageDetails: Partial<Record<TaskStage, StageDetail>>;
  duration: string;
  cost: string;
  sandbox: string;
  badges: TaskBadge[];
  createdAt: string;
  projectName: string;
  triggerSource: string;
  /** Terminal-only error text, populated when status is failed/cancelled. */
  error: string | null;
  /** Server-recorded terminal timestamp; null while still running. */
  completedAt: string | null;
}

export interface TimelineEvent {
  timestamp: string;
  stage: TaskStage;
  event: string;
  level: EventLevel;
  agent?: string;
  tool?: string;
  details?: string;
  /** Typed event type (new-format field). Legacy rows carry `'Log'`. */
  eventType?: string;
  payload?: unknown;
  stageExecutionId?: string | null;
  attemptExecutionId?: string | null;
  spanId?: string | null;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
}

export interface DiffHunk {
  header: string;
  lines: { type: 'add' | 'remove' | 'context'; content: string }[];
}

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface CostBreakdown {
  stage: TaskStage;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  duration: string;
  model: string;
}

export interface ReplayStep {
  index: number;
  stage: TaskStage;
  action: string;
  input: string;
  output: string;
  model: string;
  tools: string[];
  duration: string;
  status: 'completed' | 'failed' | 'skipped';
}

export interface HealthAlert {
  type:
    | 'path_deviation'
    | 'missing_step'
    | 'test_failure'
    | 'blocked'
    | 'error';
  severity: 'critical' | 'warning' | 'info';
  message: string;
}

// ── Phase 2 observability view types ──────────────────────

export interface ToolCallView {
  id: string;
  agentTurnId: string | null;
  toolUseId: string;
  name: string;
  input: unknown;
  output: string | null;
  outputTruncatedAt: number | null;
  success: boolean | null;
  errorText: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  spanId: string;
}

export interface TurnView {
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

export interface AgentInvocationView {
  id: string;
  agentName: string;
  model: string;
  status: string;
  errorText: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  totalCostUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  turns: TurnView[];
  toolCalls: ToolCallView[];
  spanId: string;
}

export interface SampleView {
  id: string;
  attemptExecutionId: string;
  sampleIndex: number;
  branch: string;
  summary: string;
  filesChanged: string[];
  patch: string;
  additions: number;
  deletions: number;
  filterPassed: boolean;
  filterChecks: unknown;
  criticApproved: boolean | null;
  criticScore: number | null;
  criticConcerns: unknown;
  selected: boolean;
  createdAt: string;
}

export interface ReviewView {
  id: string;
  stageExecutionId: string;
  decisionType: string;
  action: string;
  feedback: string | null;
  userId: string | null;
  createdAt: string;
}

export interface AttemptView {
  id: string;
  attemptNumber: number;
  triggerKind: string;
  triggerPayload: unknown;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  spanId: string;
  invocations: AgentInvocationView[];
  samples: SampleView[];
}

export interface StageView {
  id: string;
  stageName: string;
  order: number;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  spanId: string;
  attempts: AttemptView[];
  reviews: ReviewView[];
}

export interface RetrospectiveView {
  id: string;
  summary: string | null;
  bottlenecks: Array<{ stageName: string; durationMs: number; reason: string }>;
  recommendations: Array<{
    kind: string;
    text: string;
    references?: string[];
  }>;
  riskFactors: Array<{ severity: string; text: string }>;
  stats: {
    totalDurationMs: number;
    perStage: Record<
      string,
      {
        durationMs: number;
        toolCallCount: number;
        agentInvocationCount: number;
        costUsd: number;
        inputTokens: number;
        outputTokens: number;
      }
    >;
    retryCount: number;
    sampleCount: number;
    reviewCount: number;
    totalCostUsd: number;
    toolHistogram: Record<string, number>;
  };
  model: string | null;
  costUsd: number | null;
  createdAt: string;
}

export interface ExecutionView {
  id: string;
  workflowKind: string;
  workflowVersion: number;
  traceId: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  stages: StageView[];
  retrospective: RetrospectiveView | null;
}

export interface TaskDetail {
  task: TaskItem;
  timeline: TimelineEvent[];
  logs: LogEntry[];
  diff: DiffFile[];
  cost: CostBreakdown[];
  replay: ReplayStep[];
  health: {
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    alerts: HealthAlert[];
    expectedPath: TaskStage[];
    actualPath: TaskStage[];
    missingSteps: string[];
  };
  summary: {
    description: string;
    issue: string;
    contextFiles: string[];
    outputs: string[];
    prUrl: string;
    testsPassed: number;
    testsFailed: number;
    confidence: number;
    pathDeviation: boolean;
    errorCount: number;
    retryCount: number;
    totalTokens: number;
    totalCost: string;
  };
  approvals: {
    id: string;
    type: string;
    status: 'pending' | 'approved' | 'rejected';
    description: string;
    timestamp: string;
  }[];

  // New observability surfaces (all optional — older tasks without
  // Phase 2 telemetry simply have empty arrays / null).
  currentExecution: ExecutionView | null;
  executions: ExecutionView[];
  samples: SampleView[];
  reviews: ReviewView[];

  // Phase 1 agent observability: per-stage-event agent invocation view
  // for the TraceView tab. Each entry pairs one TaskEvent with the agent
  // invocations recorded under it. Empty for tasks before this phase.
  eventInvocations: EventInvocationsView[];

  // Per-stage attempt timings used by VisualView (Gantt + breakdown).
  // Sourced from STAGE-kind TaskEvents directly, so it tracks any stage
  // that ran — including those without agent invocations (FILTER, PR).
  stageTimings: StageTimingView[];

  // Unified activity log for the Events tab. Merges three event sources
  // sorted by timestamp: stage transitions, agent invocations, tool
  // calls. Empty before any task progress.
  activityLog: ActivityLogEntry[];
}

export type ActivityCategory = 'stage' | 'agent' | 'tool';
export type ActivityLevel = 'info' | 'warn' | 'error';

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  category: ActivityCategory;
  /** Lowercase stage key for tag display (analyze / implement / ...). */
  stage: string;
  /** Primary line of text (e.g. "implementResolution started"). */
  title: string;
  /** Optional secondary text (model name, duration, cost summary). */
  detail?: string;
  level: ActivityLevel;
  /** When category = 'tool' / 'agent', the name of the tool / agent. */
  name?: string;
  durationMs?: number | null;
  costUsd?: number | null;
  /** Tool-specific outcome flag for the trailing dot. */
  success?: boolean | null;
}

export interface EventInvocationsView {
  /** TaskEvent.id */
  eventId: string;
  /** Stage key (uppercase, e.g. ANALYSIS / IMPLEMENT). */
  stageKey: string;
  attemptNumber: number;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  invocations: AgentInvocationView[];
}

export interface StageTimingView {
  /** TaskEvent.id */
  eventId: string;
  /** Stage key (uppercase from DB: ANALYSIS / REPRODUCE / IMPLEMENT / FILTER / CRITIC / PR). */
  stageKey: string;
  attemptNumber: number;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
}
