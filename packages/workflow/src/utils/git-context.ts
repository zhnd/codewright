import type { AuthProvider } from '@codewright/database';
import {
  createGitClient,
  type GitHostClient,
  mapAuthProvider,
} from '@codewright/githost';
import { decrypt, getEncryptionKey } from '@codewright/shared';

interface ProjectLike {
  authProvider: AuthProvider;
  repositoryUrl: string;
  encryptedCredentials: string | null;
}

/**
 * Build a fully-bound git host client from a Project row. Throws if the
 * project has no credentials — call only from activities that need API
 * access. Sandbox / push-branch activities should gate on
 * `project.encryptedCredentials` themselves.
 */
export function gitClientFor(project: ProjectLike): GitHostClient {
  if (!project.encryptedCredentials) {
    throw new Error('Project has no credentials configured');
  }
  return createGitClient({
    provider: mapAuthProvider(project.authProvider),
    repositoryUrl: project.repositoryUrl,
    token: decrypt(project.encryptedCredentials, getEncryptionKey()),
  });
}
