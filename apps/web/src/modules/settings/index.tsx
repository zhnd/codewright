'use client';

import { LockKeyhole, ShieldCheck, UserRound } from 'lucide-react';
import { MetaRow } from '@/components/common/meta-row';
import { PanelCard } from '@/components/common/panel-card';
import { AppShell } from '@/components/layout/app-shell';
import { PageHeader } from '@/components/layout/page-header';
import { PasswordForm } from './components/password-form';
import { ProfileForm } from './components/profile-form';
import { TapdCredentialCard } from './components/tapd-credential-card';
import { useService } from './use-service';

export function Settings() {
  const { user } = useService();

  return (
    <AppShell>
      <PageHeader segments={[{ label: 'Settings' }]} />

      <div className="px-6 py-6 lg:px-7 lg:py-7">
        <div className="mb-6">
          <div className="mb-1.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-foreground-subtle">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-foreground-faint" />
            account settings
          </div>
          <h1 className="text-[26px] font-semibold leading-[1.05] tracking-normal text-foreground">
            Account & preferences
          </h1>
          <p className="mt-1.5 text-[12.5px] text-foreground-muted">
            Account, profile, and authentication for Codewright.
          </p>
        </div>

        <div className="grid max-w-290 grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
          <aside className="xl:sticky xl:top-18 xl:self-start">
            <PanelCard
              title="Account snapshot"
              caption="account identity"
              noPad
            >
              <div className="p-4">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[14px] font-semibold text-accent-ink">
                    {user?.name?.charAt(0)?.toUpperCase() ?? 'U'}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-foreground">
                      {user?.name ?? 'User'}
                    </div>
                    <div className="truncate font-mono text-[10.5px] text-foreground-subtle">
                      {user?.email ?? 'loading'}
                    </div>
                  </div>
                </div>

                {user ? (
                  <div className="rounded-md border border-border bg-surface px-3 py-1">
                    <MetaRow label="Name" value={user.name ?? '—'} />
                    <MetaRow label="Email" value={user.email ?? '—'} mono />
                    <MetaRow label="User ID" value={user.id ?? '—'} mono last />
                  </div>
                ) : (
                  <div className="rounded-md border border-border bg-surface px-3 py-3 text-[12px] text-foreground-subtle">
                    Loading account…
                  </div>
                )}

                <div className="mt-4 rounded-md border border-border-faint bg-surface-2 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-3.5 w-3.5 text-accent" />
                    <span className="text-[12px] font-semibold text-foreground">
                      Protected account
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-foreground-subtle">
                    Profile and credential changes apply only to this Codewright
                    account.
                  </p>
                </div>
              </div>
            </PanelCard>
          </aside>

          <div className="space-y-4">
            <PanelCard
              title="Profile"
              caption="display identity"
              index="01"
              className="scroll-mt-18"
            >
              <div className="mb-4 flex items-start gap-3 border-b border-border-faint pb-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-foreground-muted">
                  <UserRound className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="m-0 text-[14px] font-semibold text-foreground">
                    Public profile
                  </h2>
                  <p className="m-0 mt-1 text-[12px] text-foreground-muted">
                    This name appears in review decisions and activity.
                  </p>
                </div>
              </div>
              <ProfileForm defaultName={user?.name ?? ''} />
            </PanelCard>

            <PanelCard
              title="Security"
              caption="password"
              index="02"
              className="scroll-mt-18"
            >
              <div className="mb-4 flex items-start gap-3 border-b border-border-faint pb-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-foreground-muted">
                  <LockKeyhole className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="m-0 text-[14px] font-semibold text-foreground">
                    Password
                  </h2>
                  <p className="m-0 mt-1 text-[12px] text-foreground-muted">
                    Use a strong password you do not reuse elsewhere.
                  </p>
                </div>
              </div>
              <PasswordForm />
            </PanelCard>

            <TapdCredentialCard />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
