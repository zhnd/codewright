import type { ZodType } from 'zod/v4';

/**
 * Extract the first JSON object from an agent reply and validate it
 * against the given zod schema.
 *
 * Prompts instruct agents to return JSON-only, but reality: they
 * sometimes wrap it in ```json fences, add a leading "Here is the
 * result:", or include trailing prose. This helper:
 *
 *   1. Finds the first `{...}` block by regex.
 *   2. `JSON.parse` it (throws with raw context on failure).
 *   3. Validates shape against the zod schema (throws with the
 *      zod issue list on failure).
 *
 * Using the schema (vs. `as T`) gives us runtime type safety —
 * an agent that omits a required field or returns the wrong enum
 * value fails here with a clear message, instead of crashing two
 * stages later when the workflow tries to read `result.rootCause`.
 */
export function parseAgentJson<T>(raw: string, schema: ZodType<T>): T {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(
      `Agent did not return JSON. Raw output (truncated): ${raw.slice(0, 500)}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Invalid JSON from agent: ${msg}\nRaw (truncated): ${match[0].slice(0, 500)}`
    );
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Agent output failed schema validation:\n${formatZodError(result.error.issues)}\nRaw (truncated): ${match[0].slice(0, 500)}`
    );
  }
  return result.data;
}

interface ZodIssueLike {
  path: readonly PropertyKey[];
  message: string;
}

function formatZodError(issues: readonly ZodIssueLike[]): string {
  return issues
    .map((issue) => {
      const path =
        issue.path.length > 0
          ? issue.path.map((p) => String(p)).join('.')
          : '<root>';
      return `  - ${path}: ${issue.message}`;
    })
    .join('\n');
}
