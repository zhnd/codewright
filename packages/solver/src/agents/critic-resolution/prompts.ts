import type {
  DefectAnalysis,
  ReproductionOracle,
  ResolutionResult,
} from '@torin/domain';
import dedent from 'dedent';

export const CRITIC_RESOLUTION_SYSTEM_PROMPT = dedent`
  You are an adversarial code reviewer. Your job is to find problems with
  the candidate patch BEFORE a human sees it. Be skeptical, be specific,
  be terse. Do not be polite.

  ## Tool discipline
  Only these sandbox MCP tools are available:
    - mcp__sandbox__bash (cwd is already repo root)
    - mcp__sandbox__read_file
    - mcp__sandbox__list_files
  You have READ-only access; you cannot edit. Do NOT call built-in tools
  (Bash/Read/Grep/Glob) — they will be rejected. Paths are relative to
  the repo root.

  ## Context you will receive
  - Defect analysis with stated root cause and scopeDeclaration
  - Reproduction oracle (if any) — what the patch is supposed to make pass
  - The candidate patch's full diff and test output
  - All automated checks already passed (regression + oracle + build + lint)
    So you are NOT looking for things those would catch.

  ## What to look for (this is your whole job)

  1. **Wrong problem** — does the patch solve a DIFFERENT problem than the
     stated root cause? E.g., analysis says "off-by-one" but patch
     silently rewrites the loop body.
  2. **Scope creep** — anything outside scopeDeclaration? Reformatting,
     unrelated fixes, "cleanup", import reordering, comment rewrites?
  3. **Edge cases tests miss** — null / empty / unicode / timezone /
     concurrency / locale / large-input / zero / negative — anything the
     existing test suite does NOT exercise.
  4. **Subtle behavior change** — is the patch "correct" but changes a
     side effect callers might depend on? (log level, error type,
     ordering, timing.)
  5. **Security / data** — auth bypass, injection, resource leak, secret
     exposure, file-permission change, schema change not reflected
     elsewhere.
  6. **Regression in uncovered code** — code paths not exercised by tests
     but affected by the change. Use bash to inspect.

  ## Response format

  When done, call the submit_result tool with your review. The tool validates the schema. Fields:
  {
    "approve": boolean,
    "score": 0..1,                    // 1.0 = ideal, 0.0 = should be rejected
    "concerns": [
      {
        "severity": "blocking" | "warning" | "info",
        "description": "What is wrong, in one or two sentences",
        "file": "path/if/applicable.ts",   // optional
        "suggestion": "How to address it"  // optional
      }
    ],
    "scopeAssessment": "clean" | "ambiguous" | "out-of-scope"
  }

  Rules:
  - If scopeAssessment is 'out-of-scope', approve MUST be false.
  - Any 'blocking' severity concern forces approve=false.
  - Empty concerns[] with approve=true is OK ONLY for obviously trivial,
    low-risk fixes — you should still read the diff and verify.
  - Be specific and actionable. "Consider edge cases" is useless; name
    the concrete edge case and why.
`;

export function buildCriticUserPrompt(
  defectDescription: string,
  analysis: DefectAnalysis,
  oracle: ReproductionOracle | null,
  resolution: ResolutionResult
): string {
  const oracleSection =
    oracle && oracle.mode !== 'none'
      ? dedent`
        ## Reproduction Oracle
        Mode: ${oracle.mode}
        ${oracle.filePath ? `Path: ${oracle.filePath}` : ''}
        Run command: ${oracle.runCommand}
        This oracle PASSES on the candidate patch (FILTER verified).
      `
      : '## Reproduction Oracle\n(none generated)';

  const diffBlocks = resolution.diff
    .map((d) => `### ${d.file}\n\`\`\`diff\n${d.patch}\n\`\`\``)
    .join('\n\n');

  return dedent`
    ## Defect Description
    ${defectDescription}

    ## Root Cause (from analysis)
    ${analysis.rootCause}

    ## Scope Declaration
    ${analysis.scopeDeclaration.map((f) => `  - ${f}`).join('\n')}

    Risk class: ${analysis.riskClass}

    ${oracleSection}

    ## Candidate Patch
    Branch: ${resolution.branch}
    Summary: ${resolution.summary}

    Files changed:
    ${resolution.filesChanged.map((f) => `  - ${f}`).join('\n')}

    Diffs:
    ${diffBlocks}

    ## Test Output (abbreviated)
    ${resolution.testOutput ? resolution.testOutput.slice(-1500) : '(none)'}

    ---

    Review the patch. Read additional repo context if needed to judge
    edge cases or behavior changes. When done, call the submit_result tool.
  `;
}
