import { prisma } from '@codewright/database';
import { WORKFLOW_DEFINITIONS } from '@codewright/workflow';
import { log } from '../logger.js';

/**
 * Seeds `WorkflowDefinition` + `WorkflowStage` rows at server boot.
 * Upserts by `kind`, replaces the stage list in-place if the spec's
 * stage vector differs from what's persisted. Version bumps are
 * explicit in the spec file — we compare to persisted version to know
 * whether to reseed.
 */
export async function seedWorkflowDefinitions(): Promise<void> {
  for (const spec of WORKFLOW_DEFINITIONS) {
    const existing = await prisma.workflowDefinition.findUnique({
      where: { kind: spec.kind },
      include: { stages: { orderBy: { order: 'asc' } } },
    });

    if (existing && existing.version === spec.version) {
      continue;
    }

    if (!existing) {
      await prisma.workflowDefinition.create({
        data: {
          kind: spec.kind,
          displayName: spec.displayName,
          version: spec.version,
          stages: {
            create: spec.stages.map((s) => ({
              name: s.name,
              label: s.label,
              order: s.order,
              allowsRetry: s.allowsRetry ?? true,
              allowsHitl: s.allowsHitl ?? false,
              config: (s.config as object | undefined) ?? undefined,
            })),
          },
        },
      });
      log.info({ kind: spec.kind, version: spec.version }, 'Seeded workflow');
      continue;
    }

    await prisma.$transaction([
      prisma.workflowStage.deleteMany({
        where: { workflowDefinitionId: existing.id },
      }),
      prisma.workflowDefinition.update({
        where: { id: existing.id },
        data: {
          displayName: spec.displayName,
          version: spec.version,
          stages: {
            create: spec.stages.map((s) => ({
              name: s.name,
              label: s.label,
              order: s.order,
              allowsRetry: s.allowsRetry ?? true,
              allowsHitl: s.allowsHitl ?? false,
              config: (s.config as object | undefined) ?? undefined,
            })),
          },
        },
      }),
    ]);
    log.info(
      { kind: spec.kind, from: existing.version, to: spec.version },
      'Reseeded workflow'
    );
  }
}
