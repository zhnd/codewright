import type { PrismaClient } from '@codewright/database';
import { decrypt, encrypt, getEncryptionKey } from '@codewright/shared';
import type { User } from 'better-auth';
import {
  AppError,
  UnauthorizedError,
  ValidationError,
} from '../../../infrastructure/errors/app-error.js';
import { log } from '../../../logger.js';
import { TapdApiError, TapdClient } from '../client.js';
import type { SetTapdCredentialInput } from '../dto/set-tapd-credential.input.js';

export interface TapdCredentialStatusView {
  configured: boolean;
  /** Tapd login handle (UserWorkspace.user) — null when not configured. */
  tapdNick: string | null;
}

export interface DecryptedTapdCredential {
  tapdNick: string;
  accessToken: string;
}

export class TapdCredentialService {
  constructor(private prisma: PrismaClient) {}

  async status(user: User | null): Promise<TapdCredentialStatusView> {
    if (!user) throw new UnauthorizedError();
    const row = await this.prisma.tapdCredential.findUnique({
      where: { userId: user.id },
    });
    if (!row) {
      return { configured: false, tapdNick: null };
    }
    return {
      configured: true,
      tapdNick: row.tapdNick,
    };
  }

  async set(
    input: typeof SetTapdCredentialInput.$inferInput,
    user: User | null
  ): Promise<TapdCredentialStatusView> {
    if (!user) throw new UnauthorizedError();
    const accessToken = input.accessToken.trim();
    if (!accessToken) {
      throw new ValidationError('accessToken is required');
    }

    const client = new TapdClient(accessToken);
    client.onRawResponse = (path, body) => {
      log.debug({ path, body }, 'tapd raw response (credential probe)');
    };

    const handle = await this.resolveHandle(client);

    const encryptedSecret = encrypt(accessToken, getEncryptionKey());
    await this.prisma.tapdCredential.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        encryptedSecret,
        tapdNick: handle,
      },
      update: {
        encryptedSecret,
        tapdNick: handle,
      },
    });

    log.info({ userId: user.id, nick: handle }, 'tapd credential saved');
    return this.status(user);
  }

  async remove(user: User | null): Promise<boolean> {
    if (!user) throw new UnauthorizedError();
    await this.prisma.tapdCredential.deleteMany({
      where: { userId: user.id },
    });
    return true;
  }

  async loadDecrypted(
    user: User | null
  ): Promise<DecryptedTapdCredential | null> {
    if (!user) throw new UnauthorizedError();
    const row = await this.prisma.tapdCredential.findUnique({
      where: { userId: user.id },
    });
    if (!row) return null;
    return {
      tapdNick: row.tapdNick ?? '',
      accessToken: decrypt(row.encryptedSecret, getEncryptionKey()),
    };
  }

  /**
   * Three-call discovery to find the user's canonical Tapd handle:
   *   1. /users/info → my email + display nick
   *   2. /workspaces/user_participant_projects → list of workspaces
   *   3. /workspaces/users?workspace_id=X → walk members, match by email
   *
   * The matched `UserWorkspace.user` is the handle bug `current_owner`
   * references (e.g. "Andy"). Falls back to display nick if no
   * workspace member matches our email.
   */
  private async resolveHandle(client: TapdClient): Promise<string> {
    try {
      const info = await client.getUserInfo();
      if (!info.email) {
        throw new ValidationError(
          'Tapd accepted the credential but returned no email — cannot match member record.'
        );
      }
      const probeNick = info.nick || info.name || '';
      const workspaces = await client.listWorkspaces(probeNick);
      if (workspaces.length === 0) {
        throw new ValidationError(
          'Tapd accepted the credential but the user participates in no workspaces.'
        );
      }
      // Walk every workspace's member list in parallel — Tapd has no
      // cross-workspace "find me by email" endpoint, so we have to ask
      // each workspace separately. Pick the first match (any workspace
      // exposes the same canonical handle).
      const probes = await Promise.all(
        workspaces.map(async (ws) => ({
          workspaceId: ws.id,
          member: await client.findMemberByEmail(ws.id, info.email),
        }))
      );
      const hit = probes.find((p) => p.member?.user);
      const matched = hit?.member ?? null;
      const probedWorkspace = hit?.workspaceId ?? null;
      const handle = matched?.user || info.nick || info.name || '';
      log.info(
        {
          tapdUserId: info.id,
          email: info.email,
          probedWorkspace,
          matchedHandle: matched?.user,
          chosenHandle: handle,
        },
        'tapd handle resolved'
      );
      if (!handle) {
        throw new ValidationError(
          'Tapd accepted the credential but returned no usable handle — try regenerating the token.'
        );
      }
      return handle;
    } catch (err) {
      if (err instanceof TapdApiError) {
        throw new AppError(
          `Tapd rejected the credential: ${err.message}`,
          'TAPD_AUTH_FAILED',
          400
        );
      }
      throw err;
    }
  }
}
