/**
 * Task-queue constants. Kept in a file that has NO runtime dependencies so
 * workflows can import them without dragging `@temporalio/client` (which is
 * disallowed in the Temporal workflow sandbox) into the workflow bundle.
 */

/**
 * Main task queue — carries workflow execution and lightweight activities
 * (DB updates, GitHub API calls). Concurrency is cheap here.
 */
export const TASK_QUEUE = 'codewright-main';

/**
 * Sandbox task queue — carries every activity that touches a Docker
 * container (create/destroy, agent runs, git push). Worker concurrency on
 * this queue is gated by SANDBOX_CONCURRENCY to protect host resources and
 * stay under model-API rate limits. Workflows themselves do NOT run here.
 */
export const SANDBOX_TASK_QUEUE = 'codewright-sandbox-heavy';
