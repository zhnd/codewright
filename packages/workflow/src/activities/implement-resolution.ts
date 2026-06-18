import type {
  DefectAnalysis,
  ReproductionOracle,
  ResolutionResult,
} from '@codewright/domain';
import type { SandboxState } from '@codewright/sandbox';
import { implementResolution } from '@codewright/solver';
import { log } from '../logger.js';
import {
  type AgentActivityResult,
  runSandboxAgentInActivity,
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
  const out = await runSandboxAgentInActivity(
    state,
    'implement',
    'implementResolution',
    (sandbox, observer) =>
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
