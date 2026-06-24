import { CANONICAL_STAGE_ORDER } from '@codewright/domain';
import type { BundledLanguage } from 'shiki';
import type { StageTimingView } from '@/modules/tasks/types';
import { stageLabel } from './constants';
import type {
  AgentMessageRow,
  RailStage,
  SectionItem,
  UsageTotals,
  WorkStep,
} from './types';

/** Strip the `mcp__<server>__` prefix so `mcp__sandbox__read_file` → `read_file`. */
export function cleanToolName(name: string): string {
  const parts = name.split('__');
  return parts.length > 1 ? parts[parts.length - 1] : name;
}

/**
 * The single most informative argument for a tool call, shown inline next
 * to the tool name (Claude-Code style: `read_file src/foo.ts`).
 */
export function toolKeyArg(payload: unknown): string | null {
  if (payload == null || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  for (const key of [
    'command',
    'path',
    'file',
    'filePath',
    'pattern',
    'query',
    'url',
  ]) {
    if (typeof p[key] === 'string' && p[key])
      return (p[key] as string).slice(0, 200);
  }
  // Fall back to the first short string value.
  for (const v of Object.values(p)) {
    if (typeof v === 'string' && v) return v.slice(0, 120);
  }
  return null;
}

/** First non-empty line of a tool result, for an at-a-glance preview. */
function previewOf(text: string | null): string | null {
  if (!text) return null;
  const line = text.split('\n').find((l) => l.trim().length > 0);
  return line ? line.trim().slice(0, 140) : null;
}

/** Group message-log rows by their parent TaskEvent (stage attempt). */
export function groupRowsByEvent(
  rows: AgentMessageRow[]
): Map<string, AgentMessageRow[]> {
  const byEvent = new Map<string, AgentMessageRow[]>();
  for (const row of rows) {
    const list = byEvent.get(row.taskEventId);
    if (list) list.push(row);
    else byEvent.set(row.taskEventId, [row]);
  }
  return byEvent;
}

/**
 * Flatten one event's rows into an ordered item stream (reasoning / tool /
 * message / error). tool_result rows merge into their tool_call step by
 * toolUseId; orphan results become their own completed step.
 */
export function itemsForEvent(rows: AgentMessageRow[]): SectionItem[] {
  const items: SectionItem[] = [];
  const stepByToolUseId = new Map<string, WorkStep>();

  for (const row of rows) {
    switch (row.kind) {
      case 'reasoning': {
        if (!row.textContent) break;
        items.push({
          kind: 'step',
          id: row.id,
          step: {
            id: row.id,
            type: 'reasoning',
            title: 'Thinking',
            detail: row.textContent,
            preview: null,
            status: 'complete',
            input: null,
            inputTruncatedAt: null,
            output: null,
            outputTruncatedAt: null,
          },
        });
        break;
      }
      case 'tool_call': {
        const step: WorkStep = {
          id: row.id,
          type: 'tool',
          title: cleanToolName(row.toolName ?? 'tool'),
          detail: toolKeyArg(row.payload),
          preview: null,
          status: 'active', // until the result arrives
          input: row.payload ?? null,
          inputTruncatedAt: row.payloadTruncatedAt,
          output: null,
          outputTruncatedAt: null,
        };
        if (row.toolUseId) stepByToolUseId.set(row.toolUseId, step);
        items.push({ kind: 'step', id: row.id, step });
        break;
      }
      case 'tool_result': {
        const step = row.toolUseId
          ? stepByToolUseId.get(row.toolUseId)
          : undefined;
        const isError =
          typeof row.payload === 'object' &&
          row.payload !== null &&
          (row.payload as { isError?: boolean }).isError === true;
        if (step) {
          step.status = isError ? 'error' : 'complete';
          step.preview = previewOf(row.textContent);
          step.output = row.textContent;
          step.outputTruncatedAt = row.textTruncatedAt;
        } else {
          items.push({
            kind: 'step',
            id: row.id,
            step: {
              id: row.id,
              type: 'tool',
              title: cleanToolName(row.toolName ?? 'tool'),
              detail: null,
              preview: previewOf(row.textContent),
              status: isError ? 'error' : 'complete',
              input: null,
              inputTruncatedAt: null,
              output: row.textContent,
              outputTruncatedAt: row.textTruncatedAt,
            },
          });
        }
        break;
      }
      case 'message': {
        if (!row.textContent) break;
        items.push({
          kind: 'message',
          id: row.id,
          role: row.role === 'user' ? 'user' : 'assistant',
          text: row.textContent,
        });
        break;
      }
      case 'error': {
        items.push({
          kind: 'error',
          id: row.id,
          text: row.textContent ?? 'Agent error',
        });
        break;
      }
      default:
        break; // 'usage' → meter only
    }
  }
  return items;
}

const stageOrder = (key: string): number => {
  const i = CANONICAL_STAGE_ORDER.indexOf(key as never);
  return i === -1 ? CANONICAL_STAGE_ORDER.length : i;
};

/**
 * Build the left-rail model from the task's stage events. Stages in
 * canonical order; each stage's rounds (attempts) sorted ascending. Step
 * count per round = tool calls streamed under that event.
 */
export function buildRail(
  stageTimings: StageTimingView[],
  rowsByEvent: Map<string, AgentMessageRow[]>
): RailStage[] {
  const byStage = new Map<string, StageTimingView[]>();
  for (const st of stageTimings) {
    const list = byStage.get(st.stageKey);
    if (list) list.push(st);
    else byStage.set(st.stageKey, [st]);
  }

  const countTools = (eventId: string): number =>
    (rowsByEvent.get(eventId) ?? []).filter((r) => r.kind === 'tool_call')
      .length;

  return [...byStage.keys()]
    .sort((a, b) => stageOrder(a) - stageOrder(b))
    .map((stageKey) => {
      const events = [...(byStage.get(stageKey) ?? [])].sort(
        (a, b) => a.attemptNumber - b.attemptNumber
      );
      const rounds: RailStage['rounds'] = events.map((e) => ({
        eventId: e.eventId,
        attemptNumber: e.attemptNumber,
        status: e.status,
        stepCount: countTools(e.eventId),
      }));
      return {
        stageKey,
        label: stageLabel(stageKey),
        status: events[events.length - 1]?.status ?? 'PENDING',
        rounds,
      };
    });
}

export function computeUsage(rows: AgentMessageRow[]): UsageTotals {
  const totals: UsageTotals = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  for (const row of rows) {
    if (row.kind !== 'usage') continue;
    const p = (row.payload ?? {}) as {
      inputTokens?: number | null;
      outputTokens?: number | null;
      totalCostUsd?: number | null;
    };
    totals.inputTokens += p.inputTokens ?? 0;
    totals.outputTokens += p.outputTokens ?? 0;
    totals.costUsd += p.totalCostUsd ?? 0;
  }
  return totals;
}

/** Pretty-print a tool input payload as indented JSON (best-effort). */
export function formatInputJson(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

/** File extensions we render as rich markdown rather than highlighted code. */
const MARKDOWN_EXT = /\.(md|markdown|mdx)$/i;

/** Map a file extension to a Shiki bundled language for syntax highlighting. */
const EXT_LANG: Record<string, BundledLanguage> = {
  ts: 'typescript',
  tsx: 'tsx',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'jsonc',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  scala: 'scala',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'fish',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  xml: 'xml',
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  prisma: 'prisma',
  vue: 'vue',
  svelte: 'svelte',
  dockerfile: 'docker',
};

/** Last path segment's extension, lowercased (e.g. "src/a.TS" → "ts"). */
function extOf(path: string): string | null {
  const seg = path.split(/[\\/]/).pop() ?? path;
  const dot = seg.lastIndexOf('.');
  return dot > 0 ? seg.slice(dot + 1).toLowerCase() : null;
}

/** True when the tool's target is a Markdown document. */
export function isMarkdownPath(path: string | null | undefined): boolean {
  return typeof path === 'string' && MARKDOWN_EXT.test(path);
}

/** Shiki language for a file path, or null when unknown / not code. */
export function fileLang(
  path: string | null | undefined
): BundledLanguage | null {
  if (typeof path !== 'string') return null;
  const ext = extOf(path);
  return ext ? (EXT_LANG[ext] ?? null) : null;
}

/** Human byte size for the "truncated · N total" hint on tool I/O. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}
