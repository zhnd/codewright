import type {
  AnalysisResult,
  DefectAnalysis,
  DefectIntent,
} from '@codewright/domain';
import type { SandboxState } from '@codewright/sandbox';
import { analyzeDefect } from '@codewright/solver';
import { log } from '../logger.js';
import {
  type AgentActivityResult,
  runSandboxAgentInActivity,
} from '../utils/agent-activity.js';

export async function analyzeDefectActivity(
  taskEventId: string,
  state: SandboxState,
  defectDescription: string,
  intent: DefectIntent | undefined,
  repoNavigation: AnalysisResult | undefined,
  feedback?: string
): Promise<AgentActivityResult<DefectAnalysis>> {
  log.info(
    {
      hasIntent: !!intent,
      hasRepoMap: !!repoNavigation,
      hasFeedback: !!feedback,
    },
    'Starting defect analysis activity'
  );
  const out = await runSandboxAgentInActivity(
    state,
    'analysis',
    'analyzeDefect',
    taskEventId,
    (sandbox, observer) =>
      analyzeDefect(
        sandbox,
        defectDescription,
        intent,
        repoNavigation,
        feedback,
        observer
      )
  );
  if (out.result) {
    log.info(
      {
        rootCause: out.result.rootCause.slice(0, 100),
        candidates: out.result.candidateRootCauses?.length ?? 0,
        strategies: out.result.consideredStrategies?.length ?? 0,
      },
      'Defect analysis complete'
    );
  }
  return out;
}
