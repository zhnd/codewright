import type { AgentObserver } from '@codewright/agent-runtime';
import {
  createSandboxMcpServer,
  runAgent,
  SANDBOX_READ_TOOLS,
  sandboxOnlyToolConfig,
} from '@codewright/agent-runtime';
import {
  type AnalysisResult,
  type DefectAnalysis,
  type DefectIntent,
  defectAnalysisSchema,
} from '@codewright/domain';
import type { Sandbox } from '@codewright/sandbox';
import {
  ANALYZE_DEFECT_SYSTEM_PROMPT,
  buildAnalyzeDefectUserPrompt,
} from './prompts.js';

/**
 * Sandbox read-only defect analysis. Consumes a pre-extracted
 * DefectIntent (from the upstream triage step) as its first-turn
 * agenda and, when available, a Repo Navigation Map (from a prior
 * analyze-repository pass) as a prompt prefix hint.
 *
 * Both `intent` and `repoNavigation` are optional so the agent can run
 * in legacy mode (no upstream artifacts) without crashing — but the
 * prompt is far more effective when both are supplied.
 *
 * Output schema is the same DefectAnalysis as before, plus optional
 * `candidateRootCauses` / `consideredStrategies` arrays the agent
 * fills when more than one alternative is worth surfacing. The
 * top-level rootCause / scopeDeclaration are still the canonical
 * fields downstream phases consume.
 */
export async function analyzeDefect(
  sandbox: Sandbox,
  defectDescription: string,
  intent: DefectIntent | undefined,
  repoNavigation: AnalysisResult | undefined,
  feedback?: string,
  observer?: AgentObserver
): Promise<DefectAnalysis> {
  const { result } = await runAgent<DefectAnalysis>({
    agentName: 'analyzeDefect',
    stage: 'analysis',
    systemPrompt: ANALYZE_DEFECT_SYSTEM_PROMPT,
    userPrompt: buildAnalyzeDefectUserPrompt(
      defectDescription,
      intent,
      repoNavigation,
      feedback
    ),
    schema: defectAnalysisSchema,
    queryOptions: {
      mcpServers: { sandbox: createSandboxMcpServer(sandbox) },
      ...sandboxOnlyToolConfig(SANDBOX_READ_TOOLS),
      maxTurns: 20,
    },
    observer,
  });
  return result;
}
