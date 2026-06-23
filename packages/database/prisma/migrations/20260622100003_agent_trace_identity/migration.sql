-- Trace identity for agent transcript rows.
-- AgentMessageLog.traceId = first 32 hex of SHA-256(taskId), matching the
-- app-side traceIdForTask(); TaskEvent.spanId = per-attempt stage span.

-- pgcrypto provides digest() for the deterministic backfill.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- AlterTable: add traceId nullable first so the backfill can populate it.
ALTER TABLE "agent_message_log" ADD COLUMN "traceId" TEXT;

-- Backfill existing rows: trace id is stable per task and matches
-- traceIdForTask(taskId) = substring(sha256(taskId) hex, 1, 32).
UPDATE "agent_message_log"
SET "traceId" = substring(encode(digest("taskId", 'sha256'), 'hex') FROM 1 FOR 32);

-- Now enforce NOT NULL.
ALTER TABLE "agent_message_log" ALTER COLUMN "traceId" SET NOT NULL;

-- AlterTable: stage span (nullable — pre-migration events have none).
ALTER TABLE "task_event" ADD COLUMN "spanId" TEXT;

-- CreateIndex
CREATE INDEX "agent_message_log_traceId_idx" ON "agent_message_log"("traceId");
