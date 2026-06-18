/**
 * Credential broker for git over HTTPS.
 *
 * The token is never written to .git/config. Instead we register a git
 * credential.helper that reads from the CODEWRIGHT_GIT_TOKEN env var at command
 * time. Callers inject CODEWRIGHT_GIT_TOKEN through the exec env (never through
 * getState()), so snapshots/reconnects of the container do not leak the
 * token.
 *
 * The helper script's username differs by provider (GitHub: x-access-token,
 * cnb.cool: cnb), so the script itself is provider-aware.
 */
import { type GitHostProvider, gitCredentialsFor } from '@codewright/githost';

export function buildCredentialHelper(provider: GitHostProvider): string {
  return gitCredentialsFor(provider).helperScript;
}

export function buildCredentialEnv(
  token: string | undefined
): Record<string, string> {
  return token ? { CODEWRIGHT_GIT_TOKEN: token } : {};
}

export function redactTokenFromUrl(url: string): string {
  return url.replace(/(https?:\/\/)[^@/]+:[^@/]+@/, '$1***@');
}
