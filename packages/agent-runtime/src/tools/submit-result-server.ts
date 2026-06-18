import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { ZodType } from 'zod/v4';

/**
 * One-tool MCP server that captures structured output from an agent.
 *
 * The zod schema is converted to a JSON Schema tool definition. The
 * LLM "calls" the tool with its result; the SDK validates the input.
 * If validation fails, the error is returned as `isError: true` and
 * the agent retries in the same turn loop — no external wrapper.
 *
 * Constraints:
 * - Only the FIRST successful submission is accepted. Repeat calls
 *   after a successful submission return `isError: true`.
 * - `schema` MUST be a `z.object(...)`. Non-object schemas are
 *   wrapped in `{ result: schema }` as a fallback, but this is not
 *   the intended long-term path — prefer restructuring the schema.
 */
export function createSubmitResultServer<T>(
  agentName: string,
  schema: ZodType<T>
) {
  let captured: T | null = null;
  let submitted = false;

  const { shape, isWrapped } = extractObjectShape(schema);

  const submitTool = tool(
    'submit_result',
    `Submit your structured ${agentName} result. Call exactly once when finished. If validation fails you will see the error — fix and retry.`,
    shape as Record<string, ZodType<unknown>>,
    async (input: Record<string, unknown>) => {
      if (submitted) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Already submitted. Do not call again.',
            },
          ],
          isError: true,
        };
      }

      const value = isWrapped ? input.result : input;
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Validation failed:\n${parsed.error.message}\n\nFix and call submit_result again.`,
            },
          ],
          isError: true,
        };
      }

      captured = parsed.data;
      submitted = true;
      return {
        content: [{ type: 'text' as const, text: 'OK' }],
      };
    }
  );

  const server = createSdkMcpServer({
    name: 'output',
    version: '1.0.0',
    tools: [submitTool],
  });

  return {
    server,
    getResult: (): T | null => captured,
    toolName: 'mcp__output__submit_result',
  };
}

/**
 * Extract the shape object from a zod schema for the `tool()` helper.
 *
 * Uses `z.object(schema.shape)` round-trip as a stable probe: if
 * `schema.shape` exists and is a plain object with zod-type values,
 * it's a z.object. No private `_zod.def` access.
 *
 * Fallback: wrap the whole schema in `{ result: schema }`.
 */
function extractObjectShape(schema: ZodType<unknown>): {
  shape: Record<string, unknown>;
  isWrapped: boolean;
} {
  try {
    // z.object in zod v4 exposes `.shape` as a public getter
    const candidate = (schema as { shape?: unknown }).shape;
    if (
      candidate &&
      typeof candidate === 'object' &&
      !Array.isArray(candidate) &&
      Object.keys(candidate).length > 0
    ) {
      // Verify at least one value looks like a zod type (has `parse`)
      const first = Object.values(candidate)[0];
      if (first && typeof first === 'object' && 'parse' in first) {
        return {
          shape: candidate as Record<string, unknown>,
          isWrapped: false,
        };
      }
    }
  } catch {
    // .shape access failed — not a z.object
  }

  // Fallback: wrap
  return {
    shape: { result: schema as unknown },
    isWrapped: true,
  };
}
