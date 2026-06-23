import type { DefectAnalysis, ResolveDefectInput } from '@codewright/domain';
import { sumStageCost } from '../../../utils/stage-cost.js';
import { shouldAutoApproveAnalysis } from '../../../utils/trivial-gate.js';
import { MAX_ANALYSIS_ROUNDS } from '../constants.js';
import type { PhaseContext } from '../index.js';
import { main, mainAgent, sandboxAgent } from '../proxies.js';
import { buildAnalyzeStageInput } from '../transformer.js';

/**
 * Analysis phase with HITL loop. Each round runs two sub-agents in
 * sequence inside ONE ANALYSIS stage event:
 *
 *   1. triageDefectIntent  — text-only. Parses the raw defectDescription
 *      into a structured DefectIntent (search queries, key terms,
 *      unknowns, etc.). No sandbox tool access; runs on the main queue
 *      to avoid consuming sandbox concurrency slots.
 *
 *   2. analyzeDefect       — sandbox read-only. Receives the intent
 *      plus the project's cached repoNavigation map as a prompt prefix,
 *      and produces the full DefectAnalysis. Starts exploration from
 *      intent.searchHypotheses instead of doing open-ended file walking.
 *
 * Both invocations persist as separate AgentInvocation rows on the
 * same TaskEvent (the schema already supports multiple). The stage's
 * `output` is the composed DefectAnalysis (with `intent` attached so
 * HITL UI / PR body see the full reasoning chain in one document).
 *
 * A single HITL gate at the end approves or rejects the composed
 * analysis; rejection re-runs BOTH sub-agents with the reviewer
 * feedback injected — feedback often targets one sub-pass, but
 * re-running both is the simplest correct shape and intent is cheap.
 */
export async function runAnalyze(
  ctx: PhaseContext,
  input: ResolveDefectInput
): Promise<DefectAnalysis> {
  // Fetch the project's cached repo-navigation snapshot ONCE per
  // workflow run, before entering the HITL retry loop. Same snapshot
  // is reused across rounds — re-querying on every reject would only
  // matter if an analyze-repository task landed mid-loop, which is
  // exceedingly rare (analyze-repository is manually triggered).
  const repoNavigation = await main.loadRepoNavigationActivity(input.projectId);

  let feedback: string | undefined;

  for (let round = 0; round < MAX_ANALYSIS_ROUNDS; round++) {
    const { startedStage } = await main.updateTaskActivity({
      taskId: ctx.taskId,
      startStage: {
        stageKey: 'ANALYSIS',
        input: buildAnalyzeStageInput({
          defectDescription: input.defectDescription,
          repoNavigation: repoNavigation ?? undefined,
          feedback,
        }),
      },
    });
    const eventId = startedStage!.eventId;

    // ── Sub-agent 1: triage intent (text-only, cheap) ────────────────
    const triageOut = await mainAgent.triageDefectIntentActivity(
      eventId,
      input.defectDescription,
      feedback
    );
    if (triageOut.status !== 'SUCCESS' || !triageOut.result) {
      await main.updateTaskActivity({
        taskId: ctx.taskId,
        updateStage: {
          eventId,
          status: 'FAILED',
          error: triageOut.errorText ?? 'triageDefectIntent failed',
          cost: sumStageCost(triageOut.cost),
        },
      });
      throw new Error(triageOut.errorText ?? 'triageDefectIntent failed');
    }
    const intent = triageOut.result;

    // ── Sub-agent 2: analyze with intent + repoMap ───────────────────
    const analyzeOut = await sandboxAgent.analyzeDefectActivity(
      eventId,
      ctx.sandboxState,
      input.defectDescription,
      intent,
      repoNavigation ?? undefined,
      feedback
    );
    if (analyzeOut.status !== 'SUCCESS' || !analyzeOut.result) {
      await main.updateTaskActivity({
        taskId: ctx.taskId,
        updateStage: {
          eventId,
          status: 'FAILED',
          error: analyzeOut.errorText ?? 'analyzeDefect failed',
          // triage succeeded, analyze failed — bill both runs.
          cost: sumStageCost(triageOut.cost, analyzeOut.cost),
        },
      });
      throw new Error(analyzeOut.errorText ?? 'analyzeDefect failed');
    }
    // Attach intent so the persisted stage output is self-describing
    // (HITL UI and PR body don't need a second lookup). The schema
    // field is optional and designed for this composition.
    const analysis: DefectAnalysis = { ...analyzeOut.result, intent };
    // Stage cost = triage + analyze agent runs.
    const stageCost = sumStageCost(triageOut.cost, analyzeOut.cost);

    // Trivial auto-approve gate: skip HITL for defects the agent
    // self-classified as trivial when the env flag is on.
    const autoAnalyze = shouldAutoApproveAnalysis(
      analysis,
      ctx.config.autoApproveTrivial ? 'true' : undefined
    );
    if (autoAnalyze.autoApprove) {
      await main.updateTaskActivity({
        taskId: ctx.taskId,
        updateStage: {
          eventId,
          status: 'COMPLETED',
          output: analysis,
          cost: stageCost,
        },
      });
      return analysis;
    }

    // HITL gate — single gate at end of stage. Reviewer sees intent +
    // candidateRootCauses + consideredStrategies in one document.
    await main.updateTaskActivity({
      taskId: ctx.taskId,
      updateStage: {
        eventId,
        status: 'AWAITING',
        output: analysis,
        cost: stageCost,
      },
    });
    await ctx.reviewGate.resetAndWait();
    const decision = ctx.reviewGate.consume();

    if (decision.action === 'approve') {
      await main.updateTaskActivity({
        taskId: ctx.taskId,
        updateStage: { eventId, status: 'COMPLETED' },
      });
      return analysis;
    }

    await main.updateTaskActivity({
      taskId: ctx.taskId,
      updateStage: { eventId, status: 'REJECTED' },
    });
    feedback = decision.feedback;
  }

  throw new Error(
    `Analysis did not converge after ${MAX_ANALYSIS_ROUNDS} review rounds`
  );
}
