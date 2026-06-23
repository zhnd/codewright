import { Chip } from '@/components/common/chip';
import { Section, StageHeader } from '../parts';

export function ReproduceBody({ oracle }: { oracle: unknown }) {
  const r = (oracle ?? {}) as Record<string, unknown>;
  const code = String(r.content ?? r.code ?? '');
  const confirmed = Boolean(r.confirmedFailing ?? r.confirmed);
  const mode = String(r.mode ?? 'verify-script');
  const confirmedMessage = String(r.confirmedMessage ?? '');
  const runtime = String(r.runtime ?? '');

  return (
    <div>
      <StageHeader
        title="Reproduction"
        chips={
          [
            confirmed ? (
              <Chip key="c" dot="var(--danger)">
                Failing on HEAD
              </Chip>
            ) : (
              <Chip key="c" dot="var(--foreground-subtle)">
                Not confirmed
              </Chip>
            ),
            <Chip key="m" mono>
              Mode · {mode}
            </Chip>,
            runtime ? (
              <Chip key="t" mono>
                {runtime}
              </Chip>
            ) : null,
          ].filter(Boolean) as React.ReactNode[]
        }
      />
      {code ? (
        <Section label="Generated test">
          <pre className="m-0 overflow-auto rounded-md border border-border bg-surface-inset p-3 font-mono text-[12px] leading-[1.55]">
            {code}
          </pre>
        </Section>
      ) : null}
      {confirmedMessage ? (
        <Section label="Confirmation">
          <div className="rounded-[var(--radius-sm)] border border-border bg-surface-2 px-3 py-2.5 font-mono text-[11.5px] text-foreground-muted">
            {confirmedMessage}
          </div>
        </Section>
      ) : null}
      {!code && !confirmedMessage && (
        <div className="text-[12.5px] text-foreground-muted">
          No reproduction artifact recorded.
        </div>
      )}
    </div>
  );
}
