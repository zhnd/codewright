import {
  CancellationScope,
  condition,
  defineSignal,
  isCancellation,
  setHandler,
} from '@temporalio/workflow';
import type {
  DefectAnalysis,
  ReproductionOracle,
  ResolutionResult,
  ResolveDefectInput,
  ReviewDecision,
  TaskStatus,
} from '@torin/domain';
import type { SandboxState } from '@torin/sandbox';
import { buildPrBody } from '../../utils/build-pr-body.js';
import { runAnalyze } from './phases/analyze.js';
import { runImplement } from './phases/implement.js';
import { main, sandboxAgent, sandboxInfra } from './proxies.js';
import { buildPrStageInput, buildReproduceStageInput } from './transformer.js';

// ── Signal ───────────────────────────────────────────────────────────

export const reviewSignal = defineSignal<[ReviewDecision]>('reviewDecision');

/**
 * Soft cap on how long a HITL gate may block. If a reviewer never
 * decides within this window, the gate raises HitlTimeoutError so the
 * workflow can put the task in FAILED instead of holding the sandbox
 * + workflow-task slot indefinitely. 72h is enough to survive a long
 * weekend and still recover resources before they leak.
 */
const HITL_TIMEOUT_MS = 72 * 60 * 60 * 1000;

export class HitlTimeoutError extends Error {
  constructor(timeoutMs: number) {
    const hours = Math.round(timeoutMs / 3_600_000);
    super(`HITL review window expired after ${hours}h with no decision`);
    this.name = 'HitlTimeoutError';
  }
}

export interface ReviewGate {
  /**
   * Reset state and await the next review submission, bounded by
   * HITL_TIMEOUT_MS. Throws HitlTimeoutError on expiry.
   */
  resetAndWait(): Promise<void>;
  /** Read the value left by the latest signal (caller must have awaited). */
  consume(): ReviewDecision;
}

/**
 * Set up the review signal handler with closure-captured state. Call
 * once at workflow start; reuse the returned gate for every HITL gate.
 */
function createReviewGate(): ReviewGate {
  let result: ReviewDecision | undefined;
  setHandler(reviewSignal, (decision) => {
    result = decision;
  });
  return {
    async resetAndWait() {
      result = undefined;
      const arrived = await condition(
        () => result !== undefined,
        HITL_TIMEOUT_MS
      );
      if (!arrived) {
        throw new HitlTimeoutError(HITL_TIMEOUT_MS);
      }
    },
    consume() {
      return result as unknown as ReviewDecision;
    },
  };
}

// ── Phase context ────────────────────────────────────────────────────

export interface PhaseContext {
  taskId: string;
  sandboxState: SandboxState;
  config: { autoApproveTrivial: boolean };
  reviewGate: ReviewGate;
}

// ── Workflow ─────────────────────────────────────────────────────────
//
// Owns: signal handler, sandbox lifecycle, terminal task status, phase
// sequencing. Two phases with their own logic (analyze HITL loop,
// implement best-of-N + HITL) live under `phases/`. The two trivial
// linear phases (reproduce, pr) are inlined below.
//
// Termination policy: only `task.status` flips to terminal. Open stage
// events stay in their last status; the resolver treats non-terminal
// stage events on a terminal task as orphaned execution history.

export async function resolveDefectWorkflow(
  input: ResolveDefectInput
): Promise<void> {
  const reviewGate = createReviewGate();

  await main.updateTaskActivity({
    taskId: input.taskId,
    task: { status: 'RUNNING' },
  });

  // Env-backed feature flags live behind an activity because the
  // Temporal workflow sandbox has no `process.env`.
  const config = await main.getWorkflowConfigActivity();

  let sandboxState: SandboxState | undefined;
  try {
    sandboxState = await sandboxInfra.createSandboxActivity(
      input.repositoryUrl,
      { projectId: input.projectId }
    );

    const ctx: PhaseContext = {
      taskId: input.taskId,
      sandboxState,
      config,
      reviewGate,
    };

    const analysis = await runAnalyze(ctx, input);
    const oracle = await runReproduce(ctx, analysis);
    // Establish the execution baseline (the oracle must FAIL on the
    // unpatched base) so IMPLEMENT can verify a real FAIL_TO_PASS delta
    // instead of trusting that the oracle merely passes on the patch.
    // Only runnable test oracles can be verified this way.
    const baseline =
      oracle &&
      (oracle.mode === 'test-framework' || oracle.mode === 'verify-script')
        ? await sandboxInfra.establishBaselineActivity({
            state: ctx.sandboxState,
            oracle,
          })
        : null;
    const resolution = await runImplement(
      ctx,
      input,
      analysis,
      oracle,
      baseline
    );
    await runPullRequest(ctx, input, analysis, resolution);

    await main.updateTaskActivity({
      taskId: input.taskId,
      task: { status: 'COMPLETED' },
    });
  } catch (err) {
    const cancelled = isCancellation(err);
    const status: TaskStatus = cancelled ? 'CANCELLED' : 'FAILED';
    const errorText = cancelled
      ? 'Cancelled by user'
      : err instanceof Error
        ? err.message
        : String(err);

    await CancellationScope.nonCancellable(() =>
      main.updateTaskActivity({
        taskId: input.taskId,
        task: { status, error: errorText },
      })
    );
  } finally {
    // Non-cancellable scope so an external cancel() can't interrupt
    // sandbox teardown — standard Temporal cleanup pattern.
    await CancellationScope.nonCancellable(async () => {
      if (sandboxState) {
        await sandboxInfra.destroySandboxActivity(sandboxState);
      }
    });
  }
}

// ── Inline phases ────────────────────────────────────────────────────
// These two are linear (no HITL, no looping), so they live next to the
// orchestrator instead of under `phases/`. Promote to a dedicated
// phase file the moment they grow a loop or a gate.

/**
 * Conditional reproduction. Skipped when the analysis says the repo has
 * neither test infra nor a web UI. The agent may also self-skip via
 * `oracle.mode === 'none'`. On success the oracle file is committed
 * before returning so IMPLEMENT starts on a clean tree.
 */
async function runReproduce(
  ctx: PhaseContext,
  analysis: DefectAnalysis
): Promise<ReproductionOracle | null> {
  const shouldAttempt = analysis.hasTestInfra || analysis.hasWebUI;

  const { startedStage } = await main.updateTaskActivity({
    taskId: ctx.taskId,
    startStage: {
      stageKey: 'REPRODUCE',
      input: buildReproduceStageInput({ analysis }),
    },
  });
  const eventId = startedStage!.eventId;

  if (!shouldAttempt) {
    await main.updateTaskActivity({
      taskId: ctx.taskId,
      updateStage: {
        eventId,
        status: 'SKIPPED',
        output: { reason: 'no test infra / web UI' },
      },
    });
    return null;
  }

  const reproduceOut = await sandboxAgent.reproduceDefectActivity(
    ctx.sandboxState,
    analysis
  );
  await main.persistAgentInvocationActivity({
    taskEventId: eventId,
    capturedTrace: reproduceOut.capturedTrace,
    errorText: reproduceOut.errorText,
  });
  if (reproduceOut.status !== 'SUCCESS' || !reproduceOut.result) {
    await main.updateTaskActivity({
      taskId: ctx.taskId,
      updateStage: {
        eventId,
        status: 'FAILED',
        error: reproduceOut.errorText ?? 'reproduceDefect failed',
      },
    });
    throw new Error(reproduceOut.errorText ?? 'reproduceDefect failed');
  }
  const oracle = reproduceOut.result;

  if (oracle.mode === 'none') {
    await main.updateTaskActivity({
      taskId: ctx.taskId,
      updateStage: { eventId, status: 'SKIPPED', output: oracle },
    });
    return null;
  }

  // REPRODUCE's agent writes the oracle file but does not commit it.
  // Commit it here so IMPLEMENT starts from a clean working tree —
  // the precondition guardrail's `requireCleanTree` check would
  // otherwise flag this uncommitted file as a violation on every retry.
  if (oracle.filePath) {
    await sandboxInfra.commitOracleActivity(ctx.sandboxState, oracle.filePath);
  }

  await main.updateTaskActivity({
    taskId: ctx.taskId,
    updateStage: { eventId, status: 'COMPLETED', output: oracle },
  });
  return oracle;
}

/**
 * PR phase. Pushes the resolution branch, opens a pull request, and
 * (optionally) attaches review comments. Closes the PR stage event with
 * the `{url, number}` payload the web reads for the "Pull request" body.
 */
async function runPullRequest(
  ctx: PhaseContext,
  input: ResolveDefectInput,
  analysis: DefectAnalysis,
  resolution: ResolutionResult
): Promise<void> {
  const { startedStage: prStage } = await main.updateTaskActivity({
    taskId: ctx.taskId,
    startStage: {
      stageKey: 'PR',
      input: buildPrStageInput({ resolution }),
    },
  });
  const prEventId = prStage!.eventId;

  await sandboxInfra.pushBranchActivity(ctx.sandboxState, resolution.branch, {
    projectId: input.projectId,
  });

  const prResult = await main.createPullRequestActivity(
    input.projectId,
    resolution.branch,
    resolution.baseBranch,
    `Fix: ${resolution.summary.slice(0, 60)}`,
    buildPrBody(input.defectDescription, analysis, resolution)
  );

  if (resolution.changes?.length > 0) {
    await main.addPrReviewCommentsActivity(
      input.projectId,
      prResult.number,
      resolution.changes
    );
  }

  await main.updateTaskActivity({
    taskId: ctx.taskId,
    updateStage: {
      eventId: prEventId,
      status: 'COMPLETED',
      output: prResult,
    },
  });
}
