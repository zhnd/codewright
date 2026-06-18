import { type AgentObserver, createObserver } from '@codewright/agent-runtime';
import {
  AGENT_INVOCATION_STATUS,
  type AgentInvocationStatusValue,
  type AgentInvocationTrace,
  type AgentObservation,
} from '@codewright/domain';
import {
  connectSandbox,
  type Sandbox,
  type SandboxState,
} from '@codewright/sandbox';
import { Context } from '@temporalio/activity';
import { log } from '../logger.js';

/**
 * How often the agent activity beats to Temporal. Must be safely below
 * the proxy's `heartbeatTimeout` (currently 60s on sandboxAgent) so a
 * hung tool call is detected promptly.
 */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Standard return shape for every agent-driven activity (decision A1
 * in the plan). The activity ALWAYS returns rather than throwing —
 * even on agent failure — so the workflow can persist the partial
 * trace before deciding whether to re-throw.
 */
export interface AgentActivityResult<T> {
  /** Successful agent output. Absent on the error path. */
  result?: T;
  /** Legacy event/cost view, fed to existing logging paths. */
  observation: AgentObservation;
  /** Per-turn / per-tool trace for the new persistence path. */
  capturedTrace: AgentInvocationTrace;
  status: AgentInvocationStatusValue;
  /** Set when status === ERROR; flat-text reason. */
  errorText?: string;
}

/**
 * Wraps an agent invocation inside a Temporal activity body. Creates the
 * observer, runs the agent function, and ALWAYS returns a structured
 * result — including the partial trace on the failure path. The
 * workflow decides whether to re-throw based on `status`.
 *
 * Trade-off: Temporal-level activity retry no longer fires for agent
 * crashes (the activity never throws). Workflow-level retry semantics
 * apply instead. This is intentional for Phase 1 — we want one trace
 * row per agent attempt, not lost runs.
 */
export async function runAgentInActivity<T>(
  stage: string,
  agentName: string,
  fn: (observer: AgentObserver) => Promise<T>
): Promise<AgentActivityResult<T>> {
  const observer = createObserver(stage, agentName);

  // Periodic heartbeat keeps Temporal aware that this activity is alive
  // even when the agent is silent (e.g., waiting on a slow tool call).
  // The proxy sets heartbeatTimeout: 60s; firing every 30s gives 2x
  // margin before Temporal would consider us dead and reschedule.
  const heartbeatTimer = setInterval(() => {
    try {
      Context.current().heartbeat();
    } catch {
      // Outside an activity context (e.g. unit test) — silently ignore.
    }
  }, HEARTBEAT_INTERVAL_MS);

  try {
    const result = await fn(observer);
    return {
      result,
      observation: observer.collect(),
      capturedTrace: observer.collectTrace(),
      status: AGENT_INVOCATION_STATUS.SUCCESS,
    };
  } catch (err) {
    const errorText = err instanceof Error ? err.message : String(err);
    observer.recordError(errorText);
    log.warn(
      { agentName, stage, err: errorText },
      'agent activity caught error; returning partial trace'
    );
    return {
      observation: observer.collect(),
      capturedTrace: observer.collectTrace(),
      status: AGENT_INVOCATION_STATUS.ERROR,
      errorText,
    };
  } finally {
    clearInterval(heartbeatTimer);
  }
}

/**
 * Like {@link runAgentInActivity} but connects the sandbox INSIDE the
 * guarded body, so a connection failure (container gone, daemon down,
 * lost between stages) becomes a structured ERROR result with a real
 * reason — persisted as one invocation trace — instead of a bare throw
 * that surfaces only as Temporal's opaque "Activity task failed" and
 * leaves zero diagnostics in the DB.
 */
export async function runSandboxAgentInActivity<T>(
  state: SandboxState,
  stage: string,
  agentName: string,
  fn: (sandbox: Sandbox, observer: AgentObserver) => Promise<T>
): Promise<AgentActivityResult<T>> {
  return runAgentInActivity(stage, agentName, async (observer) => {
    let sandbox: Sandbox;
    try {
      sandbox = await connectSandbox(state);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`${agentName}: failed to connect sandbox: ${reason}`);
    }
    return fn(sandbox, observer);
  });
}
