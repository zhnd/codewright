'use client';

import {
  Ban,
  Copy,
  ExternalLink,
  MoreHorizontal,
  RotateCcw,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface HeaderActionsProps {
  taskId: string;
  /** Mapped execution status: 'queued' | 'running' | 'completed' | 'failed'. */
  status: string;
  prUrl?: string | null;
  onCancel: () => void;
  canceling: boolean;
  onRetry: () => void;
  retrying: boolean;
}

/**
 * Top-right control surface for a task. A dedicated Cancel button appears
 * only while the task is in flight (the single most likely action at that
 * moment); everything else lives behind the overflow (⋯) menu. Cancel
 * routes through a confirmation dialog because it terminates the underlying
 * Temporal workflow irreversibly.
 */
export function HeaderActions({
  taskId,
  status,
  prUrl,
  onCancel,
  canceling,
  onRetry,
  retrying,
}: HeaderActionsProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const cancellable = status === 'running' || status === 'queued';
  const retryable = status === 'failed';

  const copyId = () => {
    navigator.clipboard.writeText(taskId);
    toast.success('Task ID copied');
  };

  return (
    <div className="flex items-center gap-1.5">
      {cancellable && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfirmOpen(true)}
          className="text-danger hover:text-danger"
        >
          <Ban className="h-3.5 w-3.5" />
          Cancel
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title="More actions"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {retryable && (
            <DropdownMenuItem
              onSelect={onRetry}
              disabled={retrying}
              className="focus:[&_svg:not([class*='text-'])]:text-white"
            >
              <RotateCcw />
              {retrying ? 'Retrying…' : 'Retry task'}
            </DropdownMenuItem>
          )}
          {prUrl && (
            <DropdownMenuItem
              onSelect={() => window.open(prUrl, '_blank', 'noopener')}
              className="focus:[&_svg:not([class*='text-'])]:text-white"
            >
              <ExternalLink />
              Open pull request
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={copyId}
            className="focus:[&_svg:not([class*='text-'])]:text-white"
          >
            <Copy />
            Copy task ID
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel this task?</DialogTitle>
            <DialogDescription>
              This stops the running workflow and cannot be undone. The task
              will be marked as cancelled.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Keep running
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={canceling}
              onClick={() => {
                onCancel();
                setConfirmOpen(false);
              }}
            >
              {canceling ? 'Cancelling…' : 'Cancel task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
