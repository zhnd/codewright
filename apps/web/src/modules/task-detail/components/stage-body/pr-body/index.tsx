import { Chip } from '@/components/common/chip';
import type { TaskDetail } from '../../../types';
import { Section, StageHeader } from '../parts';

export function PrBody({ pr, detail }: { pr: unknown; detail: TaskDetail }) {
  const prData = (pr ?? {}) as {
    url?: string;
    number?: number;
    status?: string;
  };
  const prUrl = prData.url ?? detail.summary.prUrl;
  const repoLabel = detail.task.repo
    ? detail.task.repo.replace(/^https?:\/\/github\.com\//, '')
    : '';

  if (!prUrl) {
    return (
      <div>
        <StageHeader
          title="Pull request"
          chips={[
            <Chip key="p" dot="var(--foreground-subtle)">
              Pending approval
            </Chip>,
          ]}
        />
        <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-[13px] text-foreground-subtle">
          Awaiting reviewer approval before opening PR.
        </div>
      </div>
    );
  }

  return (
    <div>
      <StageHeader
        title="Pull request"
        chips={
          [
            <Chip key="o" dot="var(--ok)" strong>
              Open
            </Chip>,
            prData.number ? (
              <Chip key="n" mono>
                #{prData.number}
              </Chip>
            ) : null,
          ].filter(Boolean) as React.ReactNode[]
        }
      />
      <Section label="GitHub">
        <a
          href={prUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3.5 rounded-md border border-border bg-surface px-4 py-3 text-foreground no-underline transition-colors hover:bg-surface-2"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">
              {repoLabel || 'repository'}
              {prData.number && (
                <span className="ml-1 font-medium text-foreground-subtle">
                  #{prData.number}
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-foreground-subtle">
              {prUrl.replace(/^https?:\/\//, '')}
            </div>
          </div>
          <span className="rounded-[var(--radius-sm)] border border-border bg-background px-2.5 py-1 text-[12px] font-medium">
            Open
          </span>
        </a>
      </Section>
    </div>
  );
}
