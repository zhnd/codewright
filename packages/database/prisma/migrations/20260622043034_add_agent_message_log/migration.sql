-- CreateTable
CREATE TABLE "agent_message_log" (
    "id" TEXT NOT NULL,
    "cursor" BIGSERIAL NOT NULL,
    "agentInvocationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "role" TEXT,
    "textContent" TEXT,
    "textTruncatedAt" INTEGER,
    "toolUseId" TEXT,
    "toolName" TEXT,
    "payload" JSONB,
    "payloadTruncatedAt" INTEGER,
    "blobRef" TEXT,
    "spanId" TEXT NOT NULL,
    "parentSpanId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_message_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_message_log_spanId_key" ON "agent_message_log"("spanId");

-- CreateIndex
CREATE INDEX "agent_message_log_taskId_cursor_idx" ON "agent_message_log"("taskId", "cursor");

-- CreateIndex
CREATE UNIQUE INDEX "agent_message_log_agentInvocationId_seq_key" ON "agent_message_log"("agentInvocationId", "seq");

-- AddForeignKey
ALTER TABLE "agent_message_log" ADD CONSTRAINT "agent_message_log_agentInvocationId_fkey" FOREIGN KEY ("agentInvocationId") REFERENCES "agent_invocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Data-plane NOTIFY: transcript stream ──────────────────────
-- A dedicated channel (separate from 'codewright_task_events') so the
-- high-frequency transcript stream does not collapse into the status
-- plane's 250ms debounce. Payload carries the read cursor; the server's
-- AgentMessagePubSub fans out a micro-batched signal and the subscription
-- pulls rows with cursor > lastSeen.
CREATE OR REPLACE FUNCTION codewright_notify_agent_message() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'codewright_agent_messages',
    json_build_object('taskId', NEW."taskId", 'cursor', NEW.cursor::text)::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS codewright_agent_message_notify ON "agent_message_log";
CREATE TRIGGER codewright_agent_message_notify
  AFTER INSERT ON "agent_message_log"
  FOR EACH ROW EXECUTE FUNCTION codewright_notify_agent_message();

-- ── Control-plane NOTIFY: add userId for list-page fan-out ────
-- The tasks-list subscription is keyed by userId; including it in the
-- payload lets the server fan out list refreshes without a lookup. task
-- has userId directly; task_event resolves it from its parent task.
CREATE OR REPLACE FUNCTION codewright_notify_task() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'codewright_task_events',
    json_build_object('taskId', NEW.id, 'kind', 'task', 'userId', NEW."userId")::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION codewright_notify_task_event() RETURNS trigger AS $$
DECLARE
  owner_id TEXT;
BEGIN
  SELECT "userId" INTO owner_id FROM "task" WHERE "id" = NEW."taskId";
  PERFORM pg_notify(
    'codewright_task_events',
    json_build_object('taskId', NEW."taskId", 'kind', 'task_event', 'userId', owner_id)::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
