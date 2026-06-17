import type { AnalysisResult } from '@torin/domain';
import { connectSandbox, type SandboxState } from '@torin/sandbox';
import { analyzeRepository } from '@torin/solver';
import { log } from '../logger.js';
import {
  type AgentActivityResult,
  runAgentInActivity,
} from '../utils/agent-activity.js';

export async function analyzeCodeActivity(
  state: SandboxState
): Promise<AgentActivityResult<AnalysisResult>> {
  log.info('Running code analysis');
  const sandbox = await connectSandbox(state);
  const out = await runAgentInActivity(
    'analysis',
    'analyzeRepository',
    (observer) => analyzeRepository(sandbox, observer)
  );
  log.info(
    { eventCount: out.observation.events.length, status: out.status },
    'Code analysis activity returned'
  );
  return out;
}
