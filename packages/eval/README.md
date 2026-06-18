# @torin/eval

SWE-bench Verified evaluation for Torin — **generation runs locally,
scoring runs in the SWE-bench cloud via `sb-cli`** (no local Docker, no
120GB). `sb-cli` lives in a `uv`-managed Python venv created by
`scripts/setup.sh` (run automatically by `eval`/`score`; idempotent).

## One-time: get a SWE-bench API key (free)

```bash
pnpm --filter @torin/eval gen-key you@example.com   # emails you a key + code
pnpm --filter @torin/eval verify-key                # verify (follow the prompt)
export SWEBENCH_API_KEY=...                          # or put it in .env
```

## Run

```bash
# generate patches for a subset AND score them in the cloud, end to end
SWE_LIMIT=5 pnpm --filter @torin/eval eval

# re-score an existing predictions file without regenerating
pnpm --filter @torin/eval score predictions.jsonl
```

`eval` does: load N SWE-bench Verified instances → drive Torin's
`resolveDefect` on each `repo@base_commit` (auto-approving every HITL
gate) → extract the source-only patch from the CRITIC output → write
`predictions.jsonl` → submit to the cloud → print `resolved%`.

## Prerequisites

- A Torin **worker on this branch** + Temporal + Postgres running.
- A registered project for task attribution (`TORIN_EVAL_PROJECT_ID`, or
  the first project is used — SWE-bench repos are public so no creds).
- `uv` installed (`brew install uv`).

## Env vars

| Var | Default | Purpose |
|---|---|---|
| `SWE_LIMIT` | 20 | number of instances |
| `SWE_PREDICTIONS` | `predictions.jsonl` | output path |
| `TORIN_EVAL_PROJECT_ID` | first project | project to attribute tasks to |
| `SWEBENCH_API_KEY` | — | sb-cli cloud key (else scoring is skipped with guidance) |

## Notes

- The PR/push stage fails on read-only SWE-bench repos (task ends FAILED)
  — expected; the patch is read from the CRITIC output regardless.
- Some instances' Python deps may not install in the sandbox → that
  instance gets an empty patch (counts as unresolved), doesn't block the run.
