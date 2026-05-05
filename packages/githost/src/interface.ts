import type { FileChange, PullRequestResult } from '@torin/domain';

export type GitHostProvider = 'github' | 'cnb';

export interface ParsedRepo {
  provider: GitHostProvider;
  host: string;
  /** Slash-joined identifier used in API paths. For multi-segment cnb groups
   * this preserves every segment (e.g. ['group','sub','repo']). */
  pathSegments: string[];
  /** First segment — for display only, not for API calls. */
  owner: string;
  /** Last segment — for display only. API calls use pathSegments.join('/'). */
  repo: string;
}

export interface CreatePullRequestArgs {
  head: string;
  base: string;
  title: string;
  body: string;
}

export interface AddReviewCommentsArgs {
  pullNumber: number;
  changes: FileChange[];
}

/**
 * A git host client bound to a single repository + access token. Construct
 * once per project (via `createGitClient`) and call methods directly —
 * the repo identity is stored on the instance, not threaded through args.
 */
export interface GitHostClient {
  readonly provider: GitHostProvider;
  readonly repo: ParsedRepo;
  readonly botIdentity: BotIdentity;
  readonly token: string;

  createPullRequest(args: CreatePullRequestArgs): Promise<PullRequestResult>;
  addReviewComments(args: AddReviewCommentsArgs): Promise<void>;
  /**
   * Branch names available on this repo. The default branch (when known)
   * comes first so callers can use it as a sensible default in pickers.
   * Pagination is handled internally — implementations cap the result at
   * a few hundred branches to keep the response usable in a UI dropdown.
   */
  listBranches(): Promise<string[]>;
}

export interface GitCredentials {
  /** Username supplied to git over HTTPS (basic-auth username field). */
  username: string;
  /** Env var name the credential helper reads at git command time. */
  envVarName: string;
  /** Inline credential.helper script for `git config --global credential.helper`. */
  helperScript: string;
}

export interface BotIdentity {
  name: string;
  email: string;
}
