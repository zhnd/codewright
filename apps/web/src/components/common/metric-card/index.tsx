import { cn } from '@/utils/cn';
import { Spark } from '../spark';

interface MetricCardProps {
  label: string;
  value: string | number;
  delta?: string;
  hint?: string;
  emphasis?: boolean;
  spark?: number[];
  sparkTone?: 'foreground' | 'accent';
}

/**
 * Dashboard metric card. `emphasis` paints a subtle accent pulse dot in
 * the top-right — reserve for the action-required metric (e.g. "Awaiting
 * your review").
 */
export function MetricCard({
  label,
  value,
  delta,
  hint,
  emphasis = false,
  spark,
  sparkTone = 'foreground',
}: MetricCardProps) {
  const deltaPositive = delta?.startsWith('+') && !delta.startsWith('+0');
  const deltaNegative = delta?.startsWith('-');
  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-surface px-4 py-3.5">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.04em] text-foreground-muted">
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span
          className={cn(
            'font-bold leading-none tabular-nums tracking-normal text-foreground',
            emphasis ? 'text-[30px]' : 'text-[26px]'
          )}
        >
          {value}
        </span>
        {delta && (
          <span
            className={cn(
              'font-mono text-[11px] font-medium tabular-nums',
              deltaPositive && 'text-[color:var(--ok)]',
              deltaNegative && 'text-[color:var(--danger)]',
              !deltaPositive && !deltaNegative && 'text-foreground-muted'
            )}
          >
            {delta}
          </span>
        )}
        {emphasis && (
          <span className="codewright-pulse ml-auto h-1.5 w-1.5 self-center rounded-full bg-[color:var(--accent)]" />
        )}
      </div>
      {hint && (
        <div className="mt-1.25 text-[11.5px] text-foreground-subtle">
          {hint}
        </div>
      )}
      {spark && (
        <div className="mt-2.5">
          <Spark values={spark} width={140} height={24} tone={sparkTone} fill />
        </div>
      )}
    </div>
  );
}
