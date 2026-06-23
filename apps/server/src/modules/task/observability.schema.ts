// The structured trace tier (WorkflowExecution / StageExecution /
// AttemptExecution / AgentInvocation / AgentTurn / ToolCall / Retrospective)
// was removed. Agent observability now lives in two places:
//   - TaskEvent: stage + status + cost (see task.schema.ts)
//   - AgentMessageLog: the streamed agent message log (see agent-message.schema.ts)
//
// This file is intentionally empty; kept as a placeholder so the module's
// side-effect import list stays stable. It can be deleted entirely.
export {};
