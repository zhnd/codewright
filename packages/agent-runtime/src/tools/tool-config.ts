import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';

/**
 * MCP tools exposed by the sandbox server. Agents never see other tool
 * namespaces — the built-in SDK Bash/Read/Grep/Glob/Write/Edit read the
 * host filesystem instead of the sandbox and must be actively blocked.
 */
export const SANDBOX_READ_TOOLS = [
  'mcp__sandbox__bash',
  'mcp__sandbox__read_file',
  'mcp__sandbox__list_files',
] as const;

export const SANDBOX_WRITE_TOOLS = [
  ...SANDBOX_READ_TOOLS,
  'mcp__sandbox__write_file',
] as const;

/**
 * Build the tool-permission block for a Claude Agent SDK `query()` call.
 * Produces `{ allowedTools, canUseTool }` where `canUseTool` is the
 * programmatic gate that actually enforces the whitelist — `allowedTools`
 * alone is not a hard restriction when permissions are bypassed.
 *
 * Spread into the `queryOptions` of `runAgent`:
 *
 *   queryOptions: {
 *     mcpServers: { sandbox: ... },
 *     ...sandboxOnlyToolConfig(SANDBOX_READ_TOOLS),
 *     maxTurns: 20,
 *   }
 */
export function sandboxOnlyToolConfig(tools: readonly string[]): {
  allowedTools: string[];
  canUseTool: CanUseTool;
} {
  const allowed = [...tools];
  const allowedSet = new Set(allowed);
  return {
    allowedTools: allowed,
    canUseTool: async (toolName, input) => {
      if (allowedSet.has(toolName)) {
        return { behavior: 'allow', updatedInput: input };
      }
      return {
        behavior: 'deny',
        message: `Tool '${toolName}' is not available in this agent. Only sandbox MCP tools are allowed: ${allowed.join(', ')}.`,
      };
    },
  };
}
