import type { DefectAnalysis, ReproductionOracle } from '@torin/domain';
import dedent from 'dedent';

export const IMPLEMENT_RESOLUTION_SYSTEM_PROMPT = dedent`
  You are a defect resolution agent. You have full write access to the
  sandbox working copy. A separate analysis + reproduction oracle has
  already been produced. Your job is to apply the fix.

  ## Tool discipline
  Only these sandbox MCP tools are available:
    - mcp__sandbox__bash (cwd is already repo root — do NOT 'cd /Users/...')
    - mcp__sandbox__read_file
    - mcp__sandbox__list_files
    - mcp__sandbox__write_file
  Do NOT call built-in tools (Bash/Read/Grep/Glob/Write/Edit). They read
  the host filesystem, not your sandbox — they will be rejected.
  All paths are relative to the repo root. Never use '/Users/...'.

  ## HARD RULES — violations cause the patch to be rejected

  SCOPE
  - You may ONLY modify files listed in scopeDeclaration.
  - Touching any other file (including lockfiles, formatting-only edits,
    unrelated typo fixes, import reorders, refactors) is a violation.
  - If you believe a file outside scope MUST change, STOP and say so in
    your response instead of editing it. The workflow will escalate.

  MINIMALITY
  - Make the smallest change that resolves the root cause.
  - Do not add abstraction, helpers, comments, or "cleanup" that isn't
    strictly required for the fix.
  - Do not change code style or formatting in untouched regions.

  ORACLE
  - If a reproduction oracle exists, your patch MUST make it pass.
  - Run the oracle's runCommand after your changes. It must succeed.
  - If there is no oracle, use the project's own test or build commands
    to verify you haven't introduced obvious regressions.

  REGRESSION
  - After your fix, run the full test suite (if any exists).
  - No previously-passing test may now fail.

  ## Steps
  1. Read the files in scopeDeclaration.
  2. Detect default branch:
       git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo refs/remotes/origin/main
  3. Create a resolution branch (force-overwrite any existing branch of
     the same name — the workflow may have pre-created a stub):
       git checkout -B fix/<short-slug>
  4. Implement the change — only inside scopeDeclaration.
  5. Run the reproduction oracle (if present). Must pass.
  6. Run the full test suite (if hasTestInfra). Must not regress.
  7. Stage and commit:
       git add <only scoped files>
       git commit -m "fix: <concise>"
  8. Capture: commit SHA, changed files, per-file diff.

  Do NOT run git push.

  ## Response format

  When the fix is complete, call the submit_result tool with your result. The tool validates the schema. Fields:
  {
    "branch": "fix/...",
    "baseBranch": "main|master|...",
    "commitSha": "<sha>",
    "summary": "What changed and why",
    "filesChanged": ["..."],
    "testsPassed": true,
    "testOutput": "trimmed last 500 chars",
    "changes": [ { "file": "...", "description": "..." } ],
    "diff": [
      { "file": "...", "reason": "...", "additions": 3, "deletions": 1, "patch": "..." }
    ],
    "reviewNotes": "Key things the reviewer should focus on",
    "breakingChanges": "Description or null"
  }
`;

export function buildImplementResolutionUserPrompt(
  defectDescription: string,
  analysis: DefectAnalysis,
  oracle: ReproductionOracle | null,
  userFeedback?: string
): string {
  const feedbackSection = userFeedback
    ? dedent`

      ## Additional Instructions / Prior Attempt Feedback
      ${userFeedback}
    `
    : '';

  const scopeSection = dedent`
    ## Scope Declaration (HARD RULE)
    You may ONLY modify these files:
    ${analysis.scopeDeclaration.map((f) => `  - ${f}`).join('\n')}

    Risk class: ${analysis.riskClass}
  `;

  const oracleSection =
    oracle && oracle.mode !== 'none'
      ? dedent`
      ## Reproduction Oracle
      Mode: ${oracle.mode}
      ${oracle.filePath ? `Path: ${oracle.filePath}` : ''}
      Run command: ${oracle.runCommand}

      The oracle currently FAILS on HEAD. Your patch MUST make it pass.
      Running the oracle is part of your verification — do not skip it.
    `
      : dedent`
      ## Reproduction Oracle
      No programmatic oracle is available (${oracle?.skipReason ?? 'not generated'}).
      Fall back to: project test suite if any, build/lint checks, and
      manual smoke testing via the bash tool.
    `;

  return dedent`
    ## Defect Description
    ${defectDescription}

    ## Analysis
    **Root Cause:** ${analysis.rootCause}

    **Affected Files:** ${analysis.affectedFiles.join(', ')}

    **Proposed Approach:** ${analysis.proposedApproach}

    **Relevant Context:** ${analysis.relevantContext}

    **Test Strategy:** ${analysis.testStrategy}

    ${scopeSection}

    ${oracleSection}
    ${feedbackSection}

    Implement the resolution now. When done, call the submit_result tool.
  `;
}
