/**
 * Load SWE-bench Verified instances via the HuggingFace datasets-server
 * REST API — no Python, no local dataset download. Generation only needs
 * a few fields per instance; the gold tests (FAIL_TO_PASS / PASS_TO_PASS)
 * are NOT needed locally because scoring happens in the sb-cli cloud.
 */

export interface SweInstance {
  instanceId: string;
  /** e.g. "django/django" */
  repo: string;
  /** Pinned base commit SHA to fix against. */
  baseCommit: string;
  /** The GitHub issue text — fed as the defect description. */
  problemStatement: string;
}

const DATASET = 'princeton-nlp/SWE-bench_Verified';
const ROWS_URL = 'https://datasets-server.huggingface.co/rows';

interface HfRow {
  row: {
    instance_id?: string;
    repo?: string;
    base_commit?: string;
    problem_statement?: string;
  };
}

/**
 * Fetch a subset of SWE-bench Verified. Pages through the datasets-server
 * (max 100 rows/request) until `limit` rows are collected.
 */
export async function loadSweBenchVerified(
  limit: number,
  opts: { config?: string; split?: string; offset?: number } = {}
): Promise<SweInstance[]> {
  const config = opts.config ?? 'default';
  const split = opts.split ?? 'test';
  const startOffset = opts.offset ?? 0;

  const out: SweInstance[] = [];
  let offset = startOffset;
  while (out.length < limit) {
    const length = Math.min(100, limit - out.length);
    const url = `${ROWS_URL}?dataset=${encodeURIComponent(DATASET)}&config=${config}&split=${split}&offset=${offset}&length=${length}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `HF datasets-server ${res.status}: ${await res.text().catch(() => '')}`
      );
    }
    const body = (await res.json()) as { rows?: HfRow[] };
    const rows = body.rows ?? [];
    if (rows.length === 0) break;
    for (const { row } of rows) {
      if (
        row.instance_id &&
        row.repo &&
        row.base_commit &&
        row.problem_statement
      ) {
        out.push({
          instanceId: row.instance_id,
          repo: row.repo,
          baseCommit: row.base_commit,
          problemStatement: row.problem_statement,
        });
      }
    }
    offset += rows.length;
  }
  return out.slice(0, limit);
}

/** "django/django" -> clonable https URL. */
export function repoUrl(repo: string): string {
  return `https://github.com/${repo}.git`;
}
