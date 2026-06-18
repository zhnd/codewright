import type { TapdBug } from '@codewright/domain';

const DEFAULT_API_BASE = 'https://api.tapd.cn';
const DEFAULT_TAPD_BASE = 'https://www.tapd.cn';
/**
 * Tapd `/bugs` enforces `limit ≤ 200` and pages through with `page=N`.
 * Owner filter is pushed to Tapd (`current_owner=`), so per-workspace
 * result sets are small — 5 pages × 100 = 500 covers any realistic
 * single-user open-bug count.
 */
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

export interface TapdUserInfo {
  /** Tapd internal user id (numeric string). */
  id: string;
  /** Display name (often Chinese). */
  name: string;
  /** Same as name in most tenants. */
  nick: string;
  /** Email associated with the Tapd account, if any. */
  email: string;
}

export interface TapdMember {
  /**
   * Login handle Tapd uses in `current_owner` on bug records (e.g.
   * "Andy"). Comes from `UserWorkspace.user`.
   */
  user: string;
  /**
   * Real / display name from `UserWorkspace.name` (often empty or a
   * Chinese full name).
   */
  name: string;
  /** Email — used to match the current user against the member list. */
  email: string;
}

export interface TapdWorkspace {
  id: string;
  name: string;
}

export class TapdApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'TapdApiError';
  }
}

/**
 * Tiny access-token-only Tapd client. Wraps just the four endpoints the
 * inbox needs:
 *   - GET /users/info                                 → who am I (returns
 *     id + email; the display nick is often Chinese and not the handle
 *     used in bug `current_owner`)
 *   - GET /workspaces/user_participant_projects?nick  → my workspaces
 *   - GET /workspaces/users?workspace_id=X            → workspace members
 *     (used during credential save to discover the user's real handle by
 *     matching on email)
 *   - GET /bugs?workspace_id=X&current_owner=<handle> → bugs assigned to
 *     me in that workspace (status filter is applied client-side because
 *     Tapd's `status=` only supports positive enumeration, not NOT-IN)
 */
export class TapdClient {
  /** Optional hook to inspect raw response bodies (for debugging). */
  public onRawResponse?: (path: string, body: string) => void;

  constructor(
    private readonly accessToken: string,
    private readonly apiBase: string = DEFAULT_API_BASE,
    private readonly tapdBase: string = DEFAULT_TAPD_BASE
  ) {}

  async getUserInfo(): Promise<TapdUserInfo> {
    const data = await this.get<RawUser | null>('/users/info');
    return {
      id: String(data?.id ?? ''),
      name: data?.name ?? '',
      nick: data?.nick ?? '',
      email: data?.email ?? data?.user_email ?? '',
    };
  }

  /**
   * List every member of a workspace via `/workspaces/users`
   * (`workspace#r` scope — what a normal PAT has, unlike `/users` which
   * needs `user#r`). Each entry's `user` field is the canonical handle
   * Tapd uses in `current_owner` on bug records (e.g. "Andy"), not the
   * Chinese display name `/users/info` returns.
   */
  async listWorkspaceMembers(workspaceId: string): Promise<TapdMember[]> {
    const params = new URLSearchParams({
      workspace_id: workspaceId,
      fields: 'user,name,email',
    });
    const data = await this.get<RawMemberEntry[] | null>(
      `/workspaces/users?${params.toString()}`
    );
    return (data ?? [])
      .map((entry) => entry?.UserWorkspace)
      .filter((u): u is RawWorkspaceMember => Boolean(u))
      .map((raw) => ({
        user: raw.user ?? '',
        name: raw.name ?? '',
        email: raw.email ?? '',
      }));
  }

  /**
   * Find a single member by email (case-insensitive). The
   * `/workspaces/users` response carries no user id, so email is the
   * only stable identifier shared with `/users/info`.
   */
  async findMemberByEmail(
    workspaceId: string,
    email: string
  ): Promise<TapdMember | null> {
    if (!email) return null;
    const target = email.toLowerCase();
    const members = await this.listWorkspaceMembers(workspaceId);
    return (
      members.find((m) => (m.email ?? '').toLowerCase() === target) ?? null
    );
  }

  /** Workspaces (projects) the user participates in. Excludes the
   *  org-level "company" entries which Tapd returns alongside projects. */
  async listWorkspaces(nick: string): Promise<TapdWorkspace[]> {
    if (!nick) return [];
    const data = await this.get<RawWorkspaceEntry[] | null>(
      `/workspaces/user_participant_projects?nick=${encodeURIComponent(nick)}`
    );
    return (data ?? [])
      .map((entry) => entry?.Workspace)
      .filter((w): w is RawWorkspace => Boolean(w))
      .filter((w) => w.category !== 'organization')
      .map((w) => ({ id: String(w.id), name: w.name ?? '' }));
  }

  /**
   * Bugs in a workspace owned by `currentOwner`, paginated. Tapd's
   * `current_owner=` filter matches any token in the bug's
   * `;`-delimited owner list (so `current_owner=Andy` returns
   * `"Andy;Domi;"` too). Status filter stays in JS — Tapd's `status=`
   * only supports positive enumeration, not NOT-IN.
   */
  async listBugs(
    workspaceId: string,
    currentOwner: string
  ): Promise<TapdBug[]> {
    const all: TapdBug[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const params = new URLSearchParams({
        workspace_id: workspaceId,
        current_owner: currentOwner,
        limit: String(PAGE_SIZE),
        page: String(page),
        order: 'created desc',
      });
      const data = await this.get<RawBugEntry[] | null>(
        `/bugs?${params.toString()}`
      );
      const batch = (data ?? [])
        .map((entry) => entry?.Bug)
        .filter((b): b is RawBug => Boolean(b))
        .map((b) => this.toBug(b, workspaceId));
      all.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return all;
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.apiBase}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: 'application/json',
        },
      });
    } catch (err) {
      throw new TapdApiError(
        `Tapd request failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const body = await res.text();
    this.onRawResponse?.(path, body.slice(0, 2000));
    if (!res.ok) {
      throw new TapdApiError(
        `Tapd ${path} → HTTP ${res.status}: ${body.slice(0, 500)}`,
        res.status
      );
    }
    let payload: TapdEnvelope<T>;
    try {
      payload = JSON.parse(body) as TapdEnvelope<T>;
    } catch (err) {
      throw new TapdApiError(
        `Tapd ${path} returned non-JSON: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    if (payload.status !== 1) {
      throw new TapdApiError(
        `Tapd ${path} status=${payload.status} info=${payload.info ?? 'unknown'}`,
        payload.status
      );
    }
    return payload.data;
  }

  private toBug(raw: RawBug, fallbackWorkspaceId?: string): TapdBug {
    const workspaceId = String(raw.workspace_id ?? fallbackWorkspaceId ?? '');
    return {
      id: String(raw.id),
      workspaceId,
      // Caller (TapdBugsService) overlays the workspace name once it
      // knows which workspace this batch came from.
      workspaceName: null,
      title: raw.title ?? '',
      description: stripHtml(raw.description ?? ''),
      status: raw.status ?? 'unknown',
      priority: raw.priority_label ?? raw.priority ?? null,
      currentOwner: raw.current_owner ?? null,
      url: workspaceId
        ? `${this.tapdBase}/${workspaceId}/bugtrace/bugs/view/${raw.id}`
        : `${this.tapdBase}/bugs/view/${raw.id}`,
      createdAt: raw.created ?? '',
    };
  }
}

function stripHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface TapdEnvelope<T> {
  status: number;
  info?: string;
  data: T;
}

interface RawUser {
  id?: string | number;
  nick?: string;
  name?: string;
  email?: string;
  user_email?: string;
}

interface RawWorkspaceEntry {
  Workspace?: RawWorkspace;
}
interface RawWorkspace {
  id: string | number;
  name?: string;
  category?: string;
}

interface RawMemberEntry {
  UserWorkspace?: RawWorkspaceMember;
}

interface RawWorkspaceMember {
  /** The login handle bug `current_owner` uses (e.g. "Andy"). */
  user?: string;
  /** Real / display name (often empty or Chinese). */
  name?: string;
  email?: string | null;
}

interface RawBugEntry {
  Bug?: RawBug;
}
interface RawBug {
  id: string | number;
  workspace_id?: string | number;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  priority_label?: string;
  current_owner?: string;
  created?: string;
}
