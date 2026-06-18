/**
 * Default toolchain versions used when a repo doesn't declare its own.
 *
 * Pinned to "current-1" LTS for stability: the ecosystem (npm engines, native
 * addons, C-extension wheels) lags the very latest LTS by several months.
 * Review these defaults roughly every 18 months.
 *
 * Any repo can override by shipping `mise.toml` / `.tool-versions` /
 * `.nvmrc` / `.python-version` — those take priority over these defaults.
 *
 * Per-deployment overrides via CODEWRIGHT_DEFAULT_*_VERSION env vars.
 */
export const DEFAULT_TOOLCHAIN_VERSIONS = {
  node: process.env.CODEWRIGHT_DEFAULT_NODE_VERSION ?? '22',
  python: process.env.CODEWRIGHT_DEFAULT_PYTHON_VERSION ?? '3.12',
  rust: process.env.CODEWRIGHT_DEFAULT_RUST_VERSION ?? 'stable',
  go: process.env.CODEWRIGHT_DEFAULT_GO_VERSION ?? 'latest',
  bun: process.env.CODEWRIGHT_DEFAULT_BUN_VERSION ?? 'latest',
} as const;

/** Base image containing git + mise. Build with `pnpm sandbox:build-base`. */
export const SANDBOX_BASE_IMAGE =
  process.env.CODEWRIGHT_SANDBOX_BASE_IMAGE ?? 'codewright/sandbox-base:1';

/** Max age of tier-1 (raw clone) images before rebuild on next use. */
export const REPO_RAW_IMAGE_MAX_AGE_MS = parseIntEnv(
  'CODEWRIGHT_REPO_RAW_MAX_AGE_MS',
  6 * 60 * 60 * 1000 // 6h
);

/** Max age of tier-2 (post-install) images before rebuild on next use. */
export const REPO_IMAGE_MAX_AGE_MS = parseIntEnv(
  'CODEWRIGHT_REPO_IMAGE_MAX_AGE_MS',
  24 * 60 * 60 * 1000 // 24h
);

/** Idle age after which tier-2 images are pruned. */
export const REPO_IMAGE_PRUNE_AFTER_MS = parseIntEnv(
  'CODEWRIGHT_REPO_IMAGE_PRUNE_AFTER_MS',
  7 * 24 * 60 * 60 * 1000 // 7 days
);

/** Timeout for the install command inside the builder container. */
export const SETUP_COMMAND_TIMEOUT_MS = parseIntEnv(
  'CODEWRIGHT_SETUP_COMMAND_TIMEOUT_MS',
  20 * 60 * 1000 // 20 min
);

/** Default working directory inside sandbox containers. */
export const DEFAULT_WORKING_DIRECTORY = '/workspace/repo';

/** Container label marker used for builder cleanup and image prune. */
export const BUILDER_LABEL = 'codewright.role';
export const BUILDER_LABEL_VALUE = 'builder';
export const MANAGED_IMAGE_LABEL = 'codewright.managed';

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
