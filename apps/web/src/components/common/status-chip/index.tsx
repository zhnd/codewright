import { Chip } from '../chip';

// Keyed by the canonical UPPER_SNAKE status. Callers may pass any case
// (raw TaskStatus, lowercase ExecutionStatus, etc.) — we normalize first.
const STATUS_META: Record<
  string,
  { label: string; dotClass: string; pulse?: boolean; strong?: boolean }
> = {
  PENDING: { label: 'Queued', dotClass: 'sv-pending' },
  QUEUED: { label: 'Queued', dotClass: 'sv-pending' },
  RUNNING: { label: 'Running', dotClass: 'sv-running', pulse: true },
  AWAITING_REVIEW: {
    label: 'Awaiting review',
    dotClass: 'sv-awaiting',
    pulse: true,
    strong: true,
  },
  NEEDS_REVIEW: {
    label: 'Awaiting review',
    dotClass: 'sv-awaiting',
    pulse: true,
    strong: true,
  },
  COMPLETED: { label: 'Completed', dotClass: 'sv-done' },
  FAILED: { label: 'Failed', dotClass: 'sv-failed', strong: true },
  CANCELLED: { label: 'Cancelled', dotClass: 'sv-skipped' },
};

export function StatusChip({ status }: { status: string }) {
  const meta = STATUS_META[status.toUpperCase()] ?? STATUS_META.PENDING;
  return (
    <Chip dotClass={meta.dotClass} pulse={meta.pulse} strong={meta.strong}>
      {meta.label}
    </Chip>
  );
}
