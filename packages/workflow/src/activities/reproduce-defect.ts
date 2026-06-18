import type { DefectAnalysis, ReproductionOracle } from '@torin/domain';
import type { SandboxState } from '@torin/sandbox';
import { reproduceDefect } from '@torin/solver';
import { log } from '../logger.js';
import {
  type AgentActivityResult,
  runSandboxAgentInActivity,
} from '../utils/agent-activity.js';

export async function reproduceDefectActivity(
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
    (sandbox, observer) => reproduceDefect(sandbox, analysis, observer)
  );
  if (out.result) {
    log.info(
      {
        mode: out.result.mode,
        confirmedFailing: out.result.confirmedFailing,
        eventCount: out.observation.events.length,
      },
      'Reproduction activity complete'
    );
  }
  return out;
}
