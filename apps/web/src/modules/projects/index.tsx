'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/common/empty-state';
import { AppShell } from '@/components/layout/app-shell';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ProjectCard } from './components/project-card';
import { repoLang } from './libs';
import { useService } from './use-service';

export function Projects() {
  const { loading, projects } = useService();

  return (
    <AppShell>
      <PageHeader
        segments={[{ label: 'Projects' }]}
        actions={
          <Button size="sm" asChild className="h-8">
            <Link href="/projects/new">
              <Plus className="mr-1 h-3.5 w-3.5" />
              Connect repo
            </Link>
          </Button>
        }
      />

      <div className="px-6 py-6 lg:px-7 lg:py-7">
        <div className="mb-6">
          <div className="mb-1.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-foreground-subtle">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-foreground-faint" />
            repositories
          </div>
          <h1 className="text-[26px] font-semibold leading-[1.05] tracking-normal text-foreground">
            Connected repositories
          </h1>
          <p className="mt-1.5 text-[12.5px] text-foreground-muted">
            <span className="font-mono tabular-nums text-foreground">
              {String(projects.length).padStart(2, '0')}
            </span>{' '}
            {projects.length === 1 ? 'repository' : 'repositories'} ready for
            agent execution.
          </p>
        </div>

        {loading && projects.length === 0 ? (
          <div className="rounded-md border border-border bg-surface px-6 py-12 text-center text-[12px] text-foreground-subtle">
            Loading projects…
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-md border border-border bg-surface px-6 py-10">
            <EmptyState
              title="No projects yet"
              description="Connect a repository to start resolving defects with Codewright."
              action={
                <Button size="sm" asChild>
                  <Link href="/projects/new">Create your first project</Link>
                </Button>
              }
            />
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={{
                  id: p.id,
                  name: p.name,
                  repositoryUrl: p.repositoryUrl,
                  authMethod: p.authMethod,
                  updatedAt: p.updatedAt,
                  taskCount: 0,
                  openCount: 0,
                  runningCount: 0,
                  awaitingCount: 0,
                  successRate: null,
                  trend: [],
                  lang: repoLang(p.repositoryUrl),
                }}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
