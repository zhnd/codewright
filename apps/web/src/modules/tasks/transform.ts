import type { EventLevel, StageStatus, TaskStage } from '@codewright/domain';
import { formatCostUsd, formatDuration } from '@/utils/format';
import { dbStageToWebStage } from '@/utils/stages';
import type {
  CostBreakdown,
  DiffFile,
  HealthAlert,
  ReviewView,
  SampleView,
  StageCostView,
  StageDetail,
  StageTimingView,
  TaskDetail,
  TaskItem,
  TimelineEvent,
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
  // Agent cost rollup for this stage attempt (server-derived).
  costUsd?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  model?: string | null;
}

export interface ApiTask {
  id: string;
  type: string;
  status: string;
  input?: unknown;
  error?: string | null;
  workflowId?: string | null;
  events?: ApiEvent[];
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

/**
 * Human-readable description of what the task was asked to do, pulled from
 * its `input` payload (defectDescription / instructions / …). Falls back to
 * the humanized workflow type when the input carries no obvious text.
 */
export function describeInput(type: string, input: unknown): string {
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    for (const key of INPUT_BODY_KEYS) {
      const v = o[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return type.replace(/_/g, ' ');
}

// Keys searched (in order) for the human-authored body of a task input.
const INPUT_BODY_KEYS = [
  'defectDescription',
  'instructions',
  'description',
  'prompt',
  'query',
] as const;

// Keys never shown as metadata fields: internal plumbing + the body keys
// (already rendered as the main description).
const INPUT_HIDDEN_KEYS = new Set<string>([
  'taskId',
  'projectId',
  'userId',
  ...INPUT_BODY_KEYS,
]);

export interface MediaItem {
  url: string;
  /** Image/video caption or attachment filename, when provided. */
  label?: string;
}

export interface ParsedInput {
  /** Human-authored description (markdown), or null when input has no text. */
  body: string | null;
  /** Remaining scalar fields (baseBranch / tapdBugId / repository …). */
  fields: { key: string; value: string }[];
  images: MediaItem[];
  videos: MediaItem[];
  attachments: MediaItem[];
}

/** camelCase → "Camel case" for field labels. */
function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Normalize a (provisional) media array off the input payload. Tolerates
 * elements that are either a bare URL string or an object carrying a
 * `url` plus an optional `caption` / `description` / `name`.
 *
 * NOTE: the field names (`images` / `videos` / `attachments`) and element
 * shape are a forward-compatible convention — no backend writes them yet.
 * When the upload feature lands, reconcile the real shape HERE only.
 */
function normalizeMedia(
  input: Record<string, unknown>,
  key: string
): MediaItem[] {
  const raw = input[key];
  if (!Array.isArray(raw)) return [];
  const out: MediaItem[] = [];
  for (const el of raw) {
    if (typeof el === 'string' && el.trim()) {
      out.push({ url: el.trim() });
    } else if (el && typeof el === 'object') {
      const o = el as Record<string, unknown>;
      const url = o.url ?? o.src ?? o.href;
      if (typeof url === 'string' && url.trim()) {
        const label = o.caption ?? o.description ?? o.name ?? o.title;
        out.push({
          url: url.trim(),
          label:
            typeof label === 'string' && label.trim()
              ? label.trim()
              : undefined,
        });
      }
    }
  }
  return out;
}

/**
 * Split a raw task `input` payload into the pieces the Input tab renders:
 * the main description body, the remaining scalar metadata fields, and any
 * (future) image / video / attachment media.
 */
export function parseTaskInput(input: unknown): ParsedInput {
  const empty: ParsedInput = {
    body: null,
    fields: [],
    images: [],
    videos: [],
    attachments: [],
  };
  if (!input || typeof input !== 'object') return empty;
  const o = input as Record<string, unknown>;

  let body: string | null = null;
  for (const key of INPUT_BODY_KEYS) {
    const v = o[key];
    if (typeof v === 'string' && v.trim()) {
      body = v.trim();
      break;
    }
  }

  const fields: { key: string; value: string }[] = [];
  for (const [key, value] of Object.entries(o)) {
    if (INPUT_HIDDEN_KEYS.has(key)) continue;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      const str = String(value).trim();
      if (str) fields.push({ key: humanizeKey(key), value: str });
    }
  }

  return {
    body,
    fields,
    images: normalizeMedia(o, 'images'),
    videos: normalizeMedia(o, 'videos'),
    attachments: normalizeMedia(o, 'attachments'),
  };
}

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
    input: apiTask.input,
  };
}

export function transformTaskToDetail(apiTask: ApiTask): TaskDetail {
  const task = transformTaskToItem(apiTask);
  const events = apiTask.events ?? [];

  const timeline: TimelineEvent[] = events.map(mapEvent);

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
      costUsd: e.costUsd ?? null,
      inputTokens: e.inputTokens ?? null,
      outputTokens: e.outputTokens ?? null,
      model: e.model ?? null,
      error: e.error ?? null,
    }));

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

  // Retries = STAGE attempts beyond the first, per stage.
  const maxAttemptByStage = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== 'STAGE') continue;
    maxAttemptByStage.set(
      e.stageKey,
      Math.max(maxAttemptByStage.get(e.stageKey) ?? 0, e.attemptNumber)
    );
  }
  const retryCount = [...maxAttemptByStage.values()].reduce(
    (acc, n) => acc + Math.max(0, n - 1),
    0
  );

  const totals = computeAgentTotals(events);
  const stageStats = computeStageCosts(events);

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
      description: describeInput(apiTask.type, apiTask.input),
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
    stageStats,
    samples,
    reviews,
    stageTimings,
  };
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
  // Cost now lives on the STAGE TaskEvent (written when the stage's agents
  // finish); sum across stages for the task hero.
  for (const e of events) {
    totalCostUsd += e.costUsd ?? 0;
    totalInputTokens += e.inputTokens ?? 0;
    totalOutputTokens += e.outputTokens ?? 0;
    if (model == null && e.model && e.model !== 'unknown') {
      model = e.model;
    }
  }
  return { totalCostUsd, totalInputTokens, totalOutputTokens, model };
}

/**
 * Per-stage agent cost rollup (model + tokens + cost), summed across each
 * stage's attempts. Keyed by web stage key. Stages without agents (FILTER,
 * PR) carry zeroed tokens/cost and a null model. The synthetic `hitl` stage
 * has no events of its own — consumers fall back to `critic`.
 */
function computeStageCosts(events: ApiEvent[]): Record<string, StageCostView> {
  const out: Record<string, StageCostView> = {};
  for (const e of events) {
    if (e.kind !== 'STAGE') continue;
    const key = dbStageToWebStage(e.stageKey);
    if (!key) continue;
    const cur = out[key] ?? {
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
    cur.inputTokens += e.inputTokens ?? 0;
    cur.outputTokens += e.outputTokens ?? 0;
    cur.costUsd += e.costUsd ?? 0;
    if (cur.model == null && e.model && e.model !== 'unknown') {
      cur.model = e.model;
    }
    out[key] = cur;
  }
  return out;
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
  const formatted = formatDuration(ms);
  // Trailing dot suffix communicates "still ticking" without forcing
  // continuous re-render.
  return status === 'RUNNING' ? `${formatted}+` : formatted;
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
