import type { AnalysisResult } from '@codewright/domain';
import type { SandboxState } from '@codewright/sandbox';
import { analyzeRepository } from '@codewright/solver';
import { log } from '../logger.js';
import {
  type AgentActivityResult,
  runSandboxAgentInActivity,
} from '../utils/agent-activity.js';

export async function analyzeCodeActivity(
  taskEventId: string,
  state: SandboxState
): Promise<AgentActivityResult<AnalysisResult>> {
  log.info('Running code analysis');
  const out = await runSandboxAgentInActivity(
    state,
    'analysis',
    'analyzeRepository',
    taskEventId,
    (sandbox, observer) => analyzeRepository(sandbox, observer)
  );
  log.info({ status: out.status }, 'Code analysis activity returned');
  return out;
}
