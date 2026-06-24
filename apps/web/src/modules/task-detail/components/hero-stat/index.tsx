/**
 * Compact stat tile used in the task-detail hero (DURATION / COST /
 * TOKENS row). Mono font, uppercase label and value laid out inline
 * (label then value) so the cell stays single-line height.
 */
export function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap px-3 py-1.5">
      <span className="font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] text-foreground-subtle">
        {label}
      </span>
      <span className="font-mono text-[13px] font-medium tabular-nums tracking-normal text-foreground">
        {value}
      </span>
    </div>
  );
}
