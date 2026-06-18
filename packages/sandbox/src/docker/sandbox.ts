import { Buffer } from 'node:buffer';
import path from 'node:path/posix';
import type { GitHostProvider } from '@codewright/githost';
import type Docker from 'dockerode';
import type {
  ExecOptions,
  ExecResult,
  Sandbox,
  SandboxDirent,
  SandboxHooks,
  SandboxStats,
} from '../interface.js';
import { log } from '../logger.js';
import type { DockerSandboxState } from '../state.js';
import { buildCredentialEnv } from './credential-broker.js';
import { buildExecInput, execInContainer } from './exec.js';
import { readFileFromContainer, writeFileToContainer } from './filesystem.js';

export interface DockerSandboxInit {
  docker: Docker;
  container: Docker.Container;
  workingDirectory: string;
  env?: Record<string, string>;
  gitToken?: string;
  /** Defaults to 'github' for back-compat with existing callers. */
  gitProvider?: GitHostProvider;
  currentBranch?: string;
  hooks?: SandboxHooks;
  /** Container ports this sandbox knows about. */
  ports?: number[];
  /**
   * containerPort → hostPort mapping, snapshotted at create/reconnect time.
   * Populated by the caller after `container.start()` via `inspect()`.
   */
  portMap?: Record<number, number>;
}

export class DockerSandbox implements Sandbox {
  readonly provider = 'docker' as const;
  readonly id: string;
  readonly workingDirectory: string;
  readonly env?: Record<string, string>;
  readonly currentBranch?: string;
  readonly hooks?: SandboxHooks;
  readonly gitProvider: GitHostProvider;

  private readonly docker: Docker;
  private readonly container: Docker.Container;
  private readonly credentialEnv: Record<string, string>;
  private readonly declaredPorts: number[];
  private readonly portMap: Record<number, number>;
  private stopped = false;

  constructor(init: DockerSandboxInit) {
    this.docker = init.docker;
    this.container = init.container;
    this.id = init.container.id;
    this.workingDirectory = init.workingDirectory;
    this.env = init.env;
    this.currentBranch = init.currentBranch;
    this.hooks = init.hooks;
    this.gitProvider = init.gitProvider ?? 'github';
    this.credentialEnv = buildCredentialEnv(init.gitToken);
    this.declaredPorts = init.ports ?? [];
    this.portMap = init.portMap ?? {};
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    const input = buildExecInput(
      this.workingDirectory,
      this.env,
      this.credentialEnv,
      command,
      options
    );
    return execInContainer(this.docker, this.container, input);
  }

  /**
   * Start a command that outlives this call (for dev servers, watchers).
   * The command is launched with stdout+stderr redirected to a log file
   * inside the container; callers can poll the log by `sandbox.readFile`.
   * When the sandbox stops, the process is killed along with it.
   */
  async execDetached(
    command: string,
    options: {
      cwd?: string;
      env?: Record<string, string>;
      logFile?: string;
    } = {}
  ): Promise<{ commandId: string; logFile: string }> {
    const logFile =
      options.logFile ?? `/tmp/codewright-detached-${Date.now()}.log`;
    // Redirect all output, close stdin, run in a new session so it
    // survives the exec teardown. tini (Init=true) reaps zombies.
    const wrapped = `setsid sh -c ${shellArg(`( ${command} ) >${logFile} 2>&1 </dev/null &`)}`;
    const envList = this.composeEnv(options.env)
      ? Object.entries(this.composeEnv(options.env) ?? {}).map(
          ([k, v]) => `${k}=${v}`
        )
      : undefined;
    const exec = await this.container.exec({
      Cmd: ['sh', '-c', wrapped],
      AttachStdout: false,
      AttachStderr: false,
      WorkingDir: options.cwd ?? this.workingDirectory,
      ...(envList ? { Env: envList } : {}),
    });
    await exec.start({ Detach: true, Tty: false });
    return { commandId: exec.id, logFile };
  }

  /**
   * Resolve the host-visible URL for a port that was declared at create time.
   * Returns `http://localhost:<hostPort>` where hostPort was auto-assigned
   * by Docker at create time and cached.
   */
  domain(port: number): string {
    if (!this.declaredPorts.includes(port)) {
      throw new Error(
        `Port ${port} was not declared when the sandbox was created`
      );
    }
    const hostPort = this.portMap[port];
    if (!hostPort) {
      throw new Error(`Port ${port} has no host binding`);
    }
    return `http://localhost:${hostPort}`;
  }

  private composeEnv(
    extra?: Record<string, string>
  ): Record<string, string> | undefined {
    const hasAny =
      !!this.env || !!extra || Object.keys(this.credentialEnv).length > 0;
    if (!hasAny) return undefined;
    return { ...this.env, ...this.credentialEnv, ...extra };
  }

  async readFile(filePath: string): Promise<string> {
    const absolute = this.resolvePath(filePath);
    const buffer = await readFileFromContainer(this.container, absolute);
    return buffer.toString('utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const absolute = this.resolvePath(filePath);
    await this.mkdir(path.dirname(absolute), { recursive: true });
    await writeFileToContainer(
      this.container,
      absolute,
      Buffer.from(content, 'utf-8')
    );
  }

  async stat(filePath: string): Promise<SandboxStats> {
    const absolute = this.resolvePath(filePath);
    const result = await this.exec(
      `stat -c '%F\t%s\t%Y' ${shellArg(absolute)}`,
      { cwd: this.workingDirectory, timeoutMs: 5_000 }
    );
    if (!result.success) {
      throw new Error(`ENOENT: ${filePath}`);
    }
    const [fileType = '', sizeStr = '0', mtimeStr = '0'] = result.stdout
      .trim()
      .split('\t');
    const isDir = fileType === 'directory';
    return {
      isDirectory: () => isDir,
      isFile: () => !isDir,
      size: Number.parseInt(sizeStr, 10) || 0,
      mtimeMs: (Number.parseInt(mtimeStr, 10) || 0) * 1000,
    };
  }

  async mkdir(
    filePath: string,
    options?: { recursive?: boolean }
  ): Promise<void> {
    const absolute = this.resolvePath(filePath);
    const flag = options?.recursive ? '-p' : '';
    const result = await this.exec(`mkdir ${flag} ${shellArg(absolute)}`, {
      cwd: this.workingDirectory,
      timeoutMs: 5_000,
    });
    if (!result.success) {
      throw new Error(
        `Failed to create directory ${filePath}: ${result.stderr}`
      );
    }
  }

  async readdir(filePath: string): Promise<SandboxDirent[]> {
    const absolute = this.resolvePath(filePath);
    const result = await this.exec(
      `find ${shellArg(absolute)} -maxdepth 1 -mindepth 1 -printf '%y\\t%f\\n'`,
      { cwd: this.workingDirectory, timeoutMs: 10_000 }
    );
    if (!result.success) {
      throw new Error(`ENOENT: ${filePath}`);
    }
    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [type, ...nameParts] = line.split('\t');
        const name = nameParts.join('\t');
        return {
          name,
          isDir: type === 'd',
          isFile: type === 'f',
          isSymlink: type === 'l',
        };
      });
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.hooks?.beforeStop) {
      try {
        await this.hooks.beforeStop(this);
      } catch (error) {
        log.warn(
          { err: error instanceof Error ? error.message : String(error) },
          'beforeStop hook failed'
        );
      }
    }
    await this.container.stop().catch(() => {});
    await this.container.remove({ force: true }).catch(() => {});
  }

  getState(): DockerSandboxState {
    return {
      provider: 'docker',
      containerId: this.id,
      workingDirectory: this.workingDirectory,
      ...(this.currentBranch ? { currentBranch: this.currentBranch } : {}),
      ...(this.declaredPorts.length > 0
        ? { ports: this.declaredPorts, portMap: this.portMap }
        : {}),
    };
  }

  private resolvePath(filePath: string): string {
    return path.isAbsolute(filePath)
      ? filePath
      : path.join(this.workingDirectory, filePath);
  }
}

function shellArg(input: string): string {
  return `'${input.replace(/'/g, `'\\''`)}'`;
}
