import { builder } from '../../infrastructure/graphql/builder.js';
import { taskPubSub } from '../../infrastructure/graphql/pubsub.js';
import { log } from '../../logger.js';

/**
 * Live subscription for one task. Workflow is the only writer of task /
 * stage / awaiting state; the pg_notify trigger on `task` /
 * `stage_execution` / `attempt_execution` fires on UPDATE and the server
 * fans out a debounced refetch (250 ms trailing) to subscribed clients.
 *
 * Auth: subscribe resolver verifies task.userId === ctx.user.id on the
 * first fetch; if the task doesn't belong to the user, an error is
 * thrown and graphql-ws closes the stream.
 */
builder.subscriptionField('taskUpdated', (t) =>
  t.prismaField({
    type: 'Task',
    authScopes: { authenticated: true },
    args: {
      id: t.arg.string({ required: true }),
    },
    subscribe: async function* (_parent, { id }, ctx) {
      log.debug(
        { taskId: id, userId: ctx.user?.id },
        'taskUpdated: subscribe start'
      );
      if (!ctx.user) {
        log.warn(
          { taskId: id },
          'taskUpdated: ctx.user missing — closing stream'
        );
        return;
      }
      const task = await ctx.prisma.task.findFirst({
        where: { id, userId: ctx.user.id },
        select: { id: true },
      });
      if (!task) {
        log.warn(
          { taskId: id, userId: ctx.user.id },
          'taskUpdated: task not found or not owned — closing stream'
        );
        return;
      }
      log.debug({ taskId: id }, 'taskUpdated: baseline yield');
      yield id;
      let tick = 0;
      for await (const _ of taskPubSub.iterate(id)) {
        tick += 1;
        log.debug({ taskId: id, tick }, 'taskUpdated: pubsub tick → yielding');
        yield id;
      }
      log.debug({ taskId: id }, 'taskUpdated: subscribe loop ended');
    },
    resolve: async (query, id, _args, ctx) => {
      log.debug({ taskId: id }, 'taskUpdated: resolve start');
      const row = await ctx.prisma.task.findFirstOrThrow({
        ...query,
        where: { id: id as string, userId: ctx.user?.id },
      });
      log.debug(
        { taskId: id, status: (row as { status?: string }).status },
        'taskUpdated: resolve done'
      );
      return row;
    },
  })
);

/**
 * Live tasks-list subscription. Yields the caller's full task list
 * whenever ANY of their tasks changes (status / stage), so the dashboard
 * list refreshes off the pg_notify stream instead of polling. Keyed by
 * userId via the `userId` field now carried in the NOTIFY payload.
 */
builder.subscriptionField('tasksChanged', (t) =>
  t.prismaField({
    type: ['Task'],
    authScopes: { authenticated: true },
    subscribe: async function* (_parent, _args, ctx) {
      if (!ctx.user) return;
      const userId = ctx.user.id;
      yield null; // baseline
      for await (const _ of taskPubSub.iterateUser(userId)) {
        yield null;
      }
    },
    resolve: (query, _parent, _args, ctx) => {
      return ctx.prisma.task.findMany({
        ...query,
        where: { userId: ctx.user?.id },
        orderBy: { createdAt: 'desc' },
      });
    },
  })
);
