import type { AgentObserver } from '@codewright/agent-runtime';
import { runAgent } from '@codewright/agent-runtime';
import { type DefectIntent, defectIntentSchema } from '@codewright/domain';
import {
  buildTriageDefectIntentUserPrompt,
  TRIAGE_DEFECT_INTENT_SYSTEM_PROMPT,
} from './prompts.js';

/**
 * Triage agent — parses a raw defect description into a structured
 * DefectIntent. Text-only: no sandbox, no file access, no shell. The
 * Claude Agent SDK's built-in tools (Bash/Read/Grep/etc.) are not
 * whitelisted because we pass no `allowedTools`; only the
 * auto-registered `submit_result` tool is callable, which is the
 * one we want.
 *
 * Output is consumed by the analyze-defect agent as a constraint
 * (SpecRover-style spec-as-shared-artifact pattern), specifically:
 *   - searchHypotheses are the analyze agent's first-turn agenda
 *   - keyTerms (bilingual) drive grep targets without losing Chinese
 *   - unknowns surface "ask the human" questions to the HITL gate
 *
 * Designed to be cheap (~6 turns, no tool round-trips). If you have
 * AGENT_MAX_TURNS_TRIAGE_DEFECT_INTENT set in env, it overrides.
 */
export async function triageDefectIntent(
  defectDescription: string,
  feedback?: string,
  observer?: AgentObserver
): Promise<DefectIntent> {
  const { result } = await runAgent<DefectIntent>({
    agentName: 'triageDefectIntent',
    stage: 'analysis',
    systemPrompt: TRIAGE_DEFECT_INTENT_SYSTEM_PROMPT,
    userPrompt: buildTriageDefectIntentUserPrompt(defectDescription, feedback),
    schema: defectIntentSchema,
    queryOptions: {
      maxTurns: 6,
    },
    observer,
  });
  return result;
}
