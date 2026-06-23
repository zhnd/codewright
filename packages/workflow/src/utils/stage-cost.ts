import type { AgentCost } from '@codewright/domain';

/**
 * Roll up one or more agent-run costs into the `updateStage.cost` shape
 * written onto the stage's TaskEvent. Returns `undefined` when no cost is
 * known (so the stage columns stay null). Used by phases that run multiple
 * agents in one stage (e.g. analyze = triage + analyze).
 *
 * Pure + dependency-free (type-only import) so it is safe to call from
 * workflow code — it must NOT pull in prisma / activity context, which
 * would break the Temporal workflow bundle.
 */
export function sumStageCost(...costs: (AgentCost | null | undefined)[]):
  | {
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      model: string | null;
    }
  | undefined {
  const present = costs.filter((c): c is AgentCost => c != null);
  if (present.length === 0) return undefined;
  return {
    costUsd: present.reduce((s, c) => s + (c.totalCostUsd ?? 0), 0),
    inputTokens: present.reduce((s, c) => s + (c.inputTokens ?? 0), 0),
    outputTokens: present.reduce((s, c) => s + (c.outputTokens ?? 0), 0),
    model: present.find((c) => c.model && c.model !== 'unknown')?.model ?? null,
  };
}
