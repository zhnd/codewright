import { TOOL_OUTPUT_CAP_BYTES, truncateToBytes } from '@codewright/domain';

// Pure SDK-message parsing helpers used by the observer. No state — they
// turn raw SDK message fields into the neutral shapes the observer emits.

/**
 * Build a human-readable reason from an SDK error `result` message: the
 * terminal subtype (error_max_turns / error_max_budget_usd / …), the
 * terminal_reason, the SDK's own error strings, and a summary of any
 * permission denials (so "stuck on human approval" is visible).
 */
export function describeResultError(result: {
  subtype?: string;
  terminal_reason?: string;
  errors?: string[];
  permission_denials?: Array<{ tool_name?: string }>;
}): string {
  const parts: string[] = [];
  if (result.subtype) parts.push(result.subtype);
  if (result.terminal_reason) {
    parts.push(`terminal_reason=${result.terminal_reason}`);
  }
  if (result.errors?.length) parts.push(result.errors.join('; '));
  const denials = result.permission_denials ?? [];
  if (denials.length) {
    const tools = [...new Set(denials.map((d) => d.tool_name).filter(Boolean))];
    parts.push(`permission denied: ${tools.join(', ')} (${denials.length})`);
  }
  return parts.join(' · ').slice(0, 500) || 'Agent error';
}

export function summarizeToolInput(
  toolName: string,
  input: unknown
): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const inp = input as Record<string, unknown>;
  if (toolName.includes('bash') && typeof inp.command === 'string') {
    return inp.command.slice(0, 200);
  }
  if (typeof inp.path === 'string') {
    return inp.path;
  }
  return undefined;
}

/**
 * Capture a tool's input as a structured payload, trimmed to the output
 * cap (serialized size). Returns the value unchanged when small; otherwise
 * the JSON-stringified+truncated form plus the original byte size.
 */
export function truncateInput(input: unknown): {
  value: unknown;
  truncatedAt: number | null;
} {
  if (input == null) return { value: null, truncatedAt: null };
  const json = JSON.stringify(input);
  if (json === undefined) return { value: null, truncatedAt: null };
  const { text, truncatedAt } = truncateToBytes(json, TOOL_OUTPUT_CAP_BYTES);
  if (truncatedAt == null) return { value: input, truncatedAt: null };
  return { value: text, truncatedAt };
}

/**
 * Normalize a tool_result `content` field (string | block[] | object) into
 * a plain string for storage/display.
 */
export function stringifyToolResult(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        const block = b as { type?: string; text?: string };
        if (block.type === 'text' && typeof block.text === 'string') {
          return block.text;
        }
        return JSON.stringify(b);
      })
      .join('\n');
  }
  return JSON.stringify(content);
}
