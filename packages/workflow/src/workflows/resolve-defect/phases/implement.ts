import type {
  AgentCost,
  CriticReview,
  DefectAnalysis,
  ReproductionOracle,
  ResolutionResult,
  ResolveDefectInput,
} from '@codewright/domain';
import type { BaselineSnapshot } from '../../../activities/index.js';
import { renderViolations } from '../../../utils/precondition-check.js';
import {
  type AttemptMemo,
  buildRetryFeedback,
} from '../../../utils/retry-feedback.js';
import { sumStageCost } from '../../../utils/stage-cost.js';
import {
  isAutoApprovable,
  recommendedSampleCount,
} from '../../../utils/trivial-gate.js';
import { IMPLEMENT_SAMPLES, MAX_REVIEW_ROUNDS } from '../constants.js';
import type { PhaseContext } from '../index.js';
import { main, sandboxAgent, sandboxInfra } from '../proxies.js';
import {
  buildAutoApprovedCriticOutput,
  buildFilterCheckEntry,
  buildFinalResolution,
  buildHitlCriticOutput,
  buildImplementStageInput,
  buildSampleSummary,
  type Candidate,
  type CriticReviewEntry,
  deriveTestVerdict,
  type FilterCheckEntry,
  memoFromCriticRejection,
  memoFromFilterFailure,
  memoFromHitlRejection,
  type SampleSummary,
  selectByExecution,
} from '../transformer.js';

/**
 * Implement phase with best-of-N sampling and final HITL gate.
 *
 * Per round:
 *   1. Open IMPLEMENT.
 *   2. Run N samples (each: agent → filter → optional critic → memo if any failure).
 *   3. If no candidate passed, mark IMPLEMENT FAILED and throw.
 *   4. Select top candidate, close IMPLEMENT, open + close FILTER, open CRITIC.
 *   5. CRITIC: trivial auto-approve OR HITL gate.
 *   6. On approve, return final resolution. On reject, mark CRITIC REJECTED
 *      and loop with accumulated feedback.
 *
 * Memos accumulate across rounds (Reflexion-style) so later attempts
 * learn from earlier ones.
 */
export async function runImplement(
  ctx: PhaseContext,
  input: ResolveDefectInput,
  analysis: DefectAnalysis,
  oracle: ReproductionOracle | null,
  baseline: BaselineSnapshot | null
): Promise<ResolutionResult> {
  let reviewerFeedback: string | undefined;
  const attemptMemos: AttemptMemo[] = [];
  // Caller-pinned base branch (e.g. from the Tapd trigger dialog) seeds
  // detectedBaseBranch so the very first sample resets onto the right
  // branch instead of whatever the sandbox happened to clone. Once set,
  // subsequent resets keep the same target — the agent's own
  // result.baseBranch never overrides a user pick.
  const userBaseBranch = input.baseBranch;
  let detectedBaseBranch: string | undefined = userBaseBranch;

  for (let round = 0; round < MAX_REVIEW_ROUNDS; round++) {
    const { startedStage: implementStage } = await main.updateTaskActivity({
      taskId: ctx.taskId,
      startStage: {
        stageKey: 'IMPLEMENT',
        input: buildImplementStageInput({
          analysis,
          oracle,
          feedback: reviewerFeedback,
          priorAttempts: attemptMemos.length,
        }),
      },
    });
    const implementEventId = implementStage!.eventId;

    const candidates: Candidate[] = [];
    const sampleSummaries: SampleSummary[] = [];
    const filterCheckList: FilterCheckEntry[] = [];
    const criticReviewList: CriticReviewEntry[] = [];
    // Accumulate every agent run's cost this round (implement + critic
    // across all samples); written onto the IMPLEMENT stage's TaskEvent.
    const roundCosts: AgentCost[] = [];

    const samplesThisRound = recommendedSampleCount(
      analysis,
      IMPLEMENT_SAMPLES
    );

    for (let sampleId = 1; sampleId <= samplesThisRound; sampleId++) {
      // Sample 1 of round 0 normally skips reset (clean clone), but a
      // user-pinned baseBranch forces an early reset so the agent works
      // on the requested branch.
      if (sampleId > 1 || round > 0 || userBaseBranch) {
        const reset = await sandboxInfra.resetSandboxActivity({
          state: ctx.sandboxState,
          ...(detectedBaseBranch ? { baseBranch: detectedBaseBranch } : {}),
          // Keep eval samples pinned to the instance's base_commit. Without
          // this, the reset would jump to the default-branch tip (years of
          // upstream fixes), making the defect already-fixed and unrepairable.
          ...(input.baseCommit ? { commit: input.baseCommit } : {}),
        });
        detectedBaseBranch = reset.baseBranch;
        // `git reset --hard origin/<base>` discarded the oracle commit
        // from REPRODUCE. Restore it so THIS candidate is verified against
        // the same reproduction the baseline established — otherwise FILTER
        // runs only the pre-existing tests and `oracleVerified` is a false
        // positive (see baseline-differential design).
        if (oracle?.filePath && oracle.content !== undefined) {
          await sandboxInfra.applyOracleActivity(ctx.sandboxState, oracle);
        }
      }

      let preconditionViolations: string[] | undefined;
      if (attemptMemos.length > 0) {
        const pre = await sandboxInfra.checkPreconditionsActivity({
          state: ctx.sandboxState,
          scopeDeclaration: analysis.scopeDeclaration,
          requiredFiles: oracle?.filePath ? [oracle.filePath] : undefined,
          requireCleanTree: true,
        });
        if (!pre.clean) {
          preconditionViolations = renderViolations(pre);
        }
      }

      const sampleFeedback = buildRetryFeedback({
        previousAttempts: attemptMemos,
        reviewerFeedback,
        preconditionViolations,
      });

      // Snapshot HEAD (base + committed oracle) BEFORE the agent edits, so we
      // can derive the canonical fix-only patch from git afterwards.
      const preFixSha = await sandboxInfra.captureHeadShaActivity(
        ctx.sandboxState
      );

      const implementOut = await sandboxAgent.implementResolutionActivity(
        implementEventId,
        ctx.sandboxState,
        input.defectDescription,
        analysis,
        oracle,
        sampleFeedback || undefined
      );
      if (implementOut.cost) roundCosts.push(implementOut.cost);
      if (implementOut.status !== 'SUCCESS' || !implementOut.result) {
        // One sample failing is not terminal — log a memo and move on
        // to the next sample. The stage stays open until all samples
        // run; if no candidate passes, the round throws below.
        attemptMemos.push({
          attemptNum: attemptMemos.length + 1,
          summary:
            implementOut.errorText ?? 'implementResolution agent crashed',
          filesChanged: [],
          failureReasons: [
            implementOut.errorText ?? 'implementResolution agent crashed',
          ],
        });
        continue;
      }
      const result = implementOut.result;
      if (!detectedBaseBranch) {
        detectedBaseBranch = result.baseBranch;
      }
      // If the caller pinned a base branch, override whatever the agent
      // wrote so the PR opens against the user's chosen target.
      if (userBaseBranch) {
        result.baseBranch = userBaseBranch;
      }

      // L1 — never trust the agent's hand-authored diff (it routinely fails to
      // apply: fabricated index lines, wrong hunk headers). Derive the real,
      // applyable patch from the sandbox via `git diff` against the pre-fix
      // HEAD. An empty diff means the agent changed nothing on disk (no-op /
      // already-fixed hallucination) → not a real candidate, drop the sample.
      const canonicalDiff = await sandboxInfra.computeCanonicalDiffActivity({
        state: ctx.sandboxState,
        baseRef: preFixSha,
      });
      if (canonicalDiff.length === 0) {
        attemptMemos.push({
          attemptNum: attemptMemos.length + 1,
          summary:
            'implementResolution reported success but produced no file changes on disk',
          filesChanged: [],
          failureReasons: [
            'No diff vs pre-fix HEAD — the agent likely hallucinated an already-applied fix. Make a real source edit.',
          ],
        });
        continue;
      }
      const reasonByFile = new Map(result.diff.map((d) => [d.file, d.reason]));
      result.diff = canonicalDiff.map((d) => ({
        ...d,
        reason: reasonByFile.get(d.file) ?? d.reason,
      }));
      result.filesChanged = canonicalDiff.map((d) => d.file);

      const filterResult = await sandboxInfra.filterCandidateActivity({
        state: ctx.sandboxState,
        analysis,
        oracle,
        resolution: result,
        projectId: input.projectId,
        baseline: baseline ?? undefined,
      });

      sampleSummaries.push(buildSampleSummary({ sampleId, result }));
      filterCheckList.push(buildFilterCheckEntry({ sampleId, filterResult }));

      // Execution-driven eligibility (SOTA #1 lever): when an oracle or
      // regression suite actually ran, trust THOSE results — not the LLM
      // critic — to decide whether the patch is correct. Lint/boot are
      // soft signals, not gates. Only when the repo yields NO executable
      // correctness signal do we fall back to the old overallPassed gate.
      const verdict = deriveTestVerdict(filterResult);
      const correctnessEligible = verdict.hasExecutableSignal
        ? verdict.executionEligible
        : filterResult.overallPassed;
      if (!correctnessEligible) {
        attemptMemos.push(
          memoFromFilterFailure({
            attemptNum: attemptMemos.length + 1,
            result,
            filterResult,
          })
        );
        continue;
      }

      // Critic runs as ADVISORY — it surfaces concerns for HITL and acts
      // as a tiebreak among execution-eligible candidates. It no longer
      // gates a patch the tests already proved correct.
      const criticOutcome = await sandboxAgent.criticResolutionActivity(
        implementEventId,
        ctx.sandboxState,
        input.defectDescription,
        analysis,
        oracle,
        result
      );
      if (criticOutcome.cost) roundCosts.push(criticOutcome.cost);
      // A critic crash must not drop a test-passing patch — synthesize a
      // neutral review so the candidate still competes.
      const criticReview: CriticReview =
        criticOutcome.status === 'SUCCESS' && criticOutcome.result
          ? criticOutcome.result
          : {
              approve: true,
              score: 0.5,
              concerns: [
                {
                  severity: 'info',
                  description: `critic unavailable: ${criticOutcome.errorText ?? 'crashed'}`,
                },
              ],
              scopeAssessment: 'clean',
            };
      criticReviewList.push({ sampleId, review: criticReview });

      // Fallback gate: only when there was NO executable correctness
      // signal do we honor critic.approve as a hard gate (test-sparse repo).
      if (!verdict.hasExecutableSignal && !criticReview.approve) {
        attemptMemos.push(
          memoFromCriticRejection({
            attemptNum: attemptMemos.length + 1,
            result,
            criticReview,
          })
        );
        continue;
      }

      const candidateBranch = `codewright/cand-${round}-${sampleId}`;
      await sandboxInfra.renameBranchActivity(
        ctx.sandboxState,
        result.branch,
        candidateBranch
      );
      candidates.push({
        resolution: { ...result, branch: candidateBranch },
        originalBranch: result.branch,
        filterResult,
        criticReview,
      });
    }

    if (candidates.length === 0) {
      const error = `No sample passed filter + critic after ${samplesThisRound} attempts`;
      await main.updateTaskActivity({
        taskId: ctx.taskId,
        updateStage: {
          eventId: implementEventId,
          status: 'FAILED',
          error,
          cost: sumStageCost(...roundCosts),
        },
      });
      throw new Error(error);
    }

    // Pick the winner and restore its original branch name (the renames
    // during the loop kept candidates from clobbering each other).
    const selected = selectByExecution(candidates);
    await sandboxInfra.renameBranchActivity(
      ctx.sandboxState,
      selected.resolution.branch,
      selected.originalBranch
    );
    const resolution: ResolutionResult = {
      ...selected.resolution,
      branch: selected.originalBranch,
    };
    const { filterResult, criticReview } = selected;

    // Close IMPLEMENT, open FILTER (atomic boundary).
    const { startedStage: filterStage } = await main.updateTaskActivity({
      taskId: ctx.taskId,
      updateStage: {
        eventId: implementEventId,
        status: 'COMPLETED',
        output: {
          samples: sampleSummaries,
          selectedSampleId: candidates.length,
        },
        cost: sumStageCost(...roundCosts),
      },
      startStage: {
        stageKey: 'FILTER',
        input: { sampleCount: samplesThisRound },
      },
    });
    const filterEventId = filterStage!.eventId;

    // Close FILTER, open CRITIC.
    const { startedStage: criticStage } = await main.updateTaskActivity({
      taskId: ctx.taskId,
      updateStage: {
        eventId: filterEventId,
        status: 'COMPLETED',
        output: { checks: filterCheckList, baseline },
      },
      startStage: {
        stageKey: 'CRITIC',
        input: { reviewCount: criticReviewList.length },
      },
    });
    const criticEventId = criticStage!.eventId;

    // Trivial auto-approve gate.
    const autoDecision = isAutoApprovable(
      analysis,
      resolution,
      criticReview,
      ctx.config.autoApproveTrivial ? 'true' : undefined
    );
    if (autoDecision.autoApprove) {
      await main.updateTaskActivity({
        taskId: ctx.taskId,
        updateStage: {
          eventId: criticEventId,
          status: 'COMPLETED',
          output: buildAutoApprovedCriticOutput({
            reviews: criticReviewList,
            resolution,
            criticReview,
            filterResult,
          }),
        },
      });
      return buildFinalResolution({
        resolution,
        oracle,
        filterResult,
        autoApproved: true,
      });
    }

    // HITL gate on CRITIC — output carries everything the reviewer needs.
    await main.updateTaskActivity({
      taskId: ctx.taskId,
      updateStage: {
        eventId: criticEventId,
        status: 'AWAITING',
        output: buildHitlCriticOutput({
          reviews: criticReviewList,
          resolution,
          criticReview,
          filterResult,
          oracle,
        }),
      },
    });

    await ctx.reviewGate.resetAndWait();
    const decision = ctx.reviewGate.consume();

    if (decision.action === 'approve') {
      await main.updateTaskActivity({
        taskId: ctx.taskId,
        updateStage: { eventId: criticEventId, status: 'COMPLETED' },
      });
      return buildFinalResolution({
        resolution,
        oracle,
        filterResult,
        autoApproved: false,
      });
    }

    // Rejected — close CRITIC as REJECTED, accumulate memo, loop.
    await main.updateTaskActivity({
      taskId: ctx.taskId,
      updateStage: { eventId: criticEventId, status: 'REJECTED' },
    });
    attemptMemos.push(
      memoFromHitlRejection({
        attemptNum: attemptMemos.length + 1,
        resolution,
        decision,
      })
    );
    reviewerFeedback = decision.feedback;
  }

  throw new Error(
    `Resolution did not converge after ${MAX_REVIEW_ROUNDS} review rounds`
  );
}
