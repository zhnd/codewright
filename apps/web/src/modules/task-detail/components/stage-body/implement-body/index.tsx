'use client';

import { Chip } from '@/components/common/chip';
import { SampleRow } from '@/components/common/sample-row';
import { DiffWithTree } from '../../diff-with-tree';
import { Section, StageHeader } from '../parts';
import { useService } from './use-service';

interface SampleSummary {
  id: string;
  status: string;
  note?: string;
  time?: string;
}

interface DiffPart {
  file: string;
  patch: string;
  additions?: number;
  deletions?: number;
}

export function ImplementBody({
  payload,
}: {
  payload: Record<string, unknown>;
}) {
  const resolution = (payload.resolution ?? {}) as Record<string, unknown>;
  const samples = Array.isArray(resolution.samples)
    ? (resolution.samples as SampleSummary[])
    : [];
  const diff = Array.isArray(resolution.diff)
    ? (resolution.diff as DiffPart[])
    : Array.isArray(payload.diff)
      ? (payload.diff as DiffPart[])
      : [];

  const { selected, setSelected } = useService(samples);

  const selectedCount = samples.filter((s) => s.status === 'selected').length;
  const rejectedCount = samples.filter(
    (s) => s.status === 'critic_rejected'
  ).length;
  const filterFailedCount = samples.filter(
    (s) => s.status === 'filter_failed'
  ).length;

  return (
    <div>
      <StageHeader
        title="Implementation"
        chips={
          [
            <Chip key="n" mono>
              N = {samples.length || 1}
            </Chip>,
            selectedCount > 0 ? (
              <Chip key="s" dot="var(--ok)">
                {selectedCount} selected
              </Chip>
            ) : null,
            rejectedCount > 0 ? (
              <Chip key="r" dot="var(--warn)">
                {rejectedCount} rejected
              </Chip>
            ) : null,
            filterFailedCount > 0 ? (
              <Chip key="f" dot="var(--danger)">
                {filterFailedCount} filter-failed
              </Chip>
            ) : null,
          ].filter(Boolean) as React.ReactNode[]
        }
      />
      {samples.length > 0 && (
        <Section label="Samples">
          <div className="flex flex-col gap-1.5">
            {samples.map((s) => (
              <SampleRow
                key={s.id}
                sample={s}
                selected={selected === s.id}
                onClick={() => setSelected(s.id)}
              />
            ))}
          </div>
        </Section>
      )}
      {diff.length > 0 && (
        <Section label={selected ? `Diff — ${selected}` : 'Diff'}>
          <DiffWithTree files={diff} />
        </Section>
      )}
    </div>
  );
}
