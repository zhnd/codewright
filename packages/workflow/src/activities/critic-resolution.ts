import type {
  CriticReview,
  DefectAnalysis,
  ReproductionOracle,
  ResolutionResult,
} from '@codewright/domain';
import type { SandboxState } from '@codewright/sandbox';
import { criticResolution } from '@codewright/solver';
import { log } from '../logger.js';
import {
  type AgentActivityResult,
  runSandboxAgentInActivity,
} from '../utils/agent-activity.js';

export async function criticResolutionActivity(
  state: SandboxState,
  defectDescription: string,
  analysis: DefectAnalysis,
  oracle: ReproductionOracle | null,
  resolution: ResolutionResult
): Promise<AgentActivityResult<CriticReview>> {
  log.info(
    {
      filesChanged: resolution.filesChanged.length,
      scopeSize: analysis.scopeDeclaration.length,
    },
    'Starting critic review activity'
  );
  const out = await runSandboxAgentInActivity(
    state,
    'critic',
    'criticResolution',
    (sandbox, observer) =>
      criticResolution(
        sandbox,
        defectDescription,
        analysis,
        oracle,
        resolution,
        observer
      )
  );
  if (out.result) {
    log.info(
      {
        approve: out.result.approve,
        score: out.result.score,
        concernCount: out.result.concerns.length,
        scopeAssessment: out.result.scopeAssessment,
      },
      'Critic review complete'
    );
  }
  return out;
}
