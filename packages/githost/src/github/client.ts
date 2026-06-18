import type { PullRequestResult } from '@codewright/domain';
import { Octokit } from '@octokit/rest';
import { firstAddedLinePosition } from '../diff-position.js';
import type {
  AddReviewCommentsArgs,
  BotIdentity,
  CreatePullRequestArgs,
  GitHostClient,
  GitHostProvider,
  ParsedRepo,
} from '../interface.js';

export interface GitHubClientOptions {
  token: string;
  repo: ParsedRepo;
  botIdentity: BotIdentity;
}

export class GitHubClient implements GitHostClient {
  readonly provider: GitHostProvider = 'github';
  readonly repo: ParsedRepo;
  readonly botIdentity: BotIdentity;
  readonly token: string;
  private readonly octokit: Octokit;

  constructor(opts: GitHubClientOptions) {
    this.repo = opts.repo;
    this.botIdentity = opts.botIdentity;
    this.token = opts.token;
    this.octokit = new Octokit({ auth: opts.token });
  }

  async createPullRequest(
    args: CreatePullRequestArgs
  ): Promise<PullRequestResult> {
    const { data } = await this.octokit.pulls.create({
      owner: this.repo.owner,
      repo: this.repo.repo,
      head: args.head,
      base: args.base,
      title: args.title,
      body: args.body,
    });
    return { url: data.html_url, number: data.number };
  }

  async listBranches(): Promise<string[]> {
    const { data: repoInfo } = await this.octokit.repos.get({
      owner: this.repo.owner,
      repo: this.repo.repo,
    });
    const defaultBranch = repoInfo.default_branch;

    const branches = await this.octokit.paginate(
      this.octokit.repos.listBranches,
      {
        owner: this.repo.owner,
        repo: this.repo.repo,
        per_page: 100,
      }
    );
    const names = branches.map((b) => b.name);

    const idx = names.indexOf(defaultBranch);
    if (idx > 0) {
      names.splice(idx, 1);
      names.unshift(defaultBranch);
    } else if (idx === -1 && defaultBranch) {
      names.unshift(defaultBranch);
    }
    return names;
  }

  async addReviewComments(args: AddReviewCommentsArgs): Promise<void> {
    const { data: files } = await this.octokit.pulls.listFiles({
      owner: this.repo.owner,
      repo: this.repo.repo,
      pull_number: args.pullNumber,
    });

    const comments: { path: string; body: string; position: number }[] = [];
    for (const change of args.changes) {
      const prFile = files.find((f) => f.filename === change.file);
      if (!prFile?.patch) continue;
      const position = firstAddedLinePosition(prFile.patch);
      if (position == null) continue;
      comments.push({
        path: change.file,
        body: `🤖 **Codewright:** ${change.description}`,
        position,
      });
    }

    if (comments.length === 0) return;

    await this.octokit.pulls.createReview({
      owner: this.repo.owner,
      repo: this.repo.repo,
      pull_number: args.pullNumber,
      event: 'COMMENT',
      comments,
    });
  }
}
