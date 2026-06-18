import { connectSandbox, type SandboxState } from '@codewright/sandbox';
import { log } from '../logger.js';
import {
  checkPreconditions,
  type PreconditionCheckResult,
} from '../utils/precondition-check.js';

export interface CheckPreconditionsInput {
  state: SandboxState;
  scopeDeclaration: string[];
  existingTestFiles?: string[];
  requiredFiles?: string[];
  requireCleanTree?: boolean;
}

/**
 * Activity wrapper around the pure `checkPreconditions` helper so the
 * workflow can invoke it (workflows can't touch sandbox I/O directly).
 */
export async function checkPreconditionsActivity(
  input: CheckPreconditionsInput
): Promise<PreconditionCheckResult> {
  const sandbox = await connectSandbox(input.state);
  const result = await checkPreconditions(sandbox, {
    scopeDeclaration: input.scopeDeclaration,
    existingTestFiles: input.existingTestFiles,
    requiredFiles: input.requiredFiles,
    requireCleanTree: input.requireCleanTree,
  });
  log.info(
    {
      clean: result.clean,
      violationCount: result.violations.length,
    },
    'Precondition check complete'
  );
  return result;
}
