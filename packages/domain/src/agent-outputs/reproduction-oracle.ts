import { z } from 'zod/v4';

/**
 * Oracle produced by the REPRODUCE phase. `mode` selects how FILTER runs it.
 *   test-framework — a proper test in the project's existing framework
 *   verify-script  — a standalone executable at .codewright/verify.<ext>
 *   boot-verify    — web: start dev server, watch for clean boot + no errors
 *   none           — no oracle could be produced; HITL is the only validator
 */
export const oracleModeSchema = z.enum([
  'test-framework',
  'verify-script',
  'boot-verify',
  'none',
]);
export type OracleMode = z.infer<typeof oracleModeSchema>;

/**
 * Output of the reproduce-defect agent. Boundary schema — do not add
 * fields here without also updating the agent's prompt.
 */
export const reproductionOracleSchema = z.object({
  mode: oracleModeSchema,
  /** Command that FILTER should run. Empty for mode 'none'. */
  runCommand: z.string(),
  /** Path of the file that was written (test / verify script). */
  filePath: z.string().optional(),
  /** Full content of what was written, for PR body display. */
  content: z.string().optional(),
  /** Test framework name when mode is 'test-framework'. */
  framework: z.string().optional(),
  /** True when the agent actually observed the oracle fail on HEAD. */
  confirmedFailing: z.boolean(),
  /** Free-text reason when mode is 'none'. */
  skipReason: z.string().optional(),
});

export type ReproductionOracle = z.infer<typeof reproductionOracleSchema>;
