import { z } from 'zod/v4';
import { defectIntentSchema } from './defect-intent';

/**
 * Risk class drives HITL policy:
 *   trivial — docs/comments/i18n/strings only; potentially auto-approvable
 *   low     — isolated single-point change
 *   medium  — cross-file logic change
 *   high    — touches core module / data model / auth / public API
 */
export const riskClassSchema = z.enum(['trivial', 'low', 'medium', 'high']);
export type RiskClass = z.infer<typeof riskClassSchema>;

/**
 * Front-end framework detected in the repo. Drives preview/boot-verify logic.
 */
export const webFrameworkSchema = z.enum([
  'next',
  'vite',
  'astro',
  'remix',
  'vue',
  'svelte',
  'other',
]);
export type WebFramework = z.infer<typeof webFrameworkSchema>;

export const investigationStepSchema = z.object({
  file: z.string(),
  finding: z.string(),
});
export type InvestigationStep = z.infer<typeof investigationStepSchema>;

export const evidenceSchema = z.object({
  file: z.string(),
  lines: z.string(),
  code: z.string(),
  explanation: z.string(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

/**
 * One of the top-N ranked candidate root causes the analyze agent
 * surfaced. Surfaces what the agent considered so the HITL reviewer
 * (and future Best-of-N implement) can see the alternatives, not just
 * the winner. The strongest candidate's `rootCause` string is also
 * mirrored to the top-level `DefectAnalysis.rootCause` for downstream
 * code that doesn't yet read this array.
 */
export const candidateRootCauseSchema = z.object({
  rootCause: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  evidence: z.array(evidenceSchema),
});
export type CandidateRootCause = z.infer<typeof candidateRootCauseSchema>;

/**
 * One fix strategy enumerated by the analyze agent. Encourages
 * Verbalized-Sampling-style diversity (qualitatively different
 * approaches, e.g. fix-at-site vs guard-upstream vs fallback-downstream)
 * to avoid mode collapse. Exactly one entry should have
 * `recommendation = 'recommended'`; the workflow drives implement from
 * that one. Others remain available as fallbacks for future REx-style
 * arm-switching after implement failures.
 */
export const consideredStrategySchema = z.object({
  approach: z.string(),
  scopeFiles: z.array(z.string()),
  tradeoffs: z.string(),
  riskClass: riskClassSchema,
  recommendation: z.enum(['recommended', 'viable', 'rejected']),
  expectedFailureMode: z.string().optional(),
});
export type ConsideredStrategy = z.infer<typeof consideredStrategySchema>;

/**
 * Output of the analyze-defect agent. Boundary schema — do not add
 * fields here without also updating the agent's prompt.
 */
export const defectAnalysisSchema = z.object({
  rootCause: z.string(),
  affectedFiles: z.array(z.string()),
  proposedApproach: z.string(),
  relevantContext: z.string(),
  testStrategy: z.string(),
  investigation: z.array(investigationStepSchema),
  evidence: z.array(evidenceSchema),
  confidence: z.enum(['high', 'medium', 'low']),
  riskAssessment: z.string(),
  alternatives: z.array(z.string()).optional(),

  // Environment / project signals that shape downstream phases.
  hasTestInfra: z.boolean(),
  testFrameworks: z.array(z.string()),
  hasWebUI: z.boolean(),
  webFramework: webFrameworkSchema.optional(),
  devServerCommand: z.string().optional(),

  // Policy + enforcement signals.
  riskClass: riskClassSchema,
  /** Canonical list of files allowed to change. Workflow enforces this. */
  scopeDeclaration: z.array(z.string()),
  expectedDiffSize: z.enum(['small', 'medium', 'large']),

  /**
   * When automated verification is impossible (no tests, no verify script
   * feasible), surface explicit steps for the human reviewer to check.
   */
  verificationSteps: z.array(z.string()).optional(),

  // ── R2 additions ──────────────────────────────────────────────
  // Optional so the schema is backward-compatible with persisted
  // analyses from before this change; new analyses produced by the
  // upgraded prompt populate them.

  /**
   * Structured intent extracted in the upstream triage step, attached
   * here so consumers (HITL UI, PR body, future Best-of-N) see the
   * full reasoning chain in one document.
   */
  intent: defectIntentSchema.optional(),
  /**
   * How the observed behavior is ACTUALLY produced at runtime — the concrete
   * execution path / construct, grounded in code the agent READ (cite
   * file:line). Domain-agnostic: which function / handler / component / query /
   * config actually runs for this case, and through what mechanism. Examples
   * across domains:
   *   - frontend: "preview videos render via `<iframe>`, not a `<video>`"
   *   - backend:  "the request is handled by middleware X before the named view"
   *   - general:  "of `parseA`/`parseB`/`parseC`, only `parseB` is on this path";
   *               "behavior is driven by feature-flag Y, not the obvious code path"
   * The single highest-value field for catching a WRONG-MECHANISM localization
   * (fixing plausibly-named code that isn't what actually runs) at the analysis
   * HITL gate, before any fix. A NAME match is not proof — the claim must rest
   * on code actually read. Optional for backward-compat.
   */
  mechanism: z.string().optional(),
  /**
   * Claims the analysis DEPENDS ON but did NOT verify by reading code —
   * separated out so they are not mistaken for established fact. Forces the
   * agent to calibrate: distinguish what it actually read from what it is
   * inferring. Typical contents: behavior of code outside this repo (a
   * third-party package, a URL/page loaded at runtime, generated artifacts),
   * or "this is probably the code that runs" when the path could not be
   * traced. The HITL reviewer should scrutinize these rather than trust them;
   * a confident rootCause built on an unstated assumption is exactly how a
   * wrong analysis looks right. Empty/omitted = everything stated is backed
   * by code the agent read. Optional for backward-compat.
   */
  assumptions: z.array(z.string()).optional(),
  /** 1-3 ranked candidate root causes; the strongest is mirrored to `rootCause`. */
  candidateRootCauses: z.array(candidateRootCauseSchema).optional(),
  /** 1-3 distinct fix strategies; one marked 'recommended' drives implement. */
  consideredStrategies: z.array(consideredStrategySchema).optional(),
});

export type DefectAnalysis = z.infer<typeof defectAnalysisSchema>;
