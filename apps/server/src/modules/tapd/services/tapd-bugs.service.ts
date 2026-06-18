import type { PrismaClient } from '@codewright/database';
import type { TapdBug } from '@codewright/domain';
import type { User } from 'better-auth';
import { UnauthorizedError } from '../../../infrastructure/errors/app-error.js';
import { log } from '../../../logger.js';
import { TapdApiError, TapdClient } from '../client.js';
import { TapdCredentialService } from './tapd-credential.service.js';

export class TapdBugsService {
  private readonly credentials: TapdCredentialService;

  constructor(prisma: PrismaClient) {
    this.credentials = new TapdCredentialService(prisma);
  }

  /**
   * Two-step fetch:
   *   1. List the user's workspaces.
   *   2. Per workspace, GET /bugs?current_owner=<handle> — Tapd does the
   *      owner filter, we drop closed/resolved statuses client-side.
   *
   * Per-workspace failures are logged but don't abort the whole inbox.
   */
  async listAssigned(user: User | null): Promise<TapdBug[]> {
    if (!user) throw new UnauthorizedError();
    const decrypted = await this.credentials.loadDecrypted(user);
    if (!decrypted?.tapdNick) {
      return [];
    }
    const handle = decrypted.tapdNick;
    const client = new TapdClient(decrypted.accessToken);

    const workspaces = await client.listWorkspaces(handle);
    log.info(
      {
        userId: user.id,
        handle,
        workspaceCount: workspaces.length,
      },
      'tapd workspaces discovered'
    );

    const perWorkspace = await Promise.all(
      workspaces.map(async (ws) => {
        try {
          const fetched = await client.listBugs(ws.id, handle);
          // Stamp the workspace name onto each row so the UI can render
          // it without a second lookup.
          const all = fetched.map((b) => ({ ...b, workspaceName: ws.name }));
          const distinctStatuses = Array.from(
            new Set(all.map((b) => b.status).filter(Boolean))
          );
          // Tapd's status taxonomy is workspace-configurable; drop the
          // well-known terminal slugs case-insensitively.
          const open = all.filter(
            (b) => !CLOSED_STATUSES.has(b.status.toLowerCase())
          );
          log.info(
            {
              workspaceId: ws.id,
              workspaceName: ws.name,
              total: all.length,
              open: open.length,
              distinctStatuses,
            },
            'tapd workspace bug count'
          );
          return open;
        } catch (err) {
          if (err instanceof TapdApiError) {
            log.warn(
              { workspaceId: ws.id, status: err.status, message: err.message },
              'tapd workspace fetch failed (skipping)'
            );
          } else {
            log.warn(
              { err, workspaceId: ws.id },
              'tapd workspace fetch failed (skipping)'
            );
          }
          return [];
        }
      })
    );

    return perWorkspace.flat();
  }
}

/**
 * Tapd status taxonomy is workspace-configurable, but the terminal
 * states map to a handful of well-known slugs across most templates.
 * Match case-insensitively to be safe.
 */
const CLOSED_STATUSES = new Set([
  'closed',
  'resolved',
  'rejected',
  'invalid',
  'fixed',
  'cancelled',
  'canceled',
  'verified',
]);
