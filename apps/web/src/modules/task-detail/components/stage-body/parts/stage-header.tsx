import { StageStats } from './stage-stats';

/**
 * Stage-body header: heading + optional chip row. The selected stage is
 * already named in the pipeline rail, so the body doesn't repeat it.
 */
export function StageHeader({
  title,
  chips,
}: {
  title: string;
  chips?: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <h2 className="m-0 text-[20px] font-semibold leading-[1.15] tracking-normal text-foreground">
        {title}
      </h2>
      <StageStats />
      {chips && <div className="mt-2.5 flex flex-wrap gap-3.5">{chips}</div>}
    </div>
  );
}

/**
 * Labeled section block within a stage body. Mono uppercase eyebrow +
 * children container with bottom margin.
 */
export function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-foreground-subtle">
        {label}
      </div>
      {children}
    </div>
  );
}
