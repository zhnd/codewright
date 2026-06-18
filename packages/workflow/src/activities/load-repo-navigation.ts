import { prisma } from '@codewright/database';
import type { AnalysisResult } from '@codewright/domain';
import { log } from '../logger.js';

/**
 * Fetch the cached repo-navigation snapshot for a project — the output
 * of the most-recent COMPLETED analyze-repository task's ANALYSIS stage
 * event. Threaded into the analyze-defect prompt as a navigation hint
 * on large monorepos.
 *
 * Returns null when no analyze-repository has ever succeeded for this
 * project; the analyze-defect agent then falls back to pure on-demand
 * exploration.
 *
 * Lives in workflow (not server) because:
 *   - It is workflow execution context, not a server-API concern
 *     (`apps/server/CLAUDE.md`: "thin API layer, all execution via
 *     workflow").
 *   - Activities are the determinism boundary — workflow code stays
 *     deterministic, IO happens here.
 *   - Querying at workflow-execution time picks up any
 *     analyze-repository that landed BETWEEN task creation and
 *     workflow start (the server-side variant would have snapshotted
 *     a stale view).
 *   - Keeps `ResolveDefectInput` lean — no 2-3 KB AnalysisResult
 *     riding in the Temporal workflow payload.
 */
export async function loadRepoNavigationActivity(
  projectId: string
): Promise<AnalysisResult | null> {
  const latest = await prisma.task.findFirst({
    where: {
      projectId,
      type: 'ANALYZE_REPOSITORY',
      status: 'COMPLETED',
    },
    orderBy: { completedAt: 'desc' },
    select: {
      id: true,
      events: {
        where: {
          kind: 'STAGE',
          stageKey: 'ANALYSIS',
          status: 'COMPLETED',
        },
        orderBy: { startedAt: 'desc' },
        take: 1,
        select: { output: true },
      },
    },
  });

  const raw = latest?.events[0]?.output;
  if (!raw || typeof raw !== 'object') {
    log.info(
      { projectId },
      'no prior analyze-repository for project; defect-resolve will run without repo navigation map'
    );
    return null;
  }
  log.info(
    { projectId, sourceTaskId: latest.id },
    'loaded repo-navigation snapshot for analyze-defect'
  );
  // Trust the persisted output — the analyze-repository agent's
  // submit_result already validated against analysisResultSchema when
  // it was first written. If schema drifts later, the analyze-defect
  // prompt treats the map as a hint anyway.
  return raw as unknown as AnalysisResult;
}
