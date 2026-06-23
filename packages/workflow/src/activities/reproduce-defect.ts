import type { DefectAnalysis, ReproductionOracle } from '@codewright/domain';
import type { SandboxState } from '@codewright/sandbox';
import { reproduceDefect } from '@codewright/solver';
import { log } from '../logger.js';
import {
  type AgentActivityResult,
  runSandboxAgentInActivity,
} from '../utils/agent-activity.js';

export async function reproduceDefectActivity(
  taskEventId: string,
  state: SandboxState,
  analysis: DefectAnalysis
): Promise<AgentActivityResult<ReproductionOracle>> {
  log.info(
    {
      hasTestInfra: analysis.hasTestInfra,
      hasWebUI: analysis.hasWebUI,
      riskClass: analysis.riskClass,
    },
    'Starting reproduction activity'
  );
  const out = await runSandboxAgentInActivity(
    state,
    'reproduce',
    'reproduceDefect',
    taskEventId,
    (sandbox, observer) => reproduceDefect(sandbox, analysis, observer)
  );
  if (out.result) {
    log.info(
      {
        mode: out.result.mode,
        confirmedFailing: out.result.confirmedFailing,
      },
      'Reproduction activity complete'
    );
  }
  return out;
}
