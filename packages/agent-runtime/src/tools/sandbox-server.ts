import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { Sandbox } from '@torin/sandbox';
import { z } from 'zod/v4';

/**
 * Build the MCP server that exposes sandbox operations to a query(). The
 * server name is `sandbox`, so tools are addressable from prompts as
 * `mcp__sandbox__bash`, `mcp__sandbox__read_file`, etc.
 *
 * Each tool descriptor is explicit about the container-vs-host distinction
 * to prevent the model from accidentally using host paths.
 */
export function createSandboxMcpServer(sandbox: Sandbox) {
  const bash = tool(
    'bash',
    'Execute a shell command inside the sandbox container. The working directory is ALREADY the repository root — do NOT prepend `cd /Users/...` or any other host path; those paths do not exist in the sandbox. Just run commands directly (e.g. `npm test`, `git status`). Use the optional `cwd` parameter only to run in a subdirectory of the repo.',
    {
      command: z.string().describe('The shell command to execute'),
      cwd: z
        .string()
        .optional()
        .describe(
          'Optional subdirectory of the repo. Leave unset to run at repo root (most common).'
        ),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Optional command timeout in milliseconds (default 60000).'),
    },
    async (args) => {
      const result = await sandbox.exec(args.command, {
        cwd: args.cwd,
        timeoutMs: args.timeoutMs,
      });
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
      const trailer = result.truncated
        ? '\n\n[output truncated]'
        : result.exitCode === null
          ? `\n\n[no exit code — ${result.stderr ? 'see stderr' : 'process did not complete'}]`
          : '';
      return {
        content: [
          {
            type: 'text' as const,
            text: (output || '(no output)') + trailer,
          },
        ],
        isError: !result.success,
      };
    }
  );

  const readFile = tool(
    'read_file',
    'Read a file from the sandboxed repository. Paths are relative to the repo root (e.g. `src/cart.js`). Do not pass absolute host paths.',
    {
      path: z.string().describe('File path relative to the repository root'),
    },
    async (args) => {
      const content = await sandbox.readFile(args.path);
      return {
        content: [{ type: 'text' as const, text: content }],
      };
    }
  );

  const listFiles = tool(
    'list_files',
    'List files under a directory in the sandboxed repo (up to 3 levels deep). Paths are relative to the repo root. Use "." for root. Do not pass host paths.',
    {
      path: z
        .string()
        .describe('Directory path relative to repo root. Use "." for root.'),
    },
    async (args) => {
      const result = await sandbox.exec(
        `find ${shellArg(args.path)} -maxdepth 3 -type f`,
        { timeoutMs: 15_000 }
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: result.stdout.trim() || '(no files)',
          },
        ],
        isError: !result.success,
      };
    }
  );

  const writeFile = tool(
    'write_file',
    'Write content to a file in the sandboxed repo. Creates parent directories if needed. Paths are relative to the repo root. Do not pass absolute host paths.',
    {
      path: z.string().describe('File path relative to the repository root'),
      content: z.string().describe('The full file content to write'),
    },
    async (args) => {
      await sandbox.writeFile(args.path, args.content);
      return {
        content: [{ type: 'text' as const, text: `Wrote ${args.path}` }],
      };
    }
  );

  return createSdkMcpServer({
    name: 'sandbox',
    version: '1.0.0',
    tools: [bash, readFile, listFiles, writeFile],
  });
}

function shellArg(input: string): string {
  return `'${input.replace(/'/g, `'\\''`)}'`;
}
