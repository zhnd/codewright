import { type AgentObserver, createObserver } from '@codewright/agent-runtime';
import { prisma } from '@codewright/database';
import {
  AGENT_INVOCATION_STATUS,
  type AgentCost,
  type AgentInvocationStatusValue,
  computeCostUsd,
  findModelPricing,
  generateSpanId,
  type ModelPricing,
  traceIdForTask,
} from '@codewright/domain';
import {
  connectSandbox,
  type Sandbox,
  type SandboxState,
} from '@codewright/sandbox';
import { Context } from '@temporalio/activity';
import { log } from '../logger.js';
import {
  createPrismaMessageSink,
  type PrismaMessageSink,
} from './agent-message-sink.js';
import { configuredAgentModel, resolveModelPricing } from './model-pricing.js';

/**
 * How often the agent activity beats to Temporal. Must be safely below
 * the proxy's `heartbeatTimeout` (currently 60s on sandboxAgent) so a
 * hung tool call is detected promptly.
 */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Standard return shape for every agent-driven activity. The activity
 * ALWAYS returns rather than throwing — even on agent failure — so the
 * workflow can record cost + decide whether to re-throw based on `status`.
 */
export interface AgentActivityResult<T> {
  /** Successful agent output. Absent on the error path. */
  result?: T;
  status: AgentInvocationStatusValue;
  /** Set when status === ERROR; flat-text reason. */
  errorText?: string;
  /** Cost rollup for this run (tokens × price table); written to the
   *  stage's TaskEvent cost columns by the workflow. Null when unknown. */
  cost: AgentCost | null;
}

/**
 * Set up the streaming agent-message-log sink for this run. Message rows
 * are anchored to the STAGE TaskEvent (`taskEventId`) and keyed by the
 * Temporal `activityId` for idempotency. Returns the sink + shared span
 * ids when an activity context + parent TaskEvent exist; an empty object
 * otherwise (unit tests / missing event) so the agent still runs.
 *
 * On a retry (attempt > 1) the prior attempt's message rows are deleted
 * and the run re-streams from seq 0 — agent runs are non-deterministic, so
 * splicing a fresh attempt onto a stale prefix would corrupt the log; a
 * clean rewrite by `activityId` is the only correct shape.
 */
async function setupMessageStream(
  agentName: string,
  taskEventId: string
): Promise<{
  sink?: PrismaMessageSink;
  spanId?: string;
}> {
  let activityId: string;
  let attempt: number;
  try {
    const info = Context.current().info;
    activityId = info.activityId;
    attempt = info.attempt;
  } catch {
    return {}; // No activity context (e.g. unit test) — no streaming.
  }

  const ev = await prisma.taskEvent.findUnique({
    where: { id: taskEventId },
    select: { taskId: true },
  });
  if (!ev) {
    log.warn(
      { taskEventId, agentName },
      'setupMessageStream: TaskEvent not found; skipping live message log'
    );
    return {};
  }

  if (attempt > 1) {
    await prisma.agentMessageLog.deleteMany({ where: { activityId } });
  }

  const sink = createPrismaMessageSink({
    taskId: ev.taskId,
    traceId: await traceIdForTask(ev.taskId),
    taskEventId,
    activityId,
  });
  // `spanId` is this run's invocation span; its parent (the stage span)
  // is reconstructable via taskEventId → TaskEvent.spanId, so no extra
  // parent id needs threading through.
  return { sink, spanId: generateSpanId() };
}

/**
 * Wraps an agent invocation inside a Temporal activity body. Streams the
 * agent message log live and ALWAYS returns a structured result (with `cost`),
 * even on the failure path; the workflow decides whether to re-throw based
 * on `status`.
 */
export async function runAgentInActivity<T>(
  stage: string,
  agentName: string,
  taskEventId: string,
  fn: (observer: AgentObserver) => Promise<T>
): Promise<AgentActivityResult<T>> {
  const { sink, spanId } = await setupMessageStream(agentName, taskEventId);

  // Resolve the price table (DB-backed, remote-populated on miss) for the
  // configured model so the observer computes cost from real prices instead
  // of the in-code fallback. Best-effort: failures inside the resolver are
  // logged there and degrade to the fallback map.
  const pricing = await resolveModelPricing(configuredAgentModel());

  const observer = createObserver(stage, agentName, {
    sink,
    spanId,
    pricing,
  });

  // Periodic heartbeat keeps Temporal aware the activity is alive even when
  // the agent is silent. The tick also forces a sink flush so slow tool
  // calls don't strand already-produced messages, and carries the
  // flushed-seq watermark. DB hiccups must not block the heartbeat.
  const heartbeatTimer = setInterval(() => {
    try {
      Context.current().heartbeat({
        lastFlushedSeq: sink?.highWaterMark() ?? -1,
      });
    } catch {
      // Outside an activity context (e.g. unit test) — silently ignore.
    }
    if (sink) void sink.flush();
  }, HEARTBEAT_INTERVAL_MS);

  try {
    const result = await fn(observer);
    return {
      result,
      status: AGENT_INVOCATION_STATUS.SUCCESS,
      cost: await repriceForObservedModel(observer.collect().cost, pricing),
    };
  } catch (err) {
    const errorText = err instanceof Error ? err.message : String(err);
    observer.recordError(errorText);
    log.warn(
      { agentName, stage, err: errorText },
      'agent activity caught error; returning partial result'
    );
    return {
      status: AGENT_INVOCATION_STATUS.ERROR,
      errorText,
      cost: await repriceForObservedModel(observer.collect().cost, pricing),
    };
  } finally {
    clearInterval(heartbeatTimer);
    if (sink) {
      try {
        await sink.flush();
      } catch {
        // Best-effort live stream; a flush failure just drops the tail.
      }
    }
  }
}

/**
 * Reconcile a run's cost against the model the SDK actually reported.
 *
 * The observer computes cost against the price table we preloaded for the
 * CONFIGURED model (`configuredAgentModel()`). When the SDK reports a
 * different model id that the preloaded table can't price — a gateway/custom
 * model, or a future per-agent `queryOptions.model` override — the observer
 * falls back to the SDK figure (wrong for gateway models) or 0. Here we
 * resolve pricing for the OBSERVED model name and recompute so those runs get
 * a real token-derived cost. Best-effort: `resolveModelPricing` never throws
 * and any miss leaves the cost untouched.
 */
async function repriceForObservedModel(
  cost: AgentCost | null,
  preloaded: Record<string, ModelPricing>
): Promise<AgentCost | null> {
  // Already priceable from the preloaded table (incl. dated/variant prefix
  // matches) — the observer's figure is correct; nothing to do.
  if (!cost || findModelPricing(cost.model, preloaded)) return cost;

  const table = await resolveModelPricing(cost.model);
  const usd = computeCostUsd(
    cost.model,
    cost.inputTokens,
    cost.outputTokens,
    table
  );
  return usd == null ? cost : { ...cost, totalCostUsd: usd };
}

/**
 * Like {@link runAgentInActivity} but connects the sandbox INSIDE the
 * guarded body, so a connection failure becomes a structured ERROR result
 * with a real reason instead of a bare throw.
 */
export async function runSandboxAgentInActivity<T>(
  state: SandboxState,
  stage: string,
  agentName: string,
  taskEventId: string,
  fn: (sandbox: Sandbox, observer: AgentObserver) => Promise<T>
): Promise<AgentActivityResult<T>> {
  return runAgentInActivity(stage, agentName, taskEventId, async (observer) => {
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
