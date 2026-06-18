import type { AgentObserver } from '@codewright/agent-runtime';
import {
  createSandboxMcpServer,
  runAgent,
  SANDBOX_READ_TOOLS,
  sandboxOnlyToolConfig,
} from '@codewright/agent-runtime';
import {
  type CriticReview,
  criticReviewSchema,
  type DefectAnalysis,
  type ReproductionOracle,
  type ResolutionResult,
} from '@codewright/domain';
import type { Sandbox } from '@codewright/sandbox';
import {
  buildCriticUserPrompt,
  CRITIC_RESOLUTION_SYSTEM_PROMPT,
} from './prompts.js';

export async function criticResolution(
  sandbox: Sandbox,
  defectDescription: string,
  analysis: DefectAnalysis,
  oracle: ReproductionOracle | null,
  resolution: ResolutionResult,
  observer?: AgentObserver
): Promise<CriticReview> {
  const { result } = await runAgent<CriticReview>({
    agentName: 'criticResolution',
    stage: 'critic',
    systemPrompt: CRITIC_RESOLUTION_SYSTEM_PROMPT,
    userPrompt: buildCriticUserPrompt(
      defectDescription,
      analysis,
      oracle,
      resolution
    ),
    schema: criticReviewSchema,
    queryOptions: {
      mcpServers: { sandbox: createSandboxMcpServer(sandbox) },
      ...sandboxOnlyToolConfig(SANDBOX_READ_TOOLS),
      maxTurns: 15,
    },
    observer,
  });

  // Enforce invariants: out-of-scope or any blocking concern forces reject.
  const hasBlocking = result.concerns.some((c) => c.severity === 'blocking');
  if (result.scopeAssessment === 'out-of-scope' || hasBlocking) {
    return { ...result, approve: false };
  }
  return result;
}
