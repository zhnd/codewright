import { createHash } from 'node:crypto';
import type { GitHostProvider } from '@codewright/githost';
import Docker from 'dockerode';
import { log } from '../logger.js';
import type { Source } from '../types.js';
import { withLock } from './build-lock.js';
import {
  commitBuilder,
  gitConfigCredentialHelper,
  hashRepoUrl,
  imageAge,
  shellArg,
  startBuilder,
  writeNpmrc,
} from './builder.js';
import {
  BUILDER_LABEL,
  BUILDER_LABEL_VALUE,
  DEFAULT_WORKING_DIRECTORY,
  MANAGED_IMAGE_LABEL,
  REPO_IMAGE_MAX_AGE_MS,
  REPO_IMAGE_PRUNE_AFTER_MS,
  REPO_RAW_IMAGE_MAX_AGE_MS,
  SANDBOX_BASE_IMAGE,
  SETUP_COMMAND_TIMEOUT_MS,
} from './defaults.js';
import { detectSetup, type SetupPlan } from './setup-detector.js';

const RAW_REPO = 'codewright/repo-raw';
const SETUP_REPO = 'codewright/repo';
const TIER_RAW = 'raw';
const TIER_SETUP = 'setup';

interface EnsureRepoImageOptions {
  gitToken?: string;
  gitProvider?: GitHostProvider;
  rawMaxAgeMs?: number;
  setupMaxAgeMs?: number;
  baseImage?: string;
  /**
   * Project-supplied `.npmrc` content. Written to the tier-2 builder's
   * `/root/.npmrc` before install commands; hashed into the tier-2 tag so
   * changes invalidate the install image but not tier-1.
   */
  npmrc?: string;
}

export interface EnsureRepoImageResult {
  imageTag: string;
  setupPlan: SetupPlan;
  cacheHit: 'tier2' | 'tier1' | 'cold';
}

/**
 * Resolve (and if needed build) the image a task sandbox should run on.
 *
 * Produces a two-tier cache:
 *   - Tier 1: codewright/repo-raw:<repoHash>          (clone only, no deps)
 *   - Tier 2: codewright/repo:<repoHash>-<setupHash>  (tier 1 + dependencies)
 *
 * Separating the tiers means a code change alone (same lockfile) reuses
 * tier 2, and a lockfile change alone reuses tier 1, rebuilding only the
 * install step. Both tags are replaced in place; docker keeps the old
 * image as dangling until prune.
 */
export async function ensureRepoImage(
  docker: Docker,
  source: Source,
  options: EnsureRepoImageOptions = {}
): Promise<EnsureRepoImageResult> {
  const baseImage = options.baseImage ?? SANDBOX_BASE_IMAGE;
  const rawMaxAgeMs = options.rawMaxAgeMs ?? REPO_RAW_IMAGE_MAX_AGE_MS;
  const setupMaxAgeMs = options.setupMaxAgeMs ?? REPO_IMAGE_MAX_AGE_MS;
  const repoHash = hashRepoUrl(source.repo);
  const rawTag = `${RAW_REPO}:${repoHash}`;

  await withLock(`${repoHash}-raw`, async () => {
    const age = await imageAge(docker, rawTag);
    if (age === null) {
      log.info({ repo: source.repo, rawTag }, 'Tier-1 cold build');
      await coldBuildRaw(docker, source, baseImage, rawTag, options);
    } else if (age > rawMaxAgeMs) {
      log.info(
        { repo: source.repo, ageMs: age, rawTag },
        'Tier-1 stale, refreshing via fetch'
      );
      await refreshRaw(docker, source, rawTag, options);
    }
  });

  // With a fresh tier-1 in hand, decide on tier-2. The setupHash depends on
  // what's inside the clone, so we probe by spinning a disposable container
  // from tier-1, running detectSetup, and hashing the result.
  const plan = await resolveSetupPlan(docker, rawTag);
  const npmrcSuffix = options.npmrc
    ? `-n${createHash('sha256').update(options.npmrc).digest('hex').slice(0, 8)}`
    : '';
  const setupTag = plan.empty
    ? rawTag
    : `${SETUP_REPO}:${repoHash}-${plan.setupHash}${npmrcSuffix}`;

  if (plan.empty) {
    return { imageTag: rawTag, setupPlan: plan, cacheHit: 'tier1' };
  }

  let cacheHit: 'tier2' | 'tier1' | 'cold' = 'cold';
  await withLock(`${repoHash}-${plan.setupHash}${npmrcSuffix}`, async () => {
    const age = await imageAge(docker, setupTag);
    if (age !== null && age <= setupMaxAgeMs) {
      cacheHit = 'tier2';
      return;
    }
    if (age !== null) {
      log.info(
        { setupTag, ageMs: age },
        'Tier-2 stale, rebuilding from tier-1'
      );
    } else {
      log.info({ setupTag, toolchain: plan.toolchain }, 'Tier-2 cold build');
    }
    cacheHit = 'cold';
    await buildSetup(docker, rawTag, setupTag, plan, options);
  });

  return { imageTag: setupTag, setupPlan: plan, cacheHit };
}

/**
 * Prune images codewright manages. Dangling images (left over from commit
 * replacing a tag) are always removed; tier-1 and tier-2 are dropped when
 * their age exceeds the configured thresholds.
 */
export async function pruneStaleImages(
  pruneAfterMs: number = REPO_IMAGE_PRUNE_AFTER_MS
): Promise<{ deleted: string[] }> {
  const docker = new Docker();
  const images = await docker.listImages();
  const deleted: string[] = [];

  for (const image of images) {
    const labels = image.Labels ?? {};
    if (labels[MANAGED_IMAGE_LABEL] !== 'true') continue;

    const ageMs = Date.now() - image.Created * 1000;
    if (ageMs <= pruneAfterMs) continue;

    const tags = image.RepoTags ?? [];
    const target = tags[0] ?? image.Id;
    try {
      await docker.getImage(target).remove({ force: true });
      deleted.push(target);
    } catch (err) {
      log.warn(
        {
          image: target,
          err: err instanceof Error ? err.message : String(err),
        },
        'Image prune failed'
      );
    }
  }

  try {
    await docker.pruneImages({ filters: { dangling: { true: true } } });
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Dangling image prune failed'
    );
  }

  return { deleted };
}

/**
 * Remove any builder containers left over from previous runs. Safe to call
 * at worker startup; builders always carry the `codewright.role=builder` label.
 */
export async function cleanupOrphanBuilders(): Promise<void> {
  const docker = new Docker();
  const containers = await docker.listContainers({
    all: true,
    filters: { label: [`${BUILDER_LABEL}=${BUILDER_LABEL_VALUE}`] },
  });
  for (const info of containers) {
    try {
      const c = docker.getContainer(info.Id);
      await c.remove({ force: true });
      log.info({ containerId: info.Id }, 'Removed orphan builder');
    } catch (err) {
      log.warn(
        { id: info.Id, err: err instanceof Error ? err.message : String(err) },
        'Failed to remove orphan builder'
      );
    }
  }
}

// ── Internals ────────────────────────────────────────────────────────────

async function coldBuildRaw(
  docker: Docker,
  source: Source,
  baseImage: string,
  rawTag: string,
  options: EnsureRepoImageOptions
): Promise<void> {
  const builder = await startBuilder(
    docker,
    baseImage,
    options.gitToken,
    options.gitProvider
  );
  try {
    await gitConfigCredentialHelper(builder);
    const cloneResult = await builder.exec(
      `git clone --filter=blob:none ${shellArg(source.repo)} .`,
      { cwd: DEFAULT_WORKING_DIRECTORY, timeoutMs: 10 * 60 * 1000 }
    );
    if (!cloneResult.success) {
      throw new Error(
        `Failed to clone ${source.repo}: ${cloneResult.stderr || cloneResult.stdout}`
      );
    }
    await commitBuilder(docker, builder, rawTag, TIER_RAW);
  } finally {
    await builder.stop();
  }
}

async function refreshRaw(
  docker: Docker,
  source: Source,
  rawTag: string,
  options: EnsureRepoImageOptions
): Promise<void> {
  // Rebuild from the stale tier-1, not from sandbox-base — this is the
  // whole point of the refresh path. git fetch + reset is seconds, not
  // minutes.
  const builder = await startBuilder(
    docker,
    rawTag,
    options.gitToken,
    options.gitProvider
  );
  try {
    await gitConfigCredentialHelper(builder);
    const fetchResult = await builder.exec(
      'git fetch --all --prune --filter=blob:none && git reset --hard @{upstream}',
      { cwd: DEFAULT_WORKING_DIRECTORY, timeoutMs: 5 * 60 * 1000 }
    );
    if (!fetchResult.success) {
      // Fetch failed — fall through to a cold rebuild so we never serve a
      // broken tier-1.
      log.warn(
        { err: fetchResult.stderr },
        'Fetch on stale tier-1 failed, doing cold rebuild'
      );
      await builder.stop();
      await coldBuildRaw(docker, source, SANDBOX_BASE_IMAGE, rawTag, options);
      return;
    }
    await commitBuilder(docker, builder, rawTag, TIER_RAW);
  } finally {
    await builder.stop();
  }
}

async function resolveSetupPlan(
  docker: Docker,
  rawTag: string
): Promise<SetupPlan> {
  // Probe container: just needs the filesystem to inspect; we discard it.
  const builder = await startBuilder(docker, rawTag);
  try {
    return await detectSetup(builder);
  } finally {
    await builder.stop();
  }
}

async function buildSetup(
  docker: Docker,
  rawTag: string,
  setupTag: string,
  plan: SetupPlan,
  options: EnsureRepoImageOptions
): Promise<void> {
  // Pass token + provider so DockerSandbox.exec injects CODEWRIGHT_GIT_TOKEN into
  // setup commands; pnpm/npm interpolate ${CODEWRIGHT_GIT_TOKEN} from the
  // user-supplied .npmrc at install time.
  const builder = await startBuilder(
    docker,
    rawTag,
    options.gitToken,
    options.gitProvider
  );
  try {
    if (options.npmrc) {
      await writeNpmrc(builder, options.npmrc);
    }
    for (const command of plan.commands) {
      log.info({ command }, 'Running setup command');
      const result = await builder.exec(command, {
        cwd: DEFAULT_WORKING_DIRECTORY,
        timeoutMs: SETUP_COMMAND_TIMEOUT_MS,
      });
      if (!result.success) {
        throw new Error(
          `Setup command failed: ${command}\n${result.stderr || result.stdout}`
        );
      }
    }
    await commitBuilder(docker, builder, setupTag, TIER_SETUP);
  } finally {
    await builder.stop();
  }
}
