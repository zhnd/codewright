import { agentMessagePubSub } from '../../infrastructure/graphql/agent-message-pubsub.js';
import { builder } from '../../infrastructure/graphql/builder.js';
import { log } from '../../logger.js';

/** Max rows pulled per drain iteration on each NOTIFY tick. */
const PAGE_SIZE = 500;

/**
 * Live agent message log stream (data plane). On each micro-batched NOTIFY the
 * generator pulls the ids of rows with `cursor > lastCursor`, advances
 * the cursor, and yields them; the resolver refetches the full rows with
 * the requested field selection.
 *
 * `afterCursor` lets a reconnecting client resume from where it left off
 * (the client also keeps the cursor-paginated query as a consistency
 * backstop). Auth: ownership is verified once on subscribe.
 */
builder.subscriptionField('agentMessagesAppended', (t) =>
  t.prismaField({
    type: ['AgentMessageLog'],
    authScopes: { authenticated: true },
    args: {
      taskId: t.arg.string({ required: true }),
      afterCursor: t.arg.string(),
    },
    subscribe: async function* (_parent, { taskId, afterCursor }, ctx) {
      if (!ctx.user) return;
      const task = await ctx.prisma.task.findFirst({
        where: { id: taskId, userId: ctx.user.id },
        select: { id: true },
      });
      if (!task) {
        log.warn(
          { taskId },
          'agentMessagesAppended: not found/owned — closing'
        );
        return;
      }

      let lastCursor: bigint = afterCursor ? BigInt(afterCursor) : 0n;
      for await (const _ of agentMessagePubSub.iterate(taskId)) {
        // Fully drain the backlog before awaiting the next NOTIFY: a single
        // micro-batched tick can represent more than PAGE_SIZE new rows, and
        // if the stage then goes quiet no further tick arrives — so a single
        // page would strand rows PAGE_SIZE+1..N until the next insert (which
        // may never come), leaving the Activity view permanently truncated.
        while (true) {
          const rows = await ctx.prisma.agentMessageLog.findMany({
            where: { taskId, cursor: { gt: lastCursor } },
            orderBy: { cursor: 'asc' },
            take: PAGE_SIZE,
            select: { id: true, cursor: true },
          });
          if (rows.length === 0) break;
          lastCursor = rows[rows.length - 1].cursor;
          yield rows.map((r) => r.id);
          if (rows.length < PAGE_SIZE) break;
        }
      }
    },
    resolve: (query, ids, _args, ctx) => {
      return ctx.prisma.agentMessageLog.findMany({
        ...query,
        where: { id: { in: ids as string[] } },
        orderBy: { cursor: 'asc' },
      });
    },
  })
);
