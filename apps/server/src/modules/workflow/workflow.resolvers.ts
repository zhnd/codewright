import { TaskStatus, TaskType } from '@codewright/database';
import { builder } from '../../infrastructure/graphql/builder.js';

/**
 * Metadata endpoints the web uses to render filter options, stage
 * labels, and valid action vocabularies without hardcoding anything.
 */

const SelectOption = builder.simpleObject('SelectOption', {
  fields: (t) => ({
    value: t.string(),
    label: t.string(),
  }),
});

builder.queryField('workflowDefinitions', (t) =>
  t.prismaField({
    type: ['WorkflowDefinition'],
    resolve: async (query, _parent, _args, ctx) =>
      ctx.prisma.workflowDefinition.findMany({
        ...query,
        orderBy: { kind: 'asc' },
      }),
  })
);

builder.queryField('workflowDefinition', (t) =>
  t.prismaField({
    type: 'WorkflowDefinition',
    nullable: true,
    args: { kind: t.arg.string({ required: true }) },
    resolve: async (query, _parent, { kind }, ctx) =>
      ctx.prisma.workflowDefinition.findUnique({
        ...query,
        where: { kind },
      }),
  })
);

builder.queryField('taskStatusOptions', (t) =>
  t.field({
    type: [SelectOption],
    resolve: () =>
      (Object.values(TaskStatus) as string[]).map((value) => ({
        value,
        label: humanizeEnum(value),
      })),
  })
);

builder.queryField('taskTypeOptions', (t) =>
  t.field({
    type: [SelectOption],
    resolve: () =>
      (Object.values(TaskType) as string[]).map((value) => ({
        value,
        label: humanizeEnum(value),
      })),
  })
);

function humanizeEnum(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
