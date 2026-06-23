'use client';

import { AlertCircle, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { useState } from 'react';

interface FailurePanelProps {
  message: string;
  /** ISO timestamp of when the failure landed. */
  occurredAt: string | null;
  /** Heading shown in the panel. Defaults to the task-level "Task failed". */
  title?: string;
  /** Optional retry handler — when present, renders a "Retry" button. */
  onRetry?: () => void;
  /** Disable the retry button while the mutation is in flight. */
  retryPending?: boolean;
}

const COLLAPSE_THRESHOLD = 280;

/**
 * Surfaces a terminal task failure inside task-detail. Visible only when
 * the task is in a failed state and the server provided an error string.
 * Long messages truncate with an inline expand toggle so the panel
 * doesn't push the rest of the page off-screen.
 */
export function FailurePanel({
  message,
  occurredAt,
  title = 'Task failed',
  onRetry,
  retryPending,
}: FailurePanelProps) {
  const [expanded, setExpanded] = useState(false);
  const long = message.length > COLLAPSE_THRESHOLD;
  const display =
    !long || expanded ? message : `${message.slice(0, COLLAPSE_THRESHOLD)}…`;

  return (
    <div
      className="mt-3 rounded-md border border-(--danger)/40 bg-(--danger)/5 px-3.5 py-3"
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-start gap-2.5">
        <AlertCircle
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-danger">
            {title}
            {occurredAt && (
              <span className="font-normal text-foreground-subtle">
                · {new Date(occurredAt).toLocaleString()}
              </span>
            )}
          </div>
          <pre className="mt-1.5 m-0 whitespace-pre-wrap wrap-break-word font-mono text-[11.5px] leading-normal text-foreground">
            {display}
          </pre>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {long && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="inline-flex items-center gap-1 rounded-sm px-1 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.04em] text-foreground-subtle hover:bg-surface-2 hover:text-foreground"
              >
                {expanded ? (
                  <>
                    <ChevronUp className="h-2.5 w-2.5" /> Collapse
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-2.5 w-2.5" /> Show full
                  </>
                )}
              </button>
            )}
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                disabled={retryPending}
                className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-2.5 py-1 text-[11.5px] font-medium text-foreground hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" />
                {retryPending ? 'Retrying…' : 'Retry task'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
