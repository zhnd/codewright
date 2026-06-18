import type { DefectIntent } from '@torin/domain';
import { triageDefectIntent } from '@torin/solver';
import { log } from '../logger.js';
import {
  type AgentActivityResult,
  runAgentInActivity,
} from '../utils/agent-activity.js';

/**
 * Triage activity — runs the text-only intent-extraction agent. No
 * sandbox; the activity is dispatched on the main task queue (via the
 * `mainAgent` proxy) so it does not consume the bounded sandbox
 * concurrency slot. ~6 turns typical.
 */
export async function triageDefectIntentActivity(
  defectDescription: string,
  feedback?: string
): Promise<AgentActivityResult<DefectIntent>> {
  log.info({ hasFeedback: !!feedback }, 'Starting defect-intent triage');
  return runAgentInActivity('analysis', 'triageDefectIntent', (observer) =>
    triageDefectIntent(defectDescription, feedback, observer)
  );
}
