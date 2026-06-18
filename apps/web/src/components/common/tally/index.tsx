import { cn } from '@/utils/cn';

interface TallyProps {
  /** "subtle" (default) is faded edge-to-edge; "dense" is opaque, used inside cards. */
  variant?: 'subtle' | 'dense';
  className?: string;
}

/**
 * The signature decorative element in v2: a 1px dot-grid rule. Reads
 * as schematic / blueprint, not parchment. Kept under the `Tally` name
 * so callers don't churn — visually it's a `codewright-dotgrid` band.
 */
export function Tally({ variant = 'subtle', className }: TallyProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        variant === 'subtle'
          ? 'codewright-dotgrid'
          : 'codewright-dotgrid-dense',
        className
      )}
    />
  );
}
