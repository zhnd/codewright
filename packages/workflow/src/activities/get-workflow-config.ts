/**
 * Reads workflow-level feature flags from the worker's environment.
 * This lives as an activity because the workflow runs in a Temporal
 * sandbox with no access to `process.env`; activities run in the
 * worker's normal Node process and can read env freely.
 *
 * Add new flags here rather than scattering env reads across multiple
 * activities — one well-known call site keeps the flag surface audit-
 * able and the workflow gets one canonical snapshot per run.
 */

export interface WorkflowConfig {
  /** CODEWRIGHT_AUTO_APPROVE_TRIVIAL=true bypasses HITL for trivial diffs. */
  autoApproveTrivial: boolean;
}

export async function getWorkflowConfigActivity(): Promise<WorkflowConfig> {
  return {
    autoApproveTrivial:
      (process.env.CODEWRIGHT_AUTO_APPROVE_TRIVIAL ?? '').toLowerCase() ===
      'true',
  };
}
