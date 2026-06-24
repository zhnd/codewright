import type { AuthProvider } from '@codewright/database';
import { parseRepoUrl } from '@codewright/githost';
import { ValidationError } from '../../../../infrastructure/errors/app-error.js';

const PROVIDER_TO_PRISMA: Record<'github' | 'cnb', AuthProvider> = {
  github: 'GITHUB',
  cnb: 'CNB',
};

/**
 * Parse a repository URL and assert its host matches the selected auth
 * provider, so workflows don't later fail with confusing 404s from the
 * wrong API. Throws `ValidationError` on an unparseable URL or a mismatch.
 *
 * Shared by create-project and update-project, which previously each carried
 * their own copy of this map + parse/validate block.
 */
export function assertRepoUrlMatchesProvider(
  repositoryUrl: string,
  authProvider: AuthProvider
): void {
  let parsed: ReturnType<typeof parseRepoUrl>;
  try {
    parsed = parseRepoUrl(repositoryUrl);
  } catch (err) {
    throw new ValidationError(
      err instanceof Error ? err.message : 'Invalid repository URL'
    );
  }
  if (PROVIDER_TO_PRISMA[parsed.provider] !== authProvider) {
    throw new ValidationError(
      `Repository URL host (${parsed.host}) does not match authProvider (${authProvider})`
    );
  }
}
