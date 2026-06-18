/**
 * Execution-grounded verdict for a candidate patch, derived from the
 * automated checks run in the sandbox (the FILTER stage).
 *
 * This is the signal the Selector ranks by. Research consensus
 * (Agentless / SWE-bench) is that **test execution — not an LLM judge —
 * should decide which patch wins**: judge/consensus selection suffers
 * correlated errors, while FAIL_TO_PASS + PASS_TO_PASS is ground truth.
 *
 * `null` means the check was not applicable (no reproduction oracle, or
 * the repo has no test infra) — deliberately distinct from `false`
 * ("ran and failed").
 */
export interface TestVerdict {
  /** Reproduction oracle (FAIL_TO_PASS): did the fix make the bug repro pass? */
  failToPassPassed: boolean | null;
  /** Regression suite (PASS_TO_PASS): does the existing suite still pass? */
  regressionPassed: boolean | null;
  /** Build / typecheck passed. */
  buildPassed: boolean | null;
  /** Lint passed — a soft signal, NOT a correctness gate. */
  lintPassed: boolean | null;
  /** Web boot verification passed — a soft signal, NOT a correctness gate. */
  bootPassed: boolean | null;
  /** Declared file scope respected — a hard safety gate. */
  scopeClean: boolean;
  /**
   * True when at least one execution-based correctness signal (oracle or
   * regression) was actually runnable. When false, the repo is
   * test-sparse and selection must fall back to critic/build signals.
   */
  hasExecutableSignal: boolean;
  /**
   * Correctness eligibility: scope clean AND every runnable correctness
   * gate (oracle, regression, build) passed. Lint/boot are excluded —
   * they are ranking signals, not gates.
   */
  executionEligible: boolean;
  /** Count of passed correctness checks (oracle + regression + build) — the primary rank key. */
  correctnessScore: number;
}
