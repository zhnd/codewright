'use client';

import { ArrowUpRight, Bug, Settings as SettingsIcon } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/common/empty-state';
import { PanelCard } from '@/components/common/panel-card';
import { AppShell } from '@/components/layout/app-shell';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TriggerDialog } from './components/trigger-dialog';
import type { TapdBugRow, TapdInboxMapping, TapdProjectRef } from './types';
import { useService } from './use-service';

export function TapdInbox() {
  const {
    loading,
    configured,
    tapdNick,
    bugs,
    projects,
    activeBug,
    setActiveBug,
    mapping,
    mapWorkspace,
    getMappingForWorkspace,
  } = useService();

  return (
    <AppShell>
      <PageHeader segments={[{ label: 'Tapd' }]} />

      <div className="px-6 py-6 lg:px-7 lg:py-7">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-1.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-foreground-subtle">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-accent codewright-pulse" />
              tapd · assigned · refresh 30s
            </div>
            <h1 className="text-[26px] font-semibold leading-[1.05] tracking-normal text-foreground">
              My Tapd bugs
            </h1>
            <p className="mt-1.5 text-[12.5px] text-foreground-muted">
              {configured ? (
                <>
                  Connected as{' '}
                  <span className="font-mono text-foreground">@{tapdNick}</span>{' '}
                  · {bugs.length} open
                </>
              ) : (
                <>Connect Tapd in settings to see your bug list here.</>
              )}
            </p>
          </div>
          {!configured && (
            <Button asChild size="sm" variant="default" className="h-8">
              <Link href="/settings">
                <SettingsIcon className="mr-1 h-3.5 w-3.5" />
                Open settings
              </Link>
            </Button>
          )}
        </div>

        <PanelCard
          title="Open bugs assigned to you"
          caption={`${bugs.length} ${bugs.length === 1 ? 'bug' : 'bugs'}`}
          noPad
        >
          <BugList
            loading={loading}
            configured={configured}
            bugs={bugs}
            projects={projects}
            mapping={mapping}
            getMappingForWorkspace={getMappingForWorkspace}
            mapWorkspace={mapWorkspace}
            onResolve={setActiveBug}
          />
        </PanelCard>
      </div>

      <TriggerDialog
        bug={activeBug}
        mapping={
          activeBug ? getMappingForWorkspace(activeBug.workspaceId) : null
        }
        onClose={() => setActiveBug(null)}
      />
    </AppShell>
  );
}

interface BugListProps {
  loading: boolean;
  configured: boolean;
  bugs: TapdBugRow[];
  projects: TapdProjectRef[];
  mapping: boolean;
  getMappingForWorkspace: (workspaceId: string) => TapdInboxMapping | null;
  mapWorkspace: (workspaceId: string, projectId: string) => Promise<void>;
  onResolve: (bug: TapdBugRow) => void;
}

function BugList({
  loading,
  configured,
  bugs,
  projects,
  mapping,
  getMappingForWorkspace,
  mapWorkspace,
  onResolve,
}: BugListProps) {
  if (loading && bugs.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-[12px] text-foreground-subtle">
        Loading bugs…
      </div>
    );
  }
  if (!configured) {
    return (
      <div className="px-4 py-7">
        <EmptyState
          title="Tapd is not connected"
          description="Add your Tapd PAT in Settings to start pulling bugs into Codewright."
        />
      </div>
    );
  }
  if (bugs.length === 0) {
    return (
      <div className="px-4 py-7">
        <EmptyState
          title="Inbox zero"
          description="No open Tapd bugs are assigned to you right now."
        />
      </div>
    );
  }
  return (
    <ol className="divide-y divide-border-faint">
      {bugs.map((bug, i) => {
        const wsMapping = getMappingForWorkspace(bug.workspaceId);
        return (
          <li
            key={bug.id}
            className="flex flex-wrap items-start gap-4 px-4 py-3 transition-colors hover:bg-surface-2"
          >
            <span className="mt-0.5 font-mono text-[10px] tabular-nums text-foreground-faint">
              {String(i + 1).padStart(2, '0')}
            </span>
            <Bug className="mt-0.5 h-4 w-4 shrink-0 text-foreground-subtle" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <a
                  href={bug.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-[13px] font-semibold text-foreground no-underline hover:text-accent"
                >
                  {bug.title || `Bug #${bug.id}`}
                </a>
                <ArrowUpRight className="h-3 w-3 shrink-0 text-foreground-faint" />
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[10.5px] text-foreground-subtle">
                <span>#{bug.id}</span>
                <span aria-hidden="true">·</span>
                <span>{bug.workspaceName ?? `ws ${bug.workspaceId}`}</span>
                <span aria-hidden="true">·</span>
                <span>{bug.status}</span>
                {bug.currentOwner && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>owner={bug.currentOwner}</span>
                  </>
                )}
                {bug.priority && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>p={bug.priority}</span>
                  </>
                )}
                {bug.createdAt && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{bug.createdAt.slice(0, 10)}</span>
                  </>
                )}
              </div>
            </div>

            {wsMapping ? (
              <Button
                size="sm"
                variant="default"
                onClick={() => onResolve(bug)}
              >
                Resolve →
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-[10.5px] text-foreground-subtle">
                  map ws {bug.workspaceId} →
                </span>
                <Select
                  disabled={mapping || projects.length === 0}
                  onValueChange={(v) => mapWorkspace(bug.workspaceId, v)}
                >
                  <SelectTrigger className="h-7 w-44 text-[11.5px]">
                    <SelectValue
                      placeholder={
                        projects.length === 0
                          ? 'No projects yet'
                          : 'pick project'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
