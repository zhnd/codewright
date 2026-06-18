import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/utils/cn';

interface StatTileProps {
  /** Tiny uppercase header label, e.g. "Awaiting your review". */
  label: string;
  /** Big number / display value. Strings allowed for "—" or "$2.4k". */
  value: string | number;
  /** Optional caption beneath the value. */
  hint?: string;
  /** Optional small icon on the label row. */
  icon?: LucideIcon;
  /** Highlight border + soft accent treatment. */
  emphasis?: boolean;
  /** Semantic tone for emphasis. */
  tone?: 'accent' | 'danger';
  /** Optional destination when the metric should drill into a list. */
  href?: string;
  /** Trailing slot — typically a tiny chip / delta. */
  trailing?: React.ReactNode;
  /** Mono index prefix shown before the label, e.g. "01". */
  index?: string;
}

/**
 * Linear-style stat tile. Big Geist Mono number with tight tracking,
 * tabular-nums on by default. The eyebrow row is a tiny mono index +
 * an uppercase label — pure dev-tool console.
 */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  emphasis = false,
  tone = 'accent',
  href,
  trailing,
  index,
}: StatTileProps) {
  const toneColor = tone === 'danger' ? 'var(--danger)' : 'var(--accent)';
  const className = cn(
    'group relative overflow-hidden rounded-md border bg-card px-4 pt-3 pb-3.5 transition-colors',
    href && 'block no-underline',
    'border-border hover:border-border-strong'
  );

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {index && (
            <span className="font-mono text-[10px] tabular-nums text-foreground-faint">
              {index}
            </span>
          )}
          {Icon && (
            <span
              className={cn(
                'flex h-3.5 w-3.5 shrink-0 items-center justify-center',
                emphasis ? 'text-foreground' : 'text-foreground-subtle'
              )}
              style={emphasis ? { color: toneColor } : undefined}
            >
              <Icon className="h-3 w-3" strokeWidth={2} />
            </span>
          )}
          <span className="truncate text-[10.5px] font-medium uppercase tracking-[0.06em] text-foreground-muted">
            {label}
          </span>
        </div>
        {trailing}
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-mono text-[32px] font-medium leading-[0.95] tabular-nums tracking-normal text-foreground">
          {value}
        </span>
      </div>

      {hint && (
        <div className="mt-2 truncate text-[11.5px] text-foreground-subtle">
          {hint}
        </div>
      )}

      {emphasis && (
        <span
          className="codewright-pulse pointer-events-none absolute right-3 top-3 h-1.5 w-1.5 rounded-full"
          style={{ background: toneColor }}
        />
      )}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }

  return <div className={className}>{content}</div>;
}
