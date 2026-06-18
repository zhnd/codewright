import { CnbClient } from './cnb/client.js';
import { GitHubClient } from './github/client.js';
import type {
  BotIdentity,
  GitCredentials,
  GitHostClient,
  GitHostProvider,
} from './interface.js';
import { parseRepoUrl } from './url.js';

export interface CreateGitClientOptions {
  provider: GitHostProvider;
  repositoryUrl: string;
  token: string;
  /** cnb only — override API base URL for tests. */
  apiBaseUrl?: string;
}

/**
 * Build a fully-bound git host client. The client owns its repo identity,
 * provider, bot identity, and token — methods take action-specific args
 * only and never re-thread the repo.
 */
export function createGitClient(opts: CreateGitClientOptions): GitHostClient {
  const repo = parseRepoUrl(opts.repositoryUrl);
  if (repo.provider !== opts.provider) {
    throw new Error(
      `repositoryUrl host (${repo.host}) does not match provider (${opts.provider})`
    );
  }
  const botIdentity = defaultBotIdentity(opts.provider);
  switch (opts.provider) {
    case 'github':
      return new GitHubClient({ token: opts.token, repo, botIdentity });
    case 'cnb':
      return new CnbClient({
        token: opts.token,
        repo,
        botIdentity,
        apiBaseUrl: opts.apiBaseUrl,
      });
    default: {
      const _exhaustive: never = opts.provider;
      throw new Error(`Unknown git host provider: ${_exhaustive}`);
    }
  }
}

const GIT_TOKEN_ENV = 'CODEWRIGHT_GIT_TOKEN';

export function gitCredentialsFor(provider: GitHostProvider): GitCredentials {
  switch (provider) {
    case 'github':
      return {
        username: 'x-access-token',
        envVarName: GIT_TOKEN_ENV,
        helperScript: `!f() { echo username=x-access-token; echo password=$${GIT_TOKEN_ENV}; }; f`,
      };
    case 'cnb':
      return {
        username: 'cnb',
        envVarName: GIT_TOKEN_ENV,
        helperScript: `!f() { echo username=cnb; echo password=$${GIT_TOKEN_ENV}; }; f`,
      };
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown git host provider: ${_exhaustive}`);
    }
  }
}

export function defaultBotIdentity(provider: GitHostProvider): BotIdentity {
  switch (provider) {
    case 'github':
      return {
        name: 'codewright-bot',
        email: 'codewright-bot@users.noreply.github.com',
      };
    case 'cnb':
      // Email format pending verification against a real cnb account; treat
      // as a sensible default until §1 of the verification plan confirms it.
      return {
        name: 'codewright-bot',
        email: 'codewright-bot@users.noreply.cnb.cool',
      };
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown git host provider: ${_exhaustive}`);
    }
  }
}

/** Map the Prisma `AuthProvider` enum (uppercase) to `GitHostProvider`. */
export function mapAuthProvider(
  prismaEnum: 'GITHUB' | 'GITLAB' | 'GITEA' | 'CNB'
): GitHostProvider {
  switch (prismaEnum) {
    case 'GITHUB':
      return 'github';
    case 'CNB':
      return 'cnb';
    case 'GITLAB':
    case 'GITEA':
      throw new Error(`AuthProvider ${prismaEnum} is not yet implemented`);
    default: {
      const _exhaustive: never = prismaEnum;
      throw new Error(`Unknown AuthProvider: ${_exhaustive}`);
    }
  }
}
