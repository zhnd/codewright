import type { AgentObserver } from '@torin/agent-runtime';
import {
  createSandboxMcpServer,
  runAgent,
  SANDBOX_WRITE_TOOLS,
  sandboxOnlyToolConfig,
} from '@torin/agent-runtime';
import {
  type DefectAnalysis,
  type ReproductionOracle,
  reproductionOracleSchema,
} from '@torin/domain';
import type { Sandbox } from '@torin/sandbox';
import { log } from '../../logger.js';
import {
  buildReproduceUserPrompt,
  REPRODUCE_SCRIPT_SYSTEM_PROMPT,
  REPRODUCE_TEST_SYSTEM_PROMPT,
  REPRODUCE_WEB_SYSTEM_PROMPT,
} from './prompts.js';

/**
 * Generate a reproduction oracle for the defect. The system prompt is
 * chosen by the analysis signals — test framework, web UI, or neither.
 * On success, the agent has already verified the oracle fails on HEAD.
 */
export async function reproduceDefect(
  sandbox: Sandbox,
  analysis: DefectAnalysis,
  observer?: AgentObserver
): Promise<ReproductionOracle> {
  const systemPrompt = pickSystemPrompt(analysis);
  if (!systemPrompt) {
    return {
      mode: 'none',
      runCommand: '',
      confirmedFailing: false,
      skipReason:
        'No test infra detected and project has no obvious way to reproduce programmatically.',
    };
  }

  log.info(
    {
      mode: systemPrompt.label,
      hasTestInfra: analysis.hasTestInfra,
      hasWebUI: analysis.hasWebUI,
    },
    'Reproduce mode chosen'
  );

  const { result } = await runAgent<ReproductionOracle>({
    agentName: 'reproduceDefect',
    stage: 'reproduce',
    systemPrompt: systemPrompt.text,
    userPrompt: buildReproduceUserPrompt(analysis),
    schema: reproductionOracleSchema,
    queryOptions: {
      mcpServers: { sandbox: createSandboxMcpServer(sandbox) },
      ...sandboxOnlyToolConfig(SANDBOX_WRITE_TOOLS),
      maxTurns: 20,
    },
    observer,
  });
  return result;
}

function pickSystemPrompt(
  analysis: DefectAnalysis
): { label: string; text: string } | null {
  if (analysis.hasWebUI && analysis.hasTestInfra) {
    return { label: 'web+test', text: REPRODUCE_WEB_SYSTEM_PROMPT };
  }
  if (analysis.hasTestInfra) {
    return { label: 'test-framework', text: REPRODUCE_TEST_SYSTEM_PROMPT };
  }
  if (analysis.hasWebUI) {
    return { label: 'web', text: REPRODUCE_WEB_SYSTEM_PROMPT };
  }
  return { label: 'verify-script', text: REPRODUCE_SCRIPT_SYSTEM_PROMPT };
}
