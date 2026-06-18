'use client';

import { CheckCircle2, KeyRound } from 'lucide-react';
import { PanelCard } from '@/components/common/panel-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useService } from './use-service';

export function TapdCredentialCard() {
  const {
    loading,
    saving,
    removing,
    configured,
    status,
    accessToken,
    setAccessToken,
    onSave,
    onRemove,
  } = useService();

  return (
    <PanelCard
      title="Tapd"
      caption="bug inbox credential"
      index="03"
      className="scroll-mt-18"
    >
      <div className="mb-4 flex items-start gap-3 border-b border-border-faint pb-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-foreground-muted">
          <KeyRound className="h-4 w-4" />
        </span>
        <div className="flex-1">
          <h2 className="m-0 text-[14px] font-semibold text-foreground">
            Tapd connection
          </h2>
          <p className="m-0 mt-1 text-[12px] text-foreground-muted">
            Paste a Tapd Personal Access Token. Codewright verifies it,
            discovers your login handle from your workspace member record, and
            uses it to fetch bugs assigned to you.
          </p>
        </div>
        {configured && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--ok-soft,oklch(0.94_0.03_150))] px-2 py-0.5 text-[10.5px] font-medium text-[color:var(--ok)]">
            <CheckCircle2 className="h-3 w-3" /> Connected
          </span>
        )}
      </div>

      {configured && status?.tapdNick && (
        <div className="mb-4 rounded-md border border-border bg-surface px-3 py-2.5 text-[12px] text-foreground-muted">
          Connected as{' '}
          <span className="font-mono text-foreground">@{status.tapdNick}</span>
        </div>
      )}

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="tapd-access-token">Personal access token</Label>
          <Input
            id="tapd-access-token"
            type="password"
            autoComplete="off"
            placeholder={
              configured ? '•••••••• (saved — re-enter to change)' : ''
            }
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            disabled={loading}
          />
          <p className="text-[11.5px] text-foreground-subtle">
            Create one in Tapd → 我的设置 → 个人访问令牌.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onSave} disabled={saving || loading}>
            {saving ? 'Verifying…' : configured ? 'Update' : 'Save'}
          </Button>
          {configured && (
            <Button
              variant="ghost"
              onClick={onRemove}
              disabled={removing || loading}
            >
              {removing ? 'Removing…' : 'Remove credential'}
            </Button>
          )}
        </div>
      </div>
    </PanelCard>
  );
}
