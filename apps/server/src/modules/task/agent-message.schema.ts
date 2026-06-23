import { builder } from '../../infrastructure/graphql/builder.js';

/**
 * Append-only agent message log row (data plane). `cursor` and `seq` are
 * BigInt/large ints in the DB; exposed as String over the wire to dodge
 * JS number-precision issues. Clients stream/page by `cursor`.
 */
builder.prismaObject('AgentMessageLog', {
  fields: (t) => ({
    id: t.exposeID('id'),
    cursor: t.string({ resolve: (m) => m.cursor.toString() }),
    taskEventId: t.exposeString('taskEventId'),
    taskId: t.exposeString('taskId'),
    traceId: t.exposeString('traceId'),
    seq: t.exposeInt('seq'),
    kind: t.exposeString('kind'),
    role: t.exposeString('role', { nullable: true }),
    textContent: t.exposeString('textContent', { nullable: true }),
    textTruncatedAt: t.exposeInt('textTruncatedAt', { nullable: true }),
    toolUseId: t.exposeString('toolUseId', { nullable: true }),
    toolName: t.exposeString('toolName', { nullable: true }),
    payload: t.expose('payload', { type: 'Json', nullable: true }),
    payloadTruncatedAt: t.exposeInt('payloadTruncatedAt', { nullable: true }),
    spanId: t.exposeString('spanId'),
    parentSpanId: t.exposeString('parentSpanId'),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
  }),
});

/** Default / max page size for the cursor-paginated message log query. */
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

/**
 * Cursor-paginated message log read. Always returns rows **ascending by
 * cursor**, in one of three modes (mutually exclusive cursors):
 *
 *   - `beforeCursor` → the page of OLDER rows (`cursor < beforeCursor`).
 *     Read descending + `take`, then reversed to ascending. Backs the
 *     "Load earlier" button.
 *   - `afterCursor` → NEWER rows (`cursor > afterCursor`), ascending.
 *     Forward fill for the live subscription / reconnect gap-fill.
 *   - neither (initial load) → the **tail**: the newest `limit` rows
 *     (read descending + `take`, reversed). So a long, already-finished
 *     task opens on its latest stage instead of its oldest.
 *
 * The client derives `hasMore` from a full-page length and appends into an
 * Apollo field-policy merge keyed by `cursor` (dedupe + ascending sort),
 * so prepended-older and appended-newer pages both land in order.
 */
builder.queryField('agentMessages', (t) =>
  t.prismaField({
    type: ['AgentMessageLog'],
    authScopes: { authenticated: true },
    args: {
      taskId: t.arg.string({ required: true }),
      afterCursor: t.arg.string(),
      beforeCursor: t.arg.string(),
      limit: t.arg.int(),
    },
    resolve: async (query, _parent, args, ctx) => {
      // Ownership gate: the task must belong to the caller.
      const task = await ctx.prisma.task.findFirst({
        where: { id: args.taskId, userId: ctx.user?.id },
        select: { id: true },
      });
      if (!task) return [];
      const take = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

      // Forward fill (live / gap-fill): older→newer from afterCursor.
      if (args.afterCursor) {
        return ctx.prisma.agentMessageLog.findMany({
          ...query,
          where: {
            taskId: args.taskId,
            cursor: { gt: BigInt(args.afterCursor) },
          },
          orderBy: { cursor: 'asc' },
          take,
        });
      }

      // Tail (initial) or "Load earlier" (beforeCursor): read the newest
      // matching rows descending, then flip to ascending for the client.
      const rows = await ctx.prisma.agentMessageLog.findMany({
        ...query,
        where: {
          taskId: args.taskId,
          ...(args.beforeCursor
            ? { cursor: { lt: BigInt(args.beforeCursor) } }
            : {}),
        },
        orderBy: { cursor: 'desc' },
        take,
      });
      return rows.reverse();
    },
  })
);
