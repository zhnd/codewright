# @codewright/githost

Provider-agnostic abstraction over git hosts (GitHub, cnb.cool).

## Responsibilities

- Define `GitHostClient` — a fully-bound API client (one per project) that exposes `createPullRequest` and `addReviewComments` plus readonly accessors for `provider`, `repo`, `botIdentity`, `token`.
- Provide one factory `createGitClient({provider, repositoryUrl, token, apiBaseUrl?})` that parses the URL, validates host/provider match, and returns the right implementation.
- Provide URL parsers (`parseRepoUrl`, `parseGitHubUrl`, `parseCnbUrl`) and metadata helpers (`gitCredentialsFor`, `defaultBotIdentity`, `mapAuthProvider`) for callers that need provider info without constructing an HTTP client (sandbox credential broker, server-side URL validation).

## Internal structure

```
src/
  interface.ts       # GitHostClient, ParsedRepo, GitCredentials, BotIdentity, GitHostProvider
  factory.ts         # createGitClient + helper exports
  url.ts             # parseRepoUrl host-detected dispatcher
  diff-position.ts   # firstAddedLinePosition (GitHub) + firstAddedLineNumber (cnb)
  github/
    client.ts        # GitHubClient — wraps @octokit/rest
    url.ts           # parseGitHubUrl
  cnb/
    client.ts        # CnbClient — wraps node-cnb SDK
    url.ts           # parseCnbUrl (multi-segment groups supported)
  index.ts           # public re-exports
```

## Key design

- **Repo identity is bound at construction.** Methods take action args only — never pass `repo` per call. Sandbox/credential code reads the same identity off the client's readonly fields.
- **Single factory.** `createGitClient` is the only entry point for building clients. Callers do not import provider implementations directly.
- **Pure abstraction.** This package has no Prisma awareness and no encryption awareness — adapters live in callers (`@codewright/workflow/utils/git-context.ts` adapts a Project row).
- **cnb wire format diverges from GitHub.** cnb review comments use `start_line`/`end_line` in the new file with `start_side`/`end_side`, not GitHub's diff-relative `position`. `firstAddedLineNumber` parses `@@ -a,b +c,d @@` hunk headers to resolve new-file line numbers; `firstAddedLinePosition` stays for GitHub.
- **HTTPS clone username differs by provider.** GitHub uses `x-access-token`, cnb uses `cnb`. The credential helper script (returned by `gitCredentialsFor`) bakes this in; the env var name is unified as `CODEWRIGHT_GIT_TOKEN`.

## Adding a new git host

1. Add the provider tag to `GitHostProvider` in `interface.ts`.
2. Add a value to the Prisma `AuthProvider` enum and a migration.
3. Implement `GitHostClient` in a new `src/<provider>/client.ts`. Export a URL parser from `src/<provider>/url.ts`.
4. Extend the dispatch in `src/url.ts` (`parseRepoUrl`) and the switches in `factory.ts` (`createGitClient`, `gitCredentialsFor`, `defaultBotIdentity`, `mapAuthProvider`).

Callers (workflow activities, server services, sandbox broker) use only the public surface, so a new provider doesn't ripple outside this package.

## Dependencies

- `@codewright/domain` — `PullRequestResult`, `FileChange`
- `@codewright/shared` — only for shared logger (used by clients on demand)
- Third-party: `@octokit/rest` (GitHub), `node-cnb` (cnb.cool)

## Key constraints

- No I/O at construction time. `createGitClient` parses the URL and stores the token; no HTTP requests fire until a method is called.
- The token is held in plain text on the client instance — callers must not log or serialize the client. `getState`-style serialization is not supported on purpose.
- Method signatures are kept narrow (`{head, base, title, body}`, `{pullNumber, changes}`); provider-specific extras (cnb's `head_repo`, GitHub's `draft`) are filled in by the implementation, not exposed to callers.
