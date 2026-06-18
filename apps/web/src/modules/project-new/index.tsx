'use client';

import { PanelCard } from '@/components/common/panel-card';
import { AppShell } from '@/components/layout/app-shell';
import { PageHeader } from '@/components/layout/page-header';
import { ProjectForm } from '@/components/project-form';

export function ProjectNew() {
  return (
    <AppShell>
      <PageHeader
        segments={[
          { label: 'Projects', href: '/projects' },
          { label: 'Connect repository' },
        ]}
      />

      <div className="mx-auto max-w-200 px-6 py-6 lg:px-7 lg:py-7">
        <div className="mb-6">
          <div className="mb-1.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-foreground-subtle">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
            repository setup
          </div>
          <h1 className="text-[24px] font-semibold leading-[1.1] tracking-normal text-foreground">
            Connect a repository
          </h1>
          <p className="mt-1.5 text-[12.5px] text-foreground-muted">
            Point Codewright at a GitHub or cnb.cool repository so it can
            analyze, patch, and open pull requests.
          </p>
        </div>

        <PanelCard title="Repository details">
          <ProjectForm mode="create" />
        </PanelCard>
      </div>
    </AppShell>
  );
}
