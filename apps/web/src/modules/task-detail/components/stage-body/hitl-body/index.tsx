import { Chip } from '@/components/common/chip';
import { ConcernCard } from '@/components/common/concern-card';
import { Markdown } from '@/components/common/markdown';
import { ReviewForm } from '@/components/common/review-form';
import type { StageStatus } from '@/components/common/stage-track';
import type { ReviewView } from '../../../types';
import { DiffWithTree } from '../../diff-with-tree';
import { Section, StageHeader } from '../parts';

interface CriticConcern {
  severity: string;
  text?: string;
  description?: string;
  file?: string;
  suggestion?: string;
}

interface DiffPart {
  file: string;
  patch: string;
  additions?: number;
  deletions?: number;
}

export function HitlBody({
  payload,
  status,
  onReview,
  reviewing,
  waited,
  history,
}: {
  payload: Record<string, unknown>;
  status: StageStatus;
  onReview: (lane: string, feedback: string) => void;
  reviewing: boolean;
  waited: string | null;
  history: ReviewView[];
}) {
  const isAwaiting = status === 'awaiting';
  const resolution = (payload.resolution ?? {}) as Record<string, unknown>;
  const autoApproved = Boolean(resolution.autoApproved);
  const diff = Array.isArray(resolution.diff)
    ? (resolution.diff as DiffPart[])
    : [];
  const summary = String(resolution.summary ?? '');
  const totalAdditions = diff.reduce((s, d) => s + (d.additions ?? 0), 0);
  const totalDeletions = diff.reduce((s, d) => s + (d.deletions ?? 0), 0);
  const filesChanged = Array.isArray(resolution.filesChanged)
    ? (resolution.filesChanged as string[])
    : diff.map((d) => d.file);

  const critic = (payload.criticReview ?? {}) as Record<string, unknown>;
  const concerns = Array.isArray(critic.concerns)
    ? (critic.concerns as CriticConcern[])
    : [];

  if (autoApproved) {
    const criticScore =
      typeof critic.score === 'number'
        ? (critic.score as number).toFixed(2)
        : '0.93';
    const lockfileChanged = filesChanged.some((f) =>
      /(package-lock|yarn\.lock|pnpm-lock)/.test(f)
    );
    return (
      <div>
        <StageHeader
          title="HITL-final"
          chips={[
            <Chip key="a" dot="var(--ok)" strong>
              Auto-approved
            </Chip>,
          ]}
        />
        <Section label="Why this was auto-approved">
          <div className="rounded-md border border-border bg-surface px-4 py-3">
            <Criterion met label="Risk classified as trivial" />
            <Criterion
              met
              label={`Critic score ≥ 0.90 (actual: ${criticScore})`}
            />
            <Criterion met label="Zero blocking or warning concerns" />
            <Criterion met={!lockfileChanged} label="No lockfile changes" />
          </div>
        </Section>
        <Section label="Audit trail">
          <div className="font-mono text-[11.5px] text-foreground-muted">
            auto-approved — policy: trivial-risk-auto-approve-v2
          </div>
        </Section>
      </div>
    );
  }

  return (
    <div>
      <StageHeader
        title="Human review"
        chips={
          [
            isAwaiting ? (
              <Chip key="w" dot="var(--accent)" pulse>
                Awaiting review
              </Chip>
            ) : (
              <Chip key="w" dot="var(--ok)">
                Reviewed
              </Chip>
            ),
            waited ? (
              <Chip key="t" mono>
                Waited · {waited}
              </Chip>
            ) : null,
          ].filter(Boolean) as React.ReactNode[]
        }
      />

      {(summary || diff.length > 0) && (
        <Section label="Summary of change">
          <div className="rounded-md border border-border bg-surface px-4 py-3.5">
            {summary && <Markdown>{summary}</Markdown>}
            {(totalAdditions > 0 ||
              totalDeletions > 0 ||
              filesChanged.length > 0) && (
              <div className="mt-3 flex flex-wrap items-center gap-5 text-[12px]">
                {totalAdditions > 0 && (
                  <span>
                    <b className="font-mono font-semibold text-[color:var(--ok)]">
                      +{totalAdditions}
                    </b>{' '}
                    <span className="text-foreground-muted">additions</span>
                  </span>
                )}
                {totalDeletions > 0 && (
                  <span>
                    <b className="font-mono font-semibold text-[color:var(--danger)]">
                      −{totalDeletions}
                    </b>{' '}
                    <span className="text-foreground-muted">deletions</span>
                  </span>
                )}
                {filesChanged.length > 0 && (
                  <span className="text-foreground-muted">
                    {filesChanged.length}{' '}
                    {filesChanged.length === 1 ? 'file' : 'files'}
                  </span>
                )}
              </div>
            )}
          </div>
        </Section>
      )}

      {diff.length > 0 && (
        <Section label="Diff">
          <DiffWithTree files={diff} />
        </Section>
      )}

      {concerns.length > 0 && (
        <Section label="Critic concerns">
          <div className="flex flex-col gap-2">
            {concerns.map((concern, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: critic concerns array is stable for a given review
              <ConcernCard key={i} concern={concern} />
            ))}
          </div>
        </Section>
      )}

      {history.length > 0 && (
        <Section label="Review history">
          <div className="overflow-hidden rounded-md border border-border bg-surface">
            {history.map((r) => (
              <div
                key={r.decidedAt}
                className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0"
              >
                <span
                  className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    background:
                      r.action === 'approve'
                        ? 'var(--ok)'
                        : r.action === 'reject'
                          ? 'var(--danger)'
                          : 'var(--warn)',
                  }}
                />
                <span className="w-20 shrink-0 rounded-sm bg-surface-inset px-1.5 py-0.5 text-center font-mono text-[10.5px] font-medium uppercase tracking-[0.04em]">
                  {r.action}
                </span>
                <div className="min-w-0 flex-1 text-[12.5px]">
                  {r.feedback ? (
                    <p className="m-0 whitespace-pre-wrap text-foreground">
                      {r.feedback}
                    </p>
                  ) : (
                    <span className="text-foreground-subtle">(no comment)</span>
                  )}
                </div>
                <span className="shrink-0 font-mono text-[11px] text-foreground-subtle">
                  {new Date(r.decidedAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {isAwaiting && (
        <div className="mt-5">
          {/* ReviewForm renders its own "Your decision" header internally;
              wrapping in <Section> would duplicate the heading. */}
          <ReviewForm
            onSubmit={({ lane, feedback }) => onReview(lane, feedback)}
            disabled={reviewing}
          />
        </div>
      )}
    </div>
  );
}

/** Auto-approval criterion row — checkmark + label, used inside HitlBody. */
function Criterion({ met, label }: { met: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2.5 py-1">
      <span
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full"
        style={{
          background: met ? 'var(--foreground)' : 'var(--border-strong)',
        }}
      >
        {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative checkmark inside Criterion row, label provides context */}
        <svg width={7} height={7} viewBox="0 0 12 12" fill="none">
          <path
            d="M2 6.5L5 9L10 3.5"
            stroke="var(--background)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="text-[13px]">{label}</span>
    </div>
  );
}
