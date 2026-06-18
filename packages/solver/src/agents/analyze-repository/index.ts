import type { AgentObserver } from '@torin/agent-runtime';
import {
  createSandboxMcpServer,
  runAgent,
  SANDBOX_READ_TOOLS,
  sandboxOnlyToolConfig,
} from '@torin/agent-runtime';
import { type AnalysisResult, analysisResultSchema } from '@torin/domain';
import type { Sandbox } from '@torin/sandbox';
import { ANALYZE_SYSTEM_PROMPT, ANALYZE_USER_PROMPT } from './prompts.js';

export async function analyzeRepository(
  sandbox: Sandbox,
  observer?: AgentObserver
): Promise<AnalysisResult> {
  const { result } = await runAgent<AnalysisResult>({
    agentName: 'analyzeRepository',
    stage: 'analysis',
    systemPrompt: ANALYZE_SYSTEM_PROMPT,
    userPrompt: ANALYZE_USER_PROMPT,
    schema: analysisResultSchema,
    queryOptions: {
      mcpServers: { sandbox: createSandboxMcpServer(sandbox) },
      ...sandboxOnlyToolConfig(SANDBOX_READ_TOOLS),
      maxTurns: 20,
    },
    observer,
  });
  return result;
}
