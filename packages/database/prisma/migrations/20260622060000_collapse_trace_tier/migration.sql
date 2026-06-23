-- Collapse the structured trace tier into TaskEvent (stage + status + cost)
-- + AgentMessageLog (transcript). Backfills before destructive drops so the
-- existing dev transcript survives.

-- 1. TaskEvent: per-stage agent cost rollup columns.
ALTER TABLE "task_event" ADD COLUMN "costUsd" DOUBLE PRECISION;
ALTER TABLE "task_event" ADD COLUMN "inputTokens" INTEGER;
ALTER TABLE "task_event" ADD COLUMN "outputTokens" INTEGER;
ALTER TABLE "task_event" ADD COLUMN "model" TEXT;

-- Backfill stage cost from the agent_invocation rows about to be dropped.
UPDATE "task_event" te SET
  "costUsd"      = agg."costUsd",
  "inputTokens"  = agg."inputTokens",
  "outputTokens" = agg."outputTokens",
  "model"        = agg."model"
FROM (
  SELECT "taskEventId",
         SUM("totalCostUsd") AS "costUsd",
         SUM("inputTokens")  AS "inputTokens",
         SUM("outputTokens") AS "outputTokens",
         MIN("model")        AS "model"
  FROM "agent_invocation"
  WHERE "taskEventId" IS NOT NULL
  GROUP BY "taskEventId"
) agg
WHERE te."id" = agg."taskEventId";

-- 2. AgentMessageLog: re-anchor to TaskEvent + activityId.
ALTER TABLE "agent_message_log" ADD COLUMN "taskEventId" TEXT;
ALTER TABLE "agent_message_log" ADD COLUMN "activityId" TEXT;

UPDATE "agent_message_log" aml SET
  "taskEventId" = ai."taskEventId",
  "activityId"  = aml."agentInvocationId"
FROM "agent_invocation" ai
WHERE aml."agentInvocationId" = ai."id";

-- Drop rows that can't be re-anchored (orphans / null parent event).
DELETE FROM "agent_message_log" WHERE "taskEventId" IS NULL OR "activityId" IS NULL;

ALTER TABLE "agent_message_log" ALTER COLUMN "taskEventId" SET NOT NULL;
ALTER TABLE "agent_message_log" ALTER COLUMN "activityId" SET NOT NULL;

-- Swap the idempotency key + FK from agentInvocationId → activityId/taskEventId.
DROP INDEX IF EXISTS "agent_message_log_agentInvocationId_seq_key";
ALTER TABLE "agent_message_log" DROP CONSTRAINT IF EXISTS "agent_message_log_agentInvocationId_fkey";
ALTER TABLE "agent_message_log" DROP COLUMN "agentInvocationId";

CREATE UNIQUE INDEX "agent_message_log_activityId_seq_key" ON "agent_message_log"("activityId", "seq");
CREATE INDEX "agent_message_log_taskEventId_idx" ON "agent_message_log"("taskEventId");
ALTER TABLE "agent_message_log"
  ADD CONSTRAINT "agent_message_log_taskEventId_fkey"
  FOREIGN KEY ("taskEventId") REFERENCES "task_event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Drop the structured trace tier (tables) in FK-safe order. DB columns +
-- writes are gone; TaskEvent (stage/status/cost) + AgentMessageLog (transcript)
-- are the only agent-observability records that remain.
DROP TABLE IF EXISTS "tool_call";
DROP TABLE IF EXISTS "agent_turn";
DROP TABLE IF EXISTS "agent_invocation";
DROP TABLE IF EXISTS "retrospective";
DROP TABLE IF EXISTS "attempt_execution";
DROP TABLE IF EXISTS "stage_execution";
DROP TABLE IF EXISTS "workflow_execution";
