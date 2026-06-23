import { prisma } from '@codewright/database';
import { findModelPricing, type ModelPricing } from '@codewright/domain';
import { log } from '../logger.js';

/**
 * Resolves per-model token prices for cost computation, backed by the
 * `ModelPrice` database table with on-demand population from a public price
 * API (LiteLLM). The table starts empty; the first run of a model with no
 * row triggers a remote fetch + upsert. When the remote fetch fails (or the
 * model isn't in the remote data) we log and return what we have — the
 * observer then falls back to the in-code `MODEL_PRICING` map so cost is
 * never silently wrong because of a transient network error.
 *
 * Runs inside Temporal activities only (via `runAgentInActivity`), never in
 * workflow code — it does prisma + HTTP I/O.
 */

/** Default model when `AGENT_MODEL` is unset (mirrors run-agent.ts). */
const DEFAULT_AGENT_MODEL = 'claude-sonnet-4-6';

/**
 * Public price source. LiteLLM publishes a free, auth-less JSON mapping
 * model id → `{ input_cost_per_token, output_cost_per_token, ... }`.
 * Overridable via env for self-hosting / mirroring.
 */
const DEFAULT_PRICE_API_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60_000;

// In-process state. `cachedTable` avoids re-reading the (small) table on
// every agent run; `remoteMissConfirmed` records models the remote source
// answered for but does NOT price (a definitive, permanent miss) so a bad
// model id can't hammer the remote API run after run. Transient failures
// (network/HTTP/parse) are deliberately NOT recorded here — they must be
// retryable so a momentary outage doesn't peg a model to fallback pricing
// for the rest of the worker's life.
let cachedTable: Record<string, ModelPricing> | null = null;
let cacheLoadedAtMs = 0;
const remoteMissConfirmed = new Set<string>();

/** The configured agent model (env-driven; no per-call override is used). */
export function configuredAgentModel(): string {
  return process.env.AGENT_MODEL ?? DEFAULT_AGENT_MODEL;
}

/** Load every `ModelPrice` row into a `{ model: ModelPricing }` table. */
async function loadTable(): Promise<Record<string, ModelPricing>> {
  const now = Date.now();
  if (cachedTable && now - cacheLoadedAtMs < CACHE_TTL_MS) return cachedTable;
  const rows = await prisma.modelPrice.findMany({
    select: { model: true, inputPer1M: true, outputPer1M: true },
  });
  const table: Record<string, ModelPricing> = {};
  for (const row of rows) {
    table[row.model] = {
      inputPer1M: row.inputPer1M,
      outputPer1M: row.outputPer1M,
    };
  }
  cachedTable = table;
  cacheLoadedAtMs = now;
  return table;
}

/**
 * Resolve the price table the observer should use for `model`. If `model`
 * already resolves against the DB table, returns it as-is. Otherwise makes
 * a one-shot remote fetch to populate the row, then returns the updated
 * table. Always returns a usable table (possibly empty) — never throws.
 */
export async function resolveModelPricing(
  model: string
): Promise<Record<string, ModelPricing>> {
  const table = await loadTable();
  if (findModelPricing(model, table)) return table;

  if (remoteMissConfirmed.has(model)) return table;

  const fetched = await fetchModelPriceFromRemote(model);
  if (fetched === 'error') {
    // Transient failure — leave the model retryable so a later run can
    // populate it once the remote source recovers. Falls back this run.
    return table;
  }
  if (fetched === 'miss') {
    // Definitive: remote answered but has no usable price for this model.
    // Record it so we don't refetch every run.
    remoteMissConfirmed.add(model);
    return table;
  }

  try {
    await prisma.modelPrice.upsert({
      where: { model },
      create: { model, source: 'litellm', ...fetched },
      update: { source: 'litellm', ...fetched },
    });
  } catch (err) {
    // Price was fetched but the upsert failed (e.g. DB hiccup). Still serve
    // it this run via the in-memory table; next run will retry the upsert.
    log.warn(
      { model, err: err instanceof Error ? err.message : String(err) },
      'model-pricing: fetched remote price but failed to persist it'
    );
  }

  // Splice into the cached table so this run (and the cache TTL window) sees
  // the new price without another DB round-trip.
  table[model] = fetched;
  if (cachedTable) cachedTable[model] = fetched;
  log.info(
    { model, inputPer1M: fetched.inputPer1M, outputPer1M: fetched.outputPer1M },
    'model-pricing: populated price from remote source'
  );
  return table;
}

/**
 * Outcome of a remote price lookup, kept distinct so the caller can tell a
 * permanent miss from a retryable failure:
 *   - `ModelPricing` — the model's price was found;
 *   - `'miss'` — the remote source answered (HTTP 2xx) but has no usable
 *     price for this model — a definitive, cacheable negative;
 *   - `'error'` — a transient failure (network, non-2xx, parse) that should
 *     NOT suppress future retries.
 */
type RemotePriceResult = ModelPricing | 'miss' | 'error';

/**
 * Fetch `model`'s price from the public price API. See {@link RemotePriceResult}
 * for the success / definitive-miss / transient-error distinction. Logs on
 * every non-success path so the caller can stay quiet.
 */
async function fetchModelPriceFromRemote(
  model: string
): Promise<RemotePriceResult> {
  const url = process.env.MODEL_PRICE_API_URL ?? DEFAULT_PRICE_API_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      log.error(
        { model, url, status: res.status },
        'model-pricing: remote price fetch returned non-OK status'
      );
      return 'error';
    }
    const data = (await res.json()) as Record<string, unknown>;
    const pricing = extractPricing(model, data);
    if (!pricing) {
      log.warn(
        { model, url },
        'model-pricing: model not found (or has no token prices) in remote price data'
      );
      return 'miss';
    }
    return pricing;
  } catch (err) {
    log.error(
      { model, url, err: err instanceof Error ? err.message : String(err) },
      'model-pricing: failed to fetch remote price'
    );
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}

interface LiteLlmEntry {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  litellm_provider?: string;
}

/**
 * Find `model` in a LiteLLM-shaped price map and convert its per-token costs
 * to USD / 1M tokens. The map mixes provider variants of the same model —
 * native (`claude-haiku-4-5`), gateway-prefixed (`anthropic/claude-…`), and
 * Bedrock/Vertex (`anthropic.claude-…-20251001-v1:0`) — all normalized to a
 * bare id before matching. Candidates are ranked so the *most trustworthy*
 * price wins:
 *   1. match tightness — exact id beats a dated/variant prefix match;
 *   2. canonical provider — prefer `litellm_provider === 'anthropic'` (direct
 *      API list price) over Bedrock/Vertex, whose per-token costs can differ;
 *   3. closeness — the candidate whose bare id length is nearest `model`.
 * Returns `null` when nothing matches or the entry lacks token prices.
 */
function extractPricing(
  model: string,
  data: Record<string, unknown>
): ModelPricing | null {
  const wanted = normalize(model);
  let best: { rank: number; inputPer1M: number; outputPer1M: number } | null =
    null;
  for (const [key, raw] of Object.entries(data)) {
    const entry = raw as LiteLlmEntry;
    if (
      typeof entry?.input_cost_per_token !== 'number' ||
      typeof entry?.output_cost_per_token !== 'number'
    ) {
      continue;
    }
    const bare = bareModelId(key);
    // 3 = exact, 2 = bare is a dated/variant extension of wanted, 1 = bare is
    // a (less specific) prefix of wanted, 0 = no relation.
    const tightness =
      bare === wanted
        ? 3
        : bare.startsWith(wanted)
          ? 2
          : wanted.startsWith(bare)
            ? 1
            : 0;
    if (tightness === 0) continue;
    const providerBonus = entry.litellm_provider === 'anthropic' ? 1 : 0;
    const closeness = -Math.abs(bare.length - wanted.length);
    const rank = tightness * 1_000 + providerBonus * 100 + closeness;
    if (!best || rank > best.rank) {
      best = {
        rank,
        inputPer1M: entry.input_cost_per_token * 1_000_000,
        outputPer1M: entry.output_cost_per_token * 1_000_000,
      };
    }
  }
  return best && { inputPer1M: best.inputPer1M, outputPer1M: best.outputPer1M };
}

/**
 * Reduce a LiteLLM map key to a bare, comparable model id: strip a slash
 * provider prefix (`anthropic/claude-…` → `claude-…`) and a dotted provider
 * prefix (`anthropic.claude-…` → `claude-…`, the Bedrock shape), then
 * normalize. The dotted-prefix rule only fires on a leading `word.` segment,
 * so mid-id dots (e.g. `gpt-4.1`) are left intact.
 */
function bareModelId(key: string): string {
  const afterSlash = key.slice(key.lastIndexOf('/') + 1);
  return normalize(afterSlash).replace(/^[a-z][a-z0-9_]*\./, '');
}

/** Lowercase and drop a trailing `[…]` variant marker (e.g. `[1m]`). */
function normalize(id: string): string {
  return id.toLowerCase().replace(/\[[^\]]*\]$/, '');
}
