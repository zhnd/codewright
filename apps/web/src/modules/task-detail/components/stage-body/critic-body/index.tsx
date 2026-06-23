import { Chip } from '@/components/common/chip';
import { ConcernCard } from '@/components/common/concern-card';
import { Section, StageHeader } from '../parts';

interface CriticConcern {
  severity: string;
  text?: string;
  description?: string;
  file?: string;
  suggestion?: string;
}

export function CriticBody({ payload }: { payload: Record<string, unknown> }) {
  const c = (payload.criticReview ?? {}) as Record<string, unknown>;
  const verdict = c.approve ? 'approve' : 'reject';
  const score = typeof c.score === 'number' ? c.score : null;
  const scope = String(c.scopeAssessment ?? 'clean');
  const concerns = Array.isArray(c.concerns)
    ? (c.concerns as CriticConcern[])
    : [];

  return (
    <div>
      <StageHeader
        title="Critic review"
        chips={
          [
            <Chip
              key="v"
              dot={verdict === 'approve' ? 'var(--ok)' : 'var(--danger)'}
            >
              Verdict · {verdict}
            </Chip>,
            score != null ? (
              <Chip key="s" mono>
                Score · {score.toFixed(2)}
              </Chip>
            ) : null,
            <Chip
              key="sc"
              dot={scope === 'clean' ? 'var(--ok)' : 'var(--warn)'}
            >
              Scope · {scope}
            </Chip>,
          ].filter(Boolean) as React.ReactNode[]
        }
      />
      {concerns.length > 0 ? (
        <Section label={`Concerns (${concerns.length})`}>
          <div className="flex flex-col gap-2">
            {concerns.map((concern, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: critic concerns array is stable for a given review
              <ConcernCard key={i} concern={concern} />
            ))}
          </div>
        </Section>
      ) : (
        <div className="text-[12.5px] text-foreground-muted">
          No concerns raised.
        </div>
      )}
    </div>
  );
}
