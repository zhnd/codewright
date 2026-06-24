/**
 * Canonical display formatters shared across feature modules.
 *
 * These previously existed as several divergent copies (per-module `libs.ts`
 * files plus private helpers in `tasks/transform.ts`). The implementations
 * here are the most complete variants — hour-aware durations, smart-precision
 * USD, and M/k token scaling — so every surface renders figures the same way.
 */

/**
 * Human-readable duration. Snaps to the largest reasonable unit so tasks that
 * run for hours don't show "300m" and short tool calls don't show "523.7ms".
 *   null / undefined →  "—"
 *   < 1 s            →  "523ms"
 *   < 60 s           →  "42s"
 *   < 1 hour         →  "5m 23s"  (drops trailing seconds when zero: "5m")
 *   ≥ 1 hour         →  "1h 12m"  (drops trailing minutes when zero: "1h")
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  const total = Math.round(ms);
  if (total < 1000) return `${total}ms`;
  const totalSeconds = Math.round(total / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/**
 * Smart-precision USD. Sub-cent amounts keep more decimals so small agent
 * runs don't all round to "$0.00".
 *   null / undefined →  "—"
 *   ≤ 0              →  "$0"
 *   < $0.01          →  4 decimals
 *   < $1             →  3 decimals
 *   ≥ $1             →  2 decimals
 */
export function formatCostUsd(usd: number | null | undefined): string {
  if (usd == null) return '—';
  if (usd <= 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * Compact token count — "1.2M", "1.2k", "987". A missing meter (null /
 * undefined) renders as "—"; a real zero stays "0" so "X in / Y out" strips
 * read naturally.
 */
export function formatTokens(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
