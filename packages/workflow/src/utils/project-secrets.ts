import { decrypt, getEncryptionKey } from '@codewright/shared';

interface ProjectLike {
  workflowConfig: unknown;
}

/**
 * Decrypt the per-project `.npmrc` blob stored under
 * `Project.workflowConfig.secrets.npmrc`. Returns null when the project has
 * no npmrc configured. Convention for the secrets namespace: every value is
 * an `@codewright/shared encrypt()` ciphertext (AES-GCM); add new keys for
 * future config files (cargo creds, pip.conf, etc.).
 */
export function npmrcFor(project: ProjectLike): string | null {
  const cfg = project.workflowConfig as { secrets?: { npmrc?: string } } | null;
  const ciphertext = cfg?.secrets?.npmrc;
  if (!ciphertext) return null;
  return decrypt(ciphertext, getEncryptionKey());
}
