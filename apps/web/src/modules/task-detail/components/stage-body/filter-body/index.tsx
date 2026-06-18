import { CheckTable, type FilterCheck } from '@/components/common/check-table';
import { Chip } from '@/components/common/chip';
import { Section, StageHeader } from '../parts';

type RawCheck =
  | { name?: string; passed?: boolean; output?: string }
  | undefined;

interface SampleEntry {
  sampleId?: number;
  passed?: boolean;
  oracle?: RawCheck;
  regression?: RawCheck;
  build?: RawCheck;
  lint?: RawCheck;
  boot?: RawCheck;
  oracleVerified?: boolean;
  eligible?: boolean;
}

interface Baseline {
  oracleFailsOnBase?: boolean | null;
  baseRegressionPassed?: boolean | null;
}

/** Map a sample's named sub-checks into the CheckTable row shape. */
function toChecks(s: SampleEntry): FilterCheck[] {
  const rows: Array<[string, RawCheck]> = [
    ['oracle', s.oracle],
    ['regression', s.regression],
    ['build', s.build],
    ['lint', s.lint],
    ['boot', s.boot],
  ];
  return rows
    .filter(([, c]) => c !== undefined)
    .map(([name, c]) => ({
      name: c?.name ?? name,
      passed: Boolean(c?.passed),
      output: String(c?.output ?? ''),
    }));
}

function VerifiedChip({ v }: { v: boolean | undefined }) {
  if (v === true)
    return (
      <Chip dot="var(--ok)" strong>
        FAIL_TO_PASS verified
      </Chip>
    );
  if (v === false)
    return (
      <Chip dot="var(--danger)" strong>
        repro still fails
      </Chip>
    );
  return <Chip dot="var(--foreground-faint)">oracle unverified</Chip>;
}

export function FilterBody({ payload }: { payload: Record<string, unknown> }) {
  const samples = (payload.checks ?? []) as SampleEntry[];
  const baseline = payload.baseline as Baseline | undefined;
  const eligibleCount = samples.filter((s) => s.eligible).length;

  return (
    <div>
      <StageHeader
        title="Automated filter"
        stage="filter"
        chips={[
          <Chip
            key="e"
            dot={eligibleCount > 0 ? 'var(--ok)' : 'var(--danger)'}
            strong
          >
            {eligibleCount}/{samples.length} candidates eligible
          </Chip>,
          baseline ? (
            <Chip
              key="b"
              mono
              dot={
                baseline.oracleFailsOnBase === true
                  ? 'var(--ok)'
                  : baseline.oracleFailsOnBase === false
                    ? 'var(--danger)'
                    : 'var(--foreground-faint)'
              }
            >
              {baseline.oracleFailsOnBase === true
                ? 'oracle fails on base ✓'
                : baseline.oracleFailsOnBase === false
                  ? 'oracle passes on base (untrusted)'
                  : 'baseline n/a'}
            </Chip>
          ) : null,
        ].filter(Boolean)}
      />

      {samples.length > 0 ? (
        samples.map((s, i) => (
          <Section
            key={s.sampleId ?? i}
            label={`Sample ${s.sampleId ?? i + 1} — ${
              s.eligible ? 'eligible' : 'rejected (test evidence)'
            }`}
          >
            <div className="mb-2 flex flex-wrap gap-3.5">
              <Chip dot={s.eligible ? 'var(--ok)' : 'var(--danger)'} strong>
                {s.eligible ? 'in selection pool' : 'dropped'}
              </Chip>
              <VerifiedChip v={s.oracleVerified} />
            </div>
            {toChecks(s).length > 0 ? (
              <CheckTable checks={toChecks(s)} />
            ) : (
              <div className="text-[12.5px] text-foreground-muted">
                No checks recorded for this sample.
              </div>
            )}
          </Section>
        ))
      ) : (
        <div className="text-[12.5px] text-foreground-muted">
          No filter checks recorded.
        </div>
      )}
    </div>
  );
}
