import { createHash, randomUUID } from 'node:crypto';
import type { GitHostProvider } from '@codewright/githost';
import type Docker from 'dockerode';
import { buildCredentialHelper } from './credential-broker.js';
import {
  BUILDER_LABEL,
  BUILDER_LABEL_VALUE,
  DEFAULT_WORKING_DIRECTORY,
  MANAGED_IMAGE_LABEL,
} from './defaults.js';
import { DockerSandbox } from './sandbox.js';

// Builder-container lifecycle + image primitives shared by the repo-image
// build steps: spin a disposable container off an image, configure git
// credentials, drop an .npmrc, commit the result to a tag, and inspect
// image age / hash repo URLs.

export async function startBuilder(
  docker: Docker,
  image: string,
  gitToken?: string,
  gitProvider?: GitHostProvider
): Promise<DockerSandbox> {
  const container = await docker.createContainer({
    Image: image,
    Cmd: ['sleep', 'infinity'],
    WorkingDir: DEFAULT_WORKING_DIRECTORY,
    Labels: { [BUILDER_LABEL]: BUILDER_LABEL_VALUE },
    HostConfig: {
      NetworkMode: 'bridge',
      Memory: 2048 * 1024 * 1024,
      CpuPeriod: 100_000,
      CpuQuota: 200_000, // 2 vCPUs for faster install
      Init: true,
    },
  });
  await container.start();
  return new DockerSandbox({
    docker,
    container,
    workingDirectory: DEFAULT_WORKING_DIRECTORY,
    gitToken,
    gitProvider,
  });
}

export async function gitConfigCredentialHelper(
  sandbox: DockerSandbox
): Promise<void> {
  await sandbox.exec(
    `git config --global 'credential.helper' ${shellArg(buildCredentialHelper(sandbox.gitProvider))}`,
    { cwd: DEFAULT_WORKING_DIRECTORY, timeoutMs: 5_000 }
  );
}

export async function commitBuilder(
  docker: Docker,
  sandbox: DockerSandbox,
  tag: string,
  tier: string
): Promise<void> {
  const [repo, tagName] = tag.split(':');
  const container = docker.getContainer(sandbox.id);
  await container.commit({
    repo,
    tag: tagName,
    changes: [
      `LABEL ${MANAGED_IMAGE_LABEL}=true`,
      `LABEL codewright.tier=${tier}`,
    ].join('\n'),
  });
}

/**
 * Drop a project-supplied `.npmrc` into the builder's `$HOME` so pnpm/npm
 * pick it up during install. Heredoc delimiter is randomized to avoid
 * collisions with user content; single-quoted to suppress shell expansion
 * so `${CODEWRIGHT_GIT_TOKEN}` and friends survive verbatim into the file.
 * pnpm itself does the env-var substitution at install time.
 */
export async function writeNpmrc(
  builder: DockerSandbox,
  content: string
): Promise<void> {
  const eof = `CODEWRIGHT_NPMRC_EOF_${randomUUID().replace(/-/g, '')}`;
  const result = await builder.exec(
    `cat > /root/.npmrc <<'${eof}'\n${content}\n${eof}`,
    { cwd: DEFAULT_WORKING_DIRECTORY, timeoutMs: 5_000 }
  );
  if (!result.success) {
    throw new Error(
      `Failed to write .npmrc: ${result.stderr || result.stdout}`
    );
  }
}

export async function imageAge(
  docker: Docker,
  tag: string
): Promise<number | null> {
  try {
    const info = await docker.getImage(tag).inspect();
    const created = Date.parse(info.Created);
    if (!Number.isFinite(created)) return null;
    return Date.now() - created;
  } catch {
    return null;
  }
}

export function hashRepoUrl(url: string): string {
  const normalized = url
    .replace(/\.git$/i, '')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export function shellArg(input: string): string {
  return `'${input.replace(/'/g, `'\\''`)}'`;
}
