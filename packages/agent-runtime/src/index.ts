// @torin/agent-runtime — the agent execution engine (mechanism layer).
// The ONLY package that imports the Claude Agent SDK. Owns the query
// loop, observability, structured-output parsing, and the sandbox tool
// surface. Knows nothing about defects/localization/repair — that is the
// strategy layer (@torin/solver).

export { type AgentObserver, createObserver } from './driver/observer.js';
export {
  type RunAgentInput,
  type RunAgentResult,
  runAgent,
} from './driver/run-agent.js';
export { createSandboxMcpServer } from './tools/sandbox-server.js';
export {
  SANDBOX_READ_TOOLS,
  SANDBOX_WRITE_TOOLS,
  sandboxOnlyToolConfig,
} from './tools/tool-config.js';
