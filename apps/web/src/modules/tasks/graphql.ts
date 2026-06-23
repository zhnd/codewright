import { gql } from '@apollo/client';

export const TASK_FIELDS = gql`
  fragment TaskFields on Task {
    id
    type
    status
    input
    triggerSource
    error
    workflowId
    currentStageKey
    awaiting {
      stageKey
      attemptNumber
    }
    project {
      id
      name
      repositoryUrl
    }
    createdAt
    updatedAt
    startedAt
    completedAt
  }
`;

// Detail-view fragment: pulls the folded stage view (per-stage attempts +
// reviews). The events relation gives the raw rows for the events tab.
export const TASK_DETAIL_FIELDS = gql`
  fragment TaskDetailFields on Task {
    ...TaskFields
    stages {
      key
      status
      attempts {
        attemptNumber
        status
        input
        output
        error
        startedAt
        endedAt
        durationMs
        review {
          action
          feedback
          decidedBy
          decidedAt
        }
      }
    }
    events {
      id
      kind
      stageKey
      attemptNumber
      status
      input
      output
      error
      decidedBy
      startedAt
      endedAt
      durationMs
      costUsd
      inputTokens
      outputTokens
      model
    }
  }
  ${TASK_FIELDS}
`;

// Control-plane (status) fragment for the live subscription. Deliberately
// excludes the high-churn events→invocations→turns/toolCalls subtree: the
// detail view refetches GET_TASK on each tick for the structured/trace
// data, and the live agent message log flows on its own data-plane subscription.
export const TASK_STATUS_FIELDS = gql`
  fragment TaskStatusFields on Task {
    ...TaskFields
    stages {
      key
      status
      attempts {
        attemptNumber
        status
        startedAt
        endedAt
        durationMs
        review {
          action
          feedback
          decidedBy
          decidedAt
        }
      }
    }
  }
  ${TASK_FIELDS}
`;

// Append-only agent message log row (data plane). Mirrors AgentMessageLog.
export const AGENT_MESSAGE_FIELDS = gql`
  fragment AgentMessageFields on AgentMessageLog {
    id
    cursor
    taskEventId
    taskId
    seq
    kind
    role
    textContent
    textTruncatedAt
    toolUseId
    toolName
    payload
    payloadTruncatedAt
    createdAt
  }
`;

// Task-list row: status + pipeline + rolled-up duration/cost. Kept lean
// (no events/attempts subtree) so the list query stays cheap.
export const TASK_LIST_FIELDS = gql`
  fragment TaskListFields on Task {
    id
    type
    status
    error
    currentStageKey
    awaiting {
      stageKey
      attemptNumber
    }
    project {
      id
      name
    }
    stages {
      key
      status
    }
    durationMs
    totalCostUsd
    createdAt
    startedAt
    completedAt
  }
`;

export const GET_TASKS = gql`
  query GetTasks($status: String, $projectId: String) {
    tasks(status: $status, projectId: $projectId) {
      ...TaskListFields
    }
  }
  ${TASK_LIST_FIELDS}
`;

// Live tasks-list refresh (replaces 5s polling). Returns the full list on
// any of the user's tasks changing.
export const TASKS_CHANGED = gql`
  subscription TasksChanged {
    tasksChanged {
      ...TaskListFields
    }
  }
  ${TASK_LIST_FIELDS}
`;

export const GET_TASK = gql`
  query GetTask($id: String!) {
    task(id: $id) {
      ...TaskDetailFields
    }
  }
  ${TASK_DETAIL_FIELDS}
`;

export const TASK_UPDATED = gql`
  subscription TaskUpdated($id: String!) {
    taskUpdated(id: $id) {
      ...TaskStatusFields
    }
  }
  ${TASK_STATUS_FIELDS}
`;

// Message log paging. No cursor → newest page (tail); `beforeCursor` →
// older page ("Load earlier"); `afterCursor` → newer rows (gap-fill).
export const GET_AGENT_MESSAGES = gql`
  query GetAgentMessages(
    $taskId: String!
    $afterCursor: String
    $beforeCursor: String
    $limit: Int
  ) {
    agentMessages(
      taskId: $taskId
      afterCursor: $afterCursor
      beforeCursor: $beforeCursor
      limit: $limit
    ) {
      ...AgentMessageFields
    }
  }
  ${AGENT_MESSAGE_FIELDS}
`;

// Live agent message log stream — pushes new rows after a cursor.
export const AGENT_MESSAGES_APPENDED = gql`
  subscription AgentMessagesAppended($taskId: String!, $afterCursor: String) {
    agentMessagesAppended(taskId: $taskId, afterCursor: $afterCursor) {
      ...AgentMessageFields
    }
  }
  ${AGENT_MESSAGE_FIELDS}
`;

export const RESOLVE_DEFECT = gql`
  mutation ResolveDefect(
    $projectId: String!
    $defectDescription: String!
    $baseBranch: String
    $tapdBugId: String
    $tapdWorkspaceId: String
  ) {
    resolveDefect(
      projectId: $projectId
      defectDescription: $defectDescription
      baseBranch: $baseBranch
      tapdBugId: $tapdBugId
      tapdWorkspaceId: $tapdWorkspaceId
    ) {
      ...TaskFields
    }
  }
  ${TASK_FIELDS}
`;

export const REVIEW_TASK = gql`
  mutation ReviewTask($taskId: String!, $action: String!, $feedback: String) {
    reviewTask(taskId: $taskId, action: $action, feedback: $feedback) {
      ...TaskFields
    }
  }
  ${TASK_FIELDS}
`;

export const RETRY_TASK = gql`
  mutation RetryTask($taskId: String!) {
    retryTask(taskId: $taskId) {
      id
    }
  }
`;

export const CANCEL_TASK = gql`
  mutation CancelTask($taskId: String!) {
    cancelTask(taskId: $taskId) {
      id
      status
    }
  }
`;
