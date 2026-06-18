import type { AgentObserver } from '@codewright/agent-runtime';
import {
  createSandboxMcpServer,
  runAgent,
  SANDBOX_READ_TOOLS,
  sandboxOnlyToolConfig,
} from '@codewright/agent-runtime';
import { type AnalysisResult, analysisResultSchema } from '@codewright/domain';
import type { Sandbox } from '@codewright/sandbox';
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
