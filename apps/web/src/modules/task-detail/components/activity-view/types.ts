// Row shape mirroring the AgentMessageFields GraphQL fragment.
export interface AgentMessageRow {
  id: string;
  cursor: string;
  taskEventId: string;
  taskId: string;
  seq: number;
  kind: string;
  role: string | null;
  textContent: string | null;
  textTruncatedAt: number | null;
  toolUseId: string | null;
  toolName: string | null;
  payload: unknown;
  payloadTruncatedAt: number | null;
  createdAt: string;
}

// ── Render model ───────────────────────────────────────────
// Activity is master-detail: a left stage/round rail + the selected
// event's flat message stream on the right.

export type StepStatus = 'active' | 'complete' | 'error';

/** One reasoning or tool step in the right-pane stream. */
export interface WorkStep {
  id: string;
  type: 'tool' | 'reasoning';
  /** Clean tool name (mcp prefix stripped) or 'Thinking'. */
  title: string;
  /** Key argument (file path / command / pattern) or reasoning text. */
  detail: string | null;
  /** Short result preview (tool output first line), null for reasoning. */
  preview: string | null;
  status: StepStatus;
  /** Full tool input (for click-to-expand); null for reasoning. */
  input: unknown;
  inputTruncatedAt: number | null;
  /** Full tool output / error body (for click-to-expand). */
  output: string | null;
  outputTruncatedAt: number | null;
}

/** Ordered item in one event's stream: a step, a message, or an error. */
export type SectionItem =
  | { kind: 'step'; id: string; step: WorkStep }
  | { kind: 'message'; id: string; role: 'assistant' | 'user'; text: string }
  | { kind: 'error'; id: string; text: string };

// ── Left rail (stage navigation) ───────────────────────────

/** One attempt (round) of a stage. */
export interface RailRound {
  eventId: string;
  attemptNumber: number;
  /** TaskEvent status (RUNNING / AWAITING / COMPLETED / REJECTED / FAILED / SKIPPED). */
  status: string;
  /** Tool-call count in this round (shown as "N steps"). */
  stepCount: number;
}

/** A stage in the rail, with one or more rounds. */
export interface RailStage {
  /** DB stage key (uppercase): ANALYSIS / REPRODUCE / ... */
  stageKey: string;
  label: string;
  /** Latest round's status (drives the stage dot). */
  status: string;
  rounds: RailRound[];
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}
