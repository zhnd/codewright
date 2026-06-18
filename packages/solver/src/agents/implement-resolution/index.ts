import type { AgentObserver } from '@codewright/agent-runtime';
import {
  createSandboxMcpServer,
  runAgent,
  SANDBOX_WRITE_TOOLS,
  sandboxOnlyToolConfig,
} from '@codewright/agent-runtime';
import {
  type DefectAnalysis,
  type ReproductionOracle,
  type ResolutionResult,
  resolutionResultSchema,
} from '@codewright/domain';
import type { Sandbox } from '@codewright/sandbox';
import {
  buildImplementResolutionUserPrompt,
  IMPLEMENT_RESOLUTION_SYSTEM_PROMPT,
} from './prompts.js';

export async function implementResolution(
  sandbox: Sandbox,
  defectDescription: string,
  analysis: DefectAnalysis,
  oracle: ReproductionOracle | null,
  userFeedback?: string,
  observer?: AgentObserver
): Promise<ResolutionResult> {
  const { result } = await runAgent<ResolutionResult>({
    agentName: 'implementResolution',
    stage: 'implement',
    systemPrompt: IMPLEMENT_RESOLUTION_SYSTEM_PROMPT,
    userPrompt: buildImplementResolutionUserPrompt(
      defectDescription,
      analysis,
      oracle,
      userFeedback
    ),
    schema: resolutionResultSchema,
    queryOptions: {
      mcpServers: { sandbox: createSandboxMcpServer(sandbox) },
      ...sandboxOnlyToolConfig(SANDBOX_WRITE_TOOLS),
      maxTurns: 40,
    },
    observer,
  });
  return result;
}
