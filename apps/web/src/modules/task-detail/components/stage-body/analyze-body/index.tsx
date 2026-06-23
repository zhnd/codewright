import { Chip } from '@/components/common/chip';
import { Markdown } from '@/components/common/markdown';
import { ReviewForm } from '@/components/common/review-form';
import { RiskBadge } from '@/components/common/risk-badge';
import type { StageStatus } from '@/components/common/stage-track';
import { Section, StageHeader } from '../parts';

export function AnalyzeBody({
  analysis,
  status,
  onReview,
  reviewing,
}: {
  analysis: unknown;
  status: StageStatus;
  onReview: (lane: string, feedback: string) => void;
  reviewing: boolean;
}) {
  const a = (analysis ?? {}) as Record<string, unknown>;
  const rootCause = String(a.rootCause ?? '');
  const affected = Array.isArray(a.affectedFiles)
    ? (a.affectedFiles as string[])
    : [];
  const approach = String(a.proposedApproach ?? '');
  const risk = String(a.riskClass ?? 'medium');
  const scope = Array.isArray(a.scopeDeclaration) ? 'in-scope' : 'tbd';
  const confidence = String(a.confidence ?? 'medium');
  const isAwaiting = status === 'awaiting';

  return (
    <div>
      <StageHeader
        title="Root cause analysis"
        chips={[
          <RiskBadge key="r" risk={risk} />,
          <Chip key="s" dot="var(--ok)">
            Scope · {scope}
          </Chip>,
          <Chip key="c" mono>
            Confidence · {confidence}
          </Chip>,
        ]}
      />
      {rootCause && (
        <Section label="Root cause">
          <Markdown>{rootCause}</Markdown>
        </Section>
      )}
      {affected.length > 0 && (
        <Section label="Affected files">
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {affected.map((f) => (
              <li
                key={f}
                className="rounded-sm border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-[12px] text-foreground-muted"
              >
                {f}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {approach && (
        <Section label="Proposed approach">
          <Markdown className="text-[13.5px]">{approach}</Markdown>
        </Section>
      )}
      {isAwaiting && (
        <Section label="Your decision">
          <ReviewForm
            variant="analyze"
            onSubmit={({ lane, feedback }) => onReview(lane, feedback)}
            disabled={reviewing}
          />
        </Section>
      )}
    </div>
  );
}
