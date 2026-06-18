-- Consolidates task / task_event into the new shape:
--   * task = slim metadata (status, input, project, user, lifecycle timestamps)
--   * task_event = self-contained execution units (STAGE attempts + REVIEW actions)
-- Trace tier (workflow_execution / stage_execution / attempt_execution /
-- agent_invocation / agent_turn / tool_call / retrospective) is kept for the
-- deferred trace work but no longer linked from task_event.
-- Dev-only migration: idempotency relaxed where it would obscure intent.

-- ── Enums ─────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuthProvider') THEN
    CREATE TYPE "AuthProvider" AS ENUM ('GITHUB', 'GITLAB', 'GITEA');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TaskType') THEN
    CREATE TYPE "TaskType" AS ENUM ('ANALYZE_REPOSITORY', 'RESOLVE_DEFECT');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TaskStatus') THEN
    CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExecutionStatus') THEN
    CREATE TYPE "ExecutionStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StageStatus') THEN
    CREATE TYPE "StageStatus" AS ENUM ('PENDING', 'RUNNING', 'AWAITING', 'COMPLETED', 'FAILED', 'SKIPPED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgentInvocationStatus') THEN
    CREATE TYPE "AgentInvocationStatus" AS ENUM ('RUNNING', 'SUCCESS', 'ERROR');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TaskEventKind') THEN
    CREATE TYPE "TaskEventKind" AS ENUM ('STAGE', 'REVIEW');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TaskEventStatus') THEN
    CREATE TYPE "TaskEventStatus" AS ENUM ('RUNNING', 'AWAITING', 'COMPLETED', 'REJECTED', 'FAILED', 'SKIPPED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TaskStageKey') THEN
    CREATE TYPE "TaskStageKey" AS ENUM ('ANALYSIS', 'REPRODUCE', 'IMPLEMENT', 'FILTER', 'CRITIC', 'PR');
  END IF;
END $$;

-- ── Project: add authProvider + workflowConfig ────────────────
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "authProvider" "AuthProvider" NOT NULL DEFAULT 'GITHUB';
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "workflowConfig" JSONB;

-- ── Task: drop legacy / aggregate columns ─────────────────────
ALTER TABLE "task" DROP COLUMN IF EXISTS "repositoryUrl";
ALTER TABLE "task" DROP COLUMN IF EXISTS "result";
ALTER TABLE "task" DROP COLUMN IF EXISTS "costBreakdown";
ALTER TABLE "task" DROP COLUMN IF EXISTS "durationMs";
ALTER TABLE "task" DROP COLUMN IF EXISTS "inputTokens";
ALTER TABLE "task" DROP COLUMN IF EXISTS "outputTokens";
ALTER TABLE "task" DROP COLUMN IF EXISTS "model";
ALTER TABLE "task" DROP COLUMN IF EXISTS "totalCostUsd";

-- ── Task: convert text → enum (skip if already enum) ──────────
DO $$
DECLARE
  task_type_is_text boolean;
BEGIN
  SELECT data_type = 'text' INTO task_type_is_text
  FROM information_schema.columns
  WHERE table_name = 'task' AND column_name = 'type';

  IF task_type_is_text THEN
    -- Legacy FIX_BUG → RESOLVE_DEFECT; any unknown → ANALYZE_REPOSITORY.
    UPDATE "task" SET "type" = 'RESOLVE_DEFECT' WHERE "type" = 'FIX_BUG';
    UPDATE "task" SET "type" = 'ANALYZE_REPOSITORY'
      WHERE "type" NOT IN ('ANALYZE_REPOSITORY', 'RESOLVE_DEFECT');
    -- Coerce out-of-set / dropped statuses (AWAITING_REVIEW removed).
    UPDATE "task" SET "status" = 'PENDING'
      WHERE "status" NOT IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

    ALTER TABLE "task"
      ALTER COLUMN "type" DROP DEFAULT,
      ALTER COLUMN "type" TYPE "TaskType" USING "type"::"TaskType",
      ALTER COLUMN "type" SET DEFAULT 'ANALYZE_REPOSITORY',
      ALTER COLUMN "status" DROP DEFAULT,
      ALTER COLUMN "status" TYPE "TaskStatus" USING "status"::"TaskStatus",
      ALTER COLUMN "status" SET DEFAULT 'PENDING';
  END IF;
END $$;

-- ── Task: add new columns ─────────────────────────────────────
-- Original request payload (defectDescription, etc.). Default '{}' lets
-- the migration apply on a non-empty dev DB; new code always supplies a
-- concrete value.
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "input" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "triggerSource" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);

-- Task.workflowId unique (one Temporal workflow per task)
DO $$ BEGIN
  CREATE UNIQUE INDEX "task_workflowId_key" ON "task"("workflowId");
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- ── task_event: drop old shape, create new ────────────────────
DROP TABLE IF EXISTS "task_event" CASCADE;

CREATE TABLE "task_event" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "kind" "TaskEventKind" NOT NULL,
    "stageKey" "TaskStageKey" NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "TaskEventStatus" NOT NULL DEFAULT 'RUNNING',
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "decidedBy" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    CONSTRAINT "task_event_pkey" PRIMARY KEY ("id")
);

-- ── Trace tier (kept; no longer linked from task_event) ───────
CREATE TABLE IF NOT EXISTS "workflow_definition" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workflow_definition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workflow_stage" (
    "id" TEXT NOT NULL,
    "workflowDefinitionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "allowsRetry" BOOLEAN NOT NULL DEFAULT true,
    "allowsHitl" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    CONSTRAINT "workflow_stage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workflow_execution" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "workflowKind" TEXT NOT NULL,
    "workflowVersion" INTEGER NOT NULL DEFAULT 1,
    "traceId" TEXT NOT NULL,
    "temporalWorkflowId" TEXT,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    CONSTRAINT "workflow_execution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "stage_execution" (
    "id" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "stageName" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" "StageStatus" NOT NULL DEFAULT 'PENDING',
    "spanId" TEXT NOT NULL,
    "parentSpanId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    CONSTRAINT "stage_execution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "attempt_execution" (
    "id" TEXT NOT NULL,
    "stageExecutionId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "triggerKind" TEXT NOT NULL,
    "triggerPayload" JSONB,
    "spanId" TEXT NOT NULL,
    "parentSpanId" TEXT NOT NULL,
    "status" "StageStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    CONSTRAINT "attempt_execution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "agent_invocation" (
    "id" TEXT NOT NULL,
    "attemptExecutionId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "AgentInvocationStatus" NOT NULL DEFAULT 'RUNNING',
    "errorText" TEXT,
    "spanId" TEXT NOT NULL,
    "parentSpanId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "totalCostUsd" DOUBLE PRECISION,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    CONSTRAINT "agent_invocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "agent_turn" (
    "id" TEXT NOT NULL,
    "agentInvocationId" TEXT NOT NULL,
    "turnIndex" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "textContent" TEXT,
    "textTruncatedAt" INTEGER,
    "toolUseCount" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_turn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "tool_call" (
    "id" TEXT NOT NULL,
    "agentInvocationId" TEXT NOT NULL,
    "agentTurnId" TEXT,
    "toolUseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" TEXT,
    "outputTruncatedAt" INTEGER,
    "success" BOOLEAN,
    "errorText" TEXT,
    "spanId" TEXT NOT NULL,
    "parentSpanId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    CONSTRAINT "tool_call_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "retrospective" (
    "id" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "summary" TEXT,
    "bottlenecks" JSONB NOT NULL DEFAULT '[]',
    "recommendations" JSONB NOT NULL DEFAULT '[]',
    "riskFactors" JSONB NOT NULL DEFAULT '[]',
    "stats" JSONB NOT NULL DEFAULT '{}',
    "model" TEXT,
    "costUsd" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "retrospective_pkey" PRIMARY KEY ("id")
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "task_status_idx" ON "task"("status");
CREATE INDEX IF NOT EXISTS "task_createdAt_idx" ON "task"("createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "task_event_taskId_kind_stageKey_attemptNumber_key"
  ON "task_event"("taskId", "kind", "stageKey", "attemptNumber");
CREATE INDEX IF NOT EXISTS "task_event_taskId_startedAt_idx"
  ON "task_event"("taskId", "startedAt");
CREATE INDEX IF NOT EXISTS "task_event_taskId_status_idx"
  ON "task_event"("taskId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_definition_kind_key" ON "workflow_definition"("kind");
CREATE INDEX IF NOT EXISTS "workflow_stage_workflowDefinitionId_order_idx" ON "workflow_stage"("workflowDefinitionId", "order");
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_stage_workflowDefinitionId_name_key" ON "workflow_stage"("workflowDefinitionId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_execution_traceId_key" ON "workflow_execution"("traceId");
CREATE INDEX IF NOT EXISTS "workflow_execution_taskId_idx" ON "workflow_execution"("taskId");
CREATE INDEX IF NOT EXISTS "workflow_execution_workflowKind_status_idx" ON "workflow_execution"("workflowKind", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "stage_execution_spanId_key" ON "stage_execution"("spanId");
CREATE INDEX IF NOT EXISTS "stage_execution_workflowExecutionId_order_idx" ON "stage_execution"("workflowExecutionId", "order");
CREATE UNIQUE INDEX IF NOT EXISTS "attempt_execution_spanId_key" ON "attempt_execution"("spanId");
CREATE UNIQUE INDEX IF NOT EXISTS "attempt_execution_stageExecutionId_attemptNumber_key" ON "attempt_execution"("stageExecutionId", "attemptNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "agent_invocation_spanId_key" ON "agent_invocation"("spanId");
CREATE INDEX IF NOT EXISTS "agent_invocation_attemptExecutionId_idx" ON "agent_invocation"("attemptExecutionId");
CREATE UNIQUE INDEX IF NOT EXISTS "agent_turn_agentInvocationId_turnIndex_key" ON "agent_turn"("agentInvocationId", "turnIndex");
CREATE UNIQUE INDEX IF NOT EXISTS "tool_call_spanId_key" ON "tool_call"("spanId");
CREATE INDEX IF NOT EXISTS "tool_call_agentInvocationId_startedAt_idx" ON "tool_call"("agentInvocationId", "startedAt");
CREATE INDEX IF NOT EXISTS "tool_call_name_idx" ON "tool_call"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "retrospective_workflowExecutionId_key" ON "retrospective"("workflowExecutionId");

-- ── Foreign keys ──────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "task_event" ADD CONSTRAINT "task_event_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "task_event" ADD CONSTRAINT "task_event_decidedBy_fkey"
    FOREIGN KEY ("decidedBy") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "workflow_stage" ADD CONSTRAINT "workflow_stage_workflowDefinitionId_fkey" FOREIGN KEY ("workflowDefinitionId") REFERENCES "workflow_definition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "workflow_execution" ADD CONSTRAINT "workflow_execution_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "stage_execution" ADD CONSTRAINT "stage_execution_workflowExecutionId_fkey" FOREIGN KEY ("workflowExecutionId") REFERENCES "workflow_execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "attempt_execution" ADD CONSTRAINT "attempt_execution_stageExecutionId_fkey" FOREIGN KEY ("stageExecutionId") REFERENCES "stage_execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agent_invocation" ADD CONSTRAINT "agent_invocation_attemptExecutionId_fkey" FOREIGN KEY ("attemptExecutionId") REFERENCES "attempt_execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agent_turn" ADD CONSTRAINT "agent_turn_agentInvocationId_fkey" FOREIGN KEY ("agentInvocationId") REFERENCES "agent_invocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "tool_call" ADD CONSTRAINT "tool_call_agentInvocationId_fkey" FOREIGN KEY ("agentInvocationId") REFERENCES "agent_invocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "tool_call" ADD CONSTRAINT "tool_call_agentTurnId_fkey" FOREIGN KEY ("agentTurnId") REFERENCES "agent_turn"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "retrospective" ADD CONSTRAINT "retrospective_workflowExecutionId_fkey" FOREIGN KEY ("workflowExecutionId") REFERENCES "workflow_execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── pg_notify triggers for GraphQL subscription ───────────────
-- task: status / metadata changes
-- task_event: any insert (new attempt, new review) or update (status mutate)
-- Both push { taskId, kind } on channel 'codewright_task_events'; the server's
-- TaskPubSub fans out a debounced refetch (250 ms) to subscribers.

CREATE OR REPLACE FUNCTION codewright_notify_task() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'codewright_task_events',
    json_build_object('taskId', NEW.id, 'kind', 'task')::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION codewright_notify_task_event() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'codewright_task_events',
    json_build_object('taskId', NEW."taskId", 'kind', 'task_event')::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS codewright_task_notify ON "task";
CREATE TRIGGER codewright_task_notify
  AFTER INSERT OR UPDATE ON "task"
  FOR EACH ROW EXECUTE FUNCTION codewright_notify_task();

DROP TRIGGER IF EXISTS codewright_task_event_notify ON "task_event";
CREATE TRIGGER codewright_task_event_notify
  AFTER INSERT OR UPDATE ON "task_event"
  FOR EACH ROW EXECUTE FUNCTION codewright_notify_task_event();
