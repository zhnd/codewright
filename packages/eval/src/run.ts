/**
 * SWE-bench Verified eval — generation side.
 *
 * Loads a subset of SWE-bench Verified, drives Codewright's resolveDefect on
 * each instance @ base_commit (auto-approving HITL), extracts the source
 * patch, and writes predictions.jsonl. Scoring is done in the cloud via
 * sb-cli (printed at the end) — no local Docker, no 120GB.
 *
 * Usage:
 *   pnpm --filter @codewright/eval eval [limit]
 * Env:
 *   SWE_LIMIT             number of instances (default 20)
 *   SWE_PREDICTIONS       output path (default predictions.jsonl)
 *   EVAL_PROJECT_ID       project to attribute tasks to (else first project)
 *
 * Requires: worker + Temporal + Postgres running on the current branch.
 */
import { writeFileSync } from 'node:fs';
import { prisma } from '@codewright/database';
import { loadSweBenchVerified } from './dataset.js';
import { generateForInstance } from './generate.js';
import { scoreWithSbCli } from './score.js';

async function main(): Promise<void> {
  const limit = Number(process.env.SWE_LIMIT ?? process.argv[2] ?? 20);
  const outPath = process.env.SWE_PREDICTIONS ?? 'predictions.jsonl';

  const explicitId = process.env.EVAL_PROJECT_ID;
  const project = explicitId
    ? await prisma.project.findUnique({
        where: { id: explicitId },
        select: { id: true, userId: true },
      })
    : await prisma.project.findFirst({
        select: { id: true, userId: true },
        orderBy: { createdAt: 'asc' },
      });
  if (!project?.userId) {
    console.error(
      'No eval project with a userId. Set EVAL_PROJECT_ID to a registered project.'
    );
    process.exit(1);
  }

  console.log(`Loading ${limit} SWE-bench Verified instances…`);
  const instances = await loadSweBenchVerified(limit);
  console.log(`Generating patches for ${instances.length} instances…\n`);

  const lines: string[] = [];
  let withPatch = 0;
  for (const inst of instances) {
    process.stdout.write(`▶ ${inst.instanceId} … `);
    try {
      const r = await generateForInstance({
        instance: inst,
        projectId: project.id,
        userId: project.userId,
      });
      const patch = r.modelPatch ?? '';
      if (patch) withPatch++;
      lines.push(
        JSON.stringify({
          instance_id: inst.instanceId,
          model_name_or_path: 'codewright',
          model_patch: patch,
        })
      );
      console.log(`${patch ? 'patch✓' : 'patch✗'} (${r.status})`);
    } catch (err) {
      console.log(`💥 ${err instanceof Error ? err.message : String(err)}`);
      lines.push(
        JSON.stringify({
          instance_id: inst.instanceId,
          model_name_or_path: 'codewright',
          model_patch: '',
        })
      );
    }
  }

  writeFileSync(outPath, `${lines.join('\n')}\n`);
  console.log(
    `\nWrote ${lines.length} predictions (${withPatch} with a patch) → ${outPath}`
  );

  await prisma.$disconnect();

  // Score in the cloud (sb-cli via uvx). Prints resolved% itself; no-op
  // with guidance when SWEBENCH_API_KEY / uv are missing.
  scoreWithSbCli(outPath, `codewright-${Date.now()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
