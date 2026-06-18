import type { PullRequestResult } from '@codewright/domain';
import { getClient } from 'node-cnb';
import { firstAddedLineNumber } from '../diff-position.js';
import type {
  AddReviewCommentsArgs,
  BotIdentity,
  CreatePullRequestArgs,
  GitHostClient,
  GitHostProvider,
  ParsedRepo,
} from '../interface.js';

const DEFAULT_API_BASE = 'https://api.cnb.cool';

export interface CnbClientOptions {
  token: string;
  repo: ParsedRepo;
  botIdentity: BotIdentity;
  /** Override the API base URL (mostly for tests). */
  apiBaseUrl?: string;
}

/**
 * cnb.cool API client, backed by the official `node-cnb` SDK
 * (https://cnb.cool/cnb/sdk/node-cnb).
 *
 * Wire format references the SDK's bundled OpenAPI spec — see node_modules
 * for `node-cnb/dist/paths.json` and the `Api*Form` types in `index.d.mts`.
 */
export class CnbClient implements GitHostClient {
  readonly provider: GitHostProvider = 'cnb';
  readonly repo: ParsedRepo;
  readonly botIdentity: BotIdentity;
  readonly token: string;
  private readonly client: ReturnType<typeof getClient>;
  private readonly repoPath: string;

  constructor(opts: CnbClientOptions) {
    this.repo = opts.repo;
    this.botIdentity = opts.botIdentity;
    this.token = opts.token;
    this.repoPath = opts.repo.pathSegments.join('/');
    this.client = getClient(opts.apiBaseUrl ?? DEFAULT_API_BASE, opts.token);
  }

  async createPullRequest(
    args: CreatePullRequestArgs
  ): Promise<PullRequestResult> {
    // ApiPullCreationForm: {base, body, head, head_repo, title}.
    // head_repo is required even for same-repo PRs (owner/repo format).
    const created = (await this.client.repo.pulls.post({
      repo: this.repoPath,
      post_pull_form: {
        base: args.base,
        body: args.body,
        head: args.head,
        head_repo: this.repoPath,
        title: args.title,
      },
    })) as { number?: string | number } | undefined;

    // The SDK types the create response as `Promise<any>`, but the spec says
    // 201 returns api.Pull (which has a string `number` field). Read it
    // defensively in case the runtime payload differs.
    const numberRaw = created?.number;
    const num =
      typeof numberRaw === 'number'
        ? numberRaw
        : typeof numberRaw === 'string'
          ? Number.parseInt(numberRaw, 10)
          : NaN;
    if (!Number.isFinite(num)) {
      throw new Error(
        `cnb pull create returned no usable number: ${JSON.stringify(created)}`
      );
    }
    // PR web URL isn't on api.Pull. Compose from the canonical repo URL.
    const url = `https://cnb.cool/${this.repoPath}/-/pulls/${num}`;
    return { url, number: num };
  }

  async listBranches(): Promise<string[]> {
    let defaultBranch: string | undefined;
    try {
      const head = await this.client.repo.git.head.get({ repo: this.repoPath });
      defaultBranch = head?.name;
    } catch {
      // Some repos / token scopes may reject the head probe; fall back
      // to "first branch wins" ordering rather than failing the picker.
    }

    const all: string[] = [];
    const PAGE_SIZE = 100;
    const MAX_PAGES = 5; // 500 branches is plenty for a UI dropdown
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await this.client.repo.git.branches.list({
        repo: this.repoPath,
        page,
        page_size: PAGE_SIZE,
      });
      if (!batch || batch.length === 0) break;
      for (const b of batch) all.push(b.name);
      if (batch.length < PAGE_SIZE) break;
    }

    if (defaultBranch) {
      const idx = all.indexOf(defaultBranch);
      if (idx > 0) {
        all.splice(idx, 1);
        all.unshift(defaultBranch);
      } else if (idx === -1) {
        all.unshift(defaultBranch);
      }
    }
    return all;
  }

  async addReviewComments(args: AddReviewCommentsArgs): Promise<void> {
    const files = await this.client.repo.pulls.files.list({
      repo: this.repoPath,
      number: String(args.pullNumber),
    });

    // ApiPullReviewCommentCreationForm uses start_line/end_line in the new
    // file with start_side/end_side, not GitHub's diff-relative position.
    const comments: Array<{
      body: string;
      path: string;
      subject_type: 'line';
      start_line: number;
      end_line: number;
      start_side: 'right';
      end_side: 'right';
    }> = [];

    for (const change of args.changes) {
      const prFile = files.find((f) => f.filename === change.file);
      if (!prFile?.patch) continue;
      const lineNumber = firstAddedLineNumber(prFile.patch);
      if (lineNumber == null) continue;
      comments.push({
        body: `🤖 **Codewright:** ${change.description}`,
        path: change.file,
        subject_type: 'line',
        start_line: lineNumber,
        end_line: lineNumber,
        start_side: 'right',
        end_side: 'right',
      });
    }

    if (comments.length === 0) return;

    await this.client.repo.pulls.reviews.post({
      repo: this.repoPath,
      number: String(args.pullNumber),
      post_pull_review_form: {
        // event uses lowercase: 'approve' | 'comment' | 'request_changes' | 'pending'.
        event: 'comment',
        body: '',
        comments,
      },
    });
  }
}
