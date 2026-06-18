import type { FileDiff } from '@codewright/domain';

/**
 * Reflexion-style bounded memory. Each retry produces one AttemptMemo
 * summarizing what was tried and why it failed. The helper below trims
 * the list to the most recent Ω entries and renders them into a prompt
 * block. Keeping Ω small (≤ 3) is deliberate: full trajectory replay
 * bloats tokens without improving outcomes (Devin's finding), and
 * Reflexion's original paper caps Ω at 1–3 for the same reason.
 */
export interface AttemptMemo {
  /** 1-indexed for human readability in the prompt. */
  attemptNum: number;
  /** Condensed description of the change, or a structured diff. */
  summary: string;
  /** Files touched in this attempt (for scope-drift debugging). */
  filesChanged: string[];
  /** What failed — filter check name + one-line cause. */
  failureReasons: string[];
  /** Full diff for traceability. Truncated when rendered into the prompt. */
  diff?: FileDiff[];
}

export interface BuildRetryFeedbackInput {
  /** Previous attempts, oldest first. Caller controls the cap (Ω). */
  previousAttempts: AttemptMemo[];
  /** Freeform HITL rejection text when this retry is human-triggered. */
  reviewerFeedback?: string;
  /** Deterministic precondition violations detected by the workflow. */
  preconditionViolations?: string[];
  /** Max attempts to render. Recent attempts are kept; older ones dropped. */
  maxAttemptsShown?: number;
  /** Hard cap on rendered diff lines per attempt. */
  diffLinesPerAttempt?: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_DIFF_LINES = 40;

/**
 * Render bounded retry feedback as a structured markdown block to inject
 * into the next IMPLEMENT user prompt. Empty string when nothing to say.
 */
export function buildRetryFeedback(input: BuildRetryFeedbackInput): string {
  const maxAttempts = input.maxAttemptsShown ?? DEFAULT_MAX_ATTEMPTS;
  const diffLines = input.diffLinesPerAttempt ?? DEFAULT_DIFF_LINES;
  const attempts = input.previousAttempts.slice(-maxAttempts);

  const sections: string[] = [];

  if (input.preconditionViolations?.length) {
    sections.push(
      '## Precondition Violations',
      'Your previous attempt broke one or more hard rules. The workflow rejected it outright:',
      ...input.preconditionViolations.map((v) => `- ${v}`),
      '',
      'Do NOT repeat these violations in this attempt.'
    );
  }

  if (attempts.length > 0) {
    sections.push('## Previous Attempts');
    sections.push(
      `The last ${attempts.length} attempt(s) failed. A fresh session is running — you have no memory of what you tried last time except what is summarized below. Read carefully and do NOT repeat the same approach.`,
      ''
    );

    for (const a of attempts) {
      sections.push(`### Attempt #${a.attemptNum}`);
      sections.push(`Summary: ${a.summary}`);
      if (a.filesChanged.length > 0) {
        sections.push(`Files: ${a.filesChanged.join(', ')}`);
      }
      if (a.failureReasons.length > 0) {
        sections.push('Failed because:');
        for (const r of a.failureReasons) sections.push(`  - ${r}`);
      }
      if (a.diff && a.diff.length > 0) {
        sections.push('Diff (truncated):');
        sections.push('```diff');
        sections.push(truncateDiff(a.diff, diffLines));
        sections.push('```');
      }
      sections.push('');
    }

    sections.push(
      '## Directive',
      'Read the above and pick a DIFFERENT approach. The same edit will fail the same way. Consider alternative root causes, different fix locations, or a narrower scope.'
    );
  }

  if (input.reviewerFeedback?.trim()) {
    sections.push('## Reviewer Feedback', input.reviewerFeedback.trim());
  }

  return sections.join('\n');
}

/**
 * Summarize a FILTER result + prior resolution into a single AttemptMemo.
 * Called by the workflow between IMPLEMENT rounds.
 */
export function memoFromAttempt(input: {
  attemptNum: number;
  resolution: {
    summary: string;
    filesChanged: string[];
    diff: FileDiff[];
  };
  failureSummary?: string;
  failedChecks?: Array<{ name: string; output?: string }>;
}): AttemptMemo {
  const failureReasons: string[] = [];
  if (input.failedChecks && input.failedChecks.length > 0) {
    for (const c of input.failedChecks) {
      const snippet = c.output ? firstLine(c.output) : '(no output)';
      failureReasons.push(`${c.name}: ${snippet}`);
    }
  }
  if (failureReasons.length === 0 && input.failureSummary) {
    failureReasons.push(firstLine(input.failureSummary));
  }

  return {
    attemptNum: input.attemptNum,
    summary: input.resolution.summary,
    filesChanged: input.resolution.filesChanged,
    failureReasons,
    diff: input.resolution.diff,
  };
}

function truncateDiff(diff: FileDiff[], maxLines: number): string {
  const blocks = diff.map((d) => `--- ${d.file}\n${d.patch}`);
  const joined = blocks.join('\n');
  const lines = joined.split('\n');
  if (lines.length <= maxLines) return joined;
  return `${lines.slice(0, maxLines).join('\n')}\n...[${lines.length - maxLines} more lines truncated]`;
}

function firstLine(text: string): string {
  const trimmed = text.trim();
  const newline = trimmed.indexOf('\n');
  return newline === -1
    ? trimmed.slice(0, 200)
    : trimmed.slice(0, newline).slice(0, 200);
}
