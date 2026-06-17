import type {
  DefectAnalysis,
  ReproductionOracle,
  ResolutionResult,
} from '@torin/domain';
import { connectSandbox, type SandboxState } from '@torin/sandbox';
import { implementResolution } from '@torin/solver';
import { log } from '../logger.js';
import {
  type AgentActivityResult,
  runAgentInActivity,
} from '../utils/agent-activity.js';

export async function implementResolutionActivity(
  state: SandboxState,
  defectDescription: string,
  analysis: DefectAnalysis,
  oracle: ReproductionOracle | null,
  userFeedback?: string
): Promise<AgentActivityResult<ResolutionResult>> {
  log.info(
    {
      oracleMode: oracle?.mode,
      scopeSize: analysis.scopeDeclaration.length,
      hasFeedback: !!userFeedback,
    },
    'Starting resolution implementation activity'
  );
  const sandbox = await connectSandbox(state);
  const out = await runAgentInActivity(
    'implement',
    'implementResolution',
    (observer) =>
      implementResolution(
        sandbox,
        defectDescription,
        analysis,
        oracle,
        userFeedback,
        observer
      )
  );
  if (out.result) {
    log.info(
      {
        branch: out.result.branch,
        testsPassed: out.result.testsPassed,
        eventCount: out.observation.events.length,
      },
      'Resolution implementation complete'
    );
  }
  return out;
}
