# @codewright/web

Frontend application for task visibility and control.

## Responsibilities

- Task list with filtering, sorting, pagination (TanStack Table)
- Task detail view with tabs (Overview, Timeline, Logs, Diff, Cost, Replay)
- Project management (CRUD)
- Authentication (login, register via better-auth)

## Tech stack

- Next.js 15 (App Router)
- React 19
- Tailwind CSS v4
- Apollo Client (GraphQL data fetching)
- GraphQL Codegen (client-preset)
- TanStack React Table (data tables)
- Radix UI + shadcn/ui (component primitives)
- React Hook Form + Zod (form validation)

## Internal structure

```
src/
  app/                    # Next.js App Router pages (thin — delegate to modules)
  components/
    ui/                   # shadcn/ui primitives (DO NOT add custom components here)
    common/               # Reusable components (empty-state, status-badge, etc.)
    data-table/           # Generic DataTable component (TanStack Table + shadcn Table)
    layout/               # App shell, header, sidebar
  libs/
    apollo/               # Apollo Client provider and configuration
    auth-client.ts        # better-auth client
  modules/{feature}/      # Feature modules (page components, forms, GraphQL, services)
  utils/                  # Utilities (cn.ts)
```

## Conventions

### Placement

- **`components/ui/`** is reserved for shadcn/ui — do not add custom components there
- **Feature modules** live in `modules/{feature}/` — one module per route or major feature
- **Shared components** go in `components/common/` (small atoms) or `components/{name}/` (larger, module-agnostic)
- **App Router pages** (`app/**/page.tsx`) are thin wrappers that import and render the module component

### Module / complex-component structure

Every module and every stateful component is a **folder**, not a file. Split by responsibility:

```
modules/{feature}/
  index.tsx          # UI only — renders markup, delegates state to use-service
  use-service.ts     # State & data hooks (useQuery, useMutation, useState, useMemo, callbacks)
  libs.ts            # Pure functions (formatters, normalizers, sort/filter helpers)
  types.ts           # TypeScript interfaces / unions (never enums — use `as const` maps)
  constants.ts       # UPPER_SNAKE_CASE values or PascalCase `as const` objects
  graphql.ts         # GraphQL queries/mutations (when the module owns them)
  components/        # Sub-components local to this module (same folder structure recursively)
```

Rules:

- `index.tsx` must not contain business logic — if you reach for `useState`, move it to `use-service.ts`
- `libs.ts` functions must be pure (no React hooks, no side effects)
- `types.ts` is types only — no values, no enums (use `as const` in `constants.ts` instead)
- Sub-components in `components/` follow the same folder pattern when they hold state; stateless atoms can be a single `index.tsx`
- Only the module's `index.tsx` wraps itself in `<AppShell>` — route pages are pass-through

### Where to put things

| Thing | Location |
|---|---|
| Route page | `modules/{feature}/index.tsx` |
| Per-route state & data | `modules/{feature}/use-service.ts` |
| GraphQL for a feature | `modules/{feature}/graphql.ts` |
| Feature-specific sub-component | `modules/{feature}/components/{name}/` |
| Form shared across features | `components/{name}/` (folder) |
| Small reusable atom | `components/common/{name}/index.tsx` |
| shadcn primitive | `components/ui/` (generated — don't hand-edit) |

### Tailwind CSS v4

We target **Tailwind CSS v4+** and rely on its dynamic spacing scale. Spacing-family utilities (`w`, `h`, `min-w`, `min-h`, `max-w`, `max-h`, `size`, `p[xytblr]?`, `m[xytblr]?`, `gap`, `gap-x`, `gap-y`, `top`, `right`, `bottom`, `left`, `inset`, `inset-x`, `inset-y`, `translate-x`, `translate-y`) derive from a single `--spacing` base (1 unit = 4px), and v4 accepts any positive number including fractions.

- **Do not use arbitrary pixel values** on spacing utilities — write the numeric scale instead
  - `max-h-[500px]` → `max-h-125` (500 / 4 = 125)
  - `w-[130px]` → `w-32.5`
  - `py-[7px]` → `py-1.75`
  - `gap-[1px]` → `gap-px`
  - `-inset-[1px]` → `-inset-px`
- Arbitrary values are still correct for utilities that use a **different** scale: `text-[11px]` (font-size), `rounded-[2px]` (border-radius), `border-[1.5px]` (border-width), `leading-[1.55]` (line-height), `tracking-[0.05em]` (letter-spacing), and CSS-variable colors like `text-[color:var(--accent)]`. Tailwind CSS IntelliSense will not flag these.
- Before adding new UI, check Tailwind's latest docs — v4 moved many things (theme config lives in CSS via `@theme`, not `tailwind.config.ts`). Don't copy v3-era patterns.

## Dependencies

- `@codewright/domain` — shared types (TaskStatus, ExecutionStatus, etc.)
- `@codewright/server` — all data via GraphQL API (no direct package imports at runtime)

## Key constraint

Web never talks to Temporal or agent directly. All operations go through the server GraphQL API.
