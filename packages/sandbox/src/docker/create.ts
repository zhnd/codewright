import type { GitHostProvider } from '@torin/githost';
import Docker from 'dockerode';
import type { SandboxHooks } from '../interface.js';
import { log } from '../logger.js';
import type { GitUser, Source } from '../types.js';
import { buildCredentialHelper } from './credential-broker.js';
import { DEFAULT_WORKING_DIRECTORY, SANDBOX_BASE_IMAGE } from './defaults.js';
import { ensureRepoImage } from './repo-image.js';
import { DockerSandbox } from './sandbox.js';

export interface CreateDockerSandboxOptions {
  source?: Source;
  /**
   * Escape hatch: use a specific image and bypass the repo cache entirely.
   * When set, no ensureRepoImage call is made and the container boots
   * straight from `image`. Use for tests or custom runtimes.
   */
  image?: string;
  env?: Record<string, string>;
  gitToken?: string;
  /** Defaults to 'github' when omitted. */
  gitProvider?: GitHostProvider;
  gitUser?: GitUser;
  /**
   * Project-supplied `.npmrc` content. Written to the builder's
   * `/root/.npmrc` before tier-2 install commands run; included in the
   * tier-2 cache key so changes invalidate the install image.
   */
  npmrc?: string;
  hooks?: SandboxHooks;
  workingDirectory?: string;
  memoryMb?: number;
  cpus?: number;
  /**
   * Container ports to publish to the host for preview URLs. Each listed
   * port gets bound to a random host port; callers read the mapping via
   * `sandbox.domain(port)`.
   */
  ports?: number[];
}

const DEFAULT_MEMORY_MB = 2048;
const DEFAULT_CPUS = 1;

export async function createDockerSandbox(
  options: CreateDockerSandboxOptions = {}
): Promise<DockerSandbox> {
  const docker = new Docker();
  const workingDirectory =
    options.workingDirectory ?? DEFAULT_WORKING_DIRECTORY;
  const memoryMb = options.memoryMb ?? DEFAULT_MEMORY_MB;
  const cpus = options.cpus ?? DEFAULT_CPUS;
  const gitToken = options.gitToken ?? options.source?.token;
  const gitProvider =
    options.gitProvider ?? options.source?.provider ?? 'github';

  // Resolve the image:
  //   1. explicit `image` override → bypass cache (tests, custom setups)
  //   2. source present            → cached repo image (tier 1 or 2)
  //   3. no source                 → bare base image, empty workspace
  let image: string;
  let fromCache = false;

  if (options.image) {
    image = options.image;
    await ensureImage(docker, image);
  } else if (options.source) {
    const result = await ensureRepoImage(docker, options.source, {
      gitToken,
      gitProvider,
      npmrc: options.npmrc,
    });
    image = result.imageTag;
    fromCache = true;
    log.info(
      {
        image,
        cacheHit: result.cacheHit,
        toolchain: result.setupPlan.toolchain,
      },
      'Resolved repo image'
    );
  } else {
    image = SANDBOX_BASE_IMAGE;
    await ensureImage(docker, image);
  }

  const ports = options.ports ?? [];
  const exposedPorts: Record<string, Record<string, never>> = {};
  const portBindings: Record<string, Array<{ HostPort: string }>> = {};
  for (const port of ports) {
    exposedPorts[`${port}/tcp`] = {};
    portBindings[`${port}/tcp`] = [{ HostPort: '' }];
  }

  log.info({ image, workingDirectory, ports }, 'Creating container');
  const container = await docker.createContainer({
    Image: image,
    Cmd: ['sleep', 'infinity'],
    WorkingDir: workingDirectory,
    ...(ports.length > 0 ? { ExposedPorts: exposedPorts } : {}),
    HostConfig: {
      NetworkMode: 'bridge',
      Memory: memoryMb * 1024 * 1024,
      CpuPeriod: 100_000,
      CpuQuota: cpus * 100_000,
      Init: true,
      ...(ports.length > 0 ? { PortBindings: portBindings } : {}),
    },
  });
  await container.start();
  log.info({ containerId: container.id }, 'Container started');

  // Snapshot the container's host port assignments so callers can resolve
  // preview URLs synchronously later.
  const portMap: Record<number, number> = {};
  if (ports.length > 0) {
    const info = await container.inspect();
    for (const port of ports) {
      const binding = info.NetworkSettings?.Ports?.[`${port}/tcp`];
      const hostPort = binding?.[0]?.HostPort;
      if (hostPort) {
        portMap[port] = Number.parseInt(hostPort, 10);
      }
    }
  }

  const sandbox = new DockerSandbox({
    docker,
    container,
    workingDirectory,
    env: options.env,
    gitToken,
    gitProvider,
    currentBranch: options.source?.newBranch ?? options.source?.branch,
    hooks: options.hooks,
    ports,
    portMap,
  });

  if (options.source && fromCache) {
    await warmStart(sandbox, options.source, options.gitUser);
  } else if (!options.source) {
    await bootstrapEmptyWorkspace(sandbox, options.gitUser);
  } else {
    // source + explicit image override: old-style full bootstrap.
    await bootstrapFromScratch(sandbox, options.source, options.gitUser);
  }

  if (options.hooks?.afterStart) {
    await options.hooks.afterStart(sandbox);
  }

  return sandbox;
}

async function ensureImage(docker: Docker, image: string): Promise<void> {
  try {
    await docker.getImage(image).inspect();
    return;
  } catch {
    log.info({ image }, 'Pulling image');
  }
  await new Promise<void>((resolve, reject) => {
    docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (progressErr: Error | null) =>
        progressErr ? reject(progressErr) : resolve()
      );
    });
  });
}

/**
 * For containers booted from a cached repo image: the working tree exists;
 * we just need to pull the delta since the image was built and prepare the
 * task branch.
 */
async function warmStart(
  sandbox: DockerSandbox,
  source: Source,
  gitUser: GitUser | undefined
): Promise<void> {
  await configureGitIdentity(sandbox, gitUser);
  await registerCredentialHelper(sandbox);
  // Cached image already has the working tree → safe to set repo-local config.
  await disableRepoHooks(sandbox);

  const targetBranch = source.branch ?? 'HEAD';
  const fetchCmd = source.branch
    ? `git fetch origin ${shellArg(source.branch)} --prune --filter=blob:none`
    : 'git fetch --all --prune --filter=blob:none';
  const fetchResult = await sandbox.exec(fetchCmd, { timeoutMs: 120_000 });
  if (!fetchResult.success) {
    throw new Error(
      `git fetch failed: ${fetchResult.stderr || fetchResult.stdout}`
    );
  }

  const resetTarget = source.branch ? `origin/${source.branch}` : 'origin/HEAD';
  const resetResult = await sandbox.exec(
    `git reset --hard ${shellArg(resetTarget)}`,
    { timeoutMs: 30_000 }
  );
  if (!resetResult.success) {
    throw new Error(
      `git reset failed: ${resetResult.stderr || resetResult.stdout}`
    );
  }

  if (source.commit) {
    await checkoutCommit(sandbox, source.commit);
  }

  if (source.newBranch) {
    const checkout = await sandbox.exec(
      `git checkout -B ${shellArg(source.newBranch)}`,
      { timeoutMs: 10_000 }
    );
    if (!checkout.success) {
      throw new Error(
        `Failed to create branch ${source.newBranch}: ${checkout.stderr}`
      );
    }
  }

  log.debug(
    {
      branch: targetBranch,
      commit: source.commit,
      newBranch: source.newBranch,
    },
    'Warm start complete'
  );
}

/**
 * Empty sandbox (no source): set up an empty git repo so git-based workflows
 * still work.
 */
async function bootstrapEmptyWorkspace(
  sandbox: DockerSandbox,
  gitUser: GitUser | undefined
): Promise<void> {
  // The base image provides git already. For non-base images specified via
  // `image` override, the caller is responsible for ensuring git is present.
  await sandbox.exec('mkdir -p .', { timeoutMs: 5_000 });
  await registerCredentialHelper(sandbox);
  await configureGitIdentity(sandbox, gitUser);
  const init = await sandbox.exec('git init', { timeoutMs: 10_000 });
  if (!init.success) {
    throw new Error(`git init failed: ${init.stderr}`);
  }
}

/**
 * Bootstrap a source repo from scratch when the cache is bypassed (custom
 * image). Mirrors the pre-cache behavior: install git if missing, clone.
 */
async function bootstrapFromScratch(
  sandbox: DockerSandbox,
  source: Source,
  gitUser: GitUser | undefined
): Promise<void> {
  await sandbox.exec(
    'mkdir -p . && command -v git >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq git >/dev/null 2>&1)',
    { timeoutMs: 180_000 }
  );
  await registerCredentialHelper(sandbox);
  await configureGitIdentity(sandbox, gitUser);

  const branch = source.branch ? `--branch ${shellArg(source.branch)}` : '';
  const cloneResult = await sandbox.exec(
    `git clone --filter=blob:none ${branch} ${shellArg(source.repo)} .`,
    { timeoutMs: 300_000 }
  );
  if (!cloneResult.success) {
    throw new Error(
      `Failed to clone ${source.repo}: ${cloneResult.stderr || cloneResult.stdout}`
    );
  }
  await disableRepoHooks(sandbox);

  if (source.commit) {
    await checkoutCommit(sandbox, source.commit);
  }

  if (source.newBranch) {
    const checkout = await sandbox.exec(
      `git checkout -b ${shellArg(source.newBranch)}`,
      { timeoutMs: 10_000 }
    );
    if (!checkout.success) {
      throw new Error(
        `Failed to create branch ${source.newBranch}: ${checkout.stderr}`
      );
    }
  }
}

/**
 * Check out an exact commit SHA. The commit is normally reachable from the
 * already-fetched branch history; if not (partial/shallow), fetch the
 * specific SHA and retry. Used for base_commit-pinned eval runs.
 */
async function checkoutCommit(
  sandbox: DockerSandbox,
  commit: string
): Promise<void> {
  let co = await sandbox.exec(`git checkout ${shellArg(commit)}`, {
    timeoutMs: 30_000,
  });
  if (!co.success) {
    await sandbox.exec(
      `git fetch origin ${shellArg(commit)} --filter=blob:none`,
      { timeoutMs: 120_000 }
    );
    co = await sandbox.exec(`git checkout ${shellArg(commit)}`, {
      timeoutMs: 30_000,
    });
  }
  if (!co.success) {
    throw new Error(
      `Failed to checkout commit ${commit}: ${co.stderr || co.stdout}`
    );
  }
}

async function configureGitIdentity(
  sandbox: DockerSandbox,
  gitUser: GitUser | undefined
): Promise<void> {
  if (!gitUser) return;
  await sandbox.exec(
    `git config --global user.name ${shellArg(gitUser.name)} && git config --global user.email ${shellArg(gitUser.email)}`,
    { timeoutMs: 10_000 }
  );
}

/**
 * Neutralize the repo's git hooks for EVERY sandbox commit. Real-world repos
 * ship husky / lint-staged / commitlint pre-commit + commit-msg hooks for
 * human contributors; they lint/format/typecheck staged files and reject
 * non-conventional messages — blocking Torin's automated oracle + implement
 * commits (`git commit failed … Preparing lint-staged…`).
 *
 * Must be set in the REPO-LOCAL config: husky writes `core.hooksPath` into
 * `.git/config`, and local config beats `--global`. Pointing it at an empty
 * path makes git run no hooks at all, for activity- and agent-driven commits
 * alike. Caller must invoke this only once the working tree exists.
 */
async function disableRepoHooks(sandbox: DockerSandbox): Promise<void> {
  await sandbox.exec('git config --local core.hooksPath /dev/null', {
    timeoutMs: 10_000,
  });
}

async function registerCredentialHelper(sandbox: DockerSandbox): Promise<void> {
  await sandbox.exec(
    `git config --global 'credential.helper' ${shellArg(buildCredentialHelper(sandbox.gitProvider))}`,
    { timeoutMs: 5_000 }
  );
}

function shellArg(input: string): string {
  return `'${input.replace(/'/g, `'\\''`)}'`;
}
