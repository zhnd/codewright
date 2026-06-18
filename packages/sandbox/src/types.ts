import type { GitHostProvider } from '@torin/githost';

export interface Source {
  repo: string;
  branch?: string;
  /**
   * Check out this exact commit SHA after fetch/clone (and before creating
   * `newBranch`). Used by evaluation harnesses (e.g. SWE-bench, which pins
   * each instance to a base_commit). When omitted, the branch tip is used.
   */
  commit?: string;
  token?: string;
  newBranch?: string;
  /** Defaults to 'github' when omitted, preserving existing callers. */
  provider?: GitHostProvider;
}

export interface GitUser {
  name: string;
  email: string;
}
