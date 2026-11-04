/**
 * Thin, pure fetch-based wrapper around GitHub's Contents REST API, scoped
 * to files under `content/blog/` on one repo/branch. Lets a later task's
 * route handlers read/write/delete blog post markdown files without knowing
 * anything about HTTP or GitHub's request/response shapes.
 *
 * All five exported functions read BLOG_GITHUB_TOKEN/BLOG_GITHUB_REPO/
 * BLOG_GITHUB_BRANCH from process.env fresh on every call (never cached at
 * module load) so a missing var always produces a correct error, and so a
 * later task's own tests can delete/restore these env vars between cases.
 */

const GITHUB_API_BASE = 'https://api.github.com';

export class BlogGitHubError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'BlogGitHubError';
  }
}

export interface BlogFileListing {
  name: string;
  sha: string;
}

export interface BlogFileContent {
  path: string;
  sha: string;
  content: string;
}

interface BlogGitHubConfig {
  token: string;
  repo: string;
  branch: string;
}

function requireBlogGitHubConfig(): BlogGitHubConfig {
  const token = process.env.BLOG_GITHUB_TOKEN;
  if (!token) {
    throw new Error('Missing required environment variable: BLOG_GITHUB_TOKEN');
  }
  const repo = process.env.BLOG_GITHUB_REPO;
  if (!repo) {
    throw new Error('Missing required environment variable: BLOG_GITHUB_REPO');
  }
  const branch = process.env.BLOG_GITHUB_BRANCH;
  if (!branch) {
    throw new Error('Missing required environment variable: BLOG_GITHUB_BRANCH');
  }
  return { token, repo, branch };
}

function contentsUrl(repo: string, path: string): string {
  return `${GITHUB_API_BASE}/repos/${repo}/contents/${path}`;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
  };
}

export async function listBlogFiles(): Promise<BlogFileListing[]> {
  const { token, repo, branch } = requireBlogGitHubConfig();
  const res = await fetch(`${contentsUrl(repo, 'content/blog')}?ref=${branch}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new BlogGitHubError(body?.message ?? `GitHub request failed (${res.status})`, res.status);
  }
  const body = await res.json();
  const entries = Array.isArray(body) ? body : [];
  return entries
    .filter((entry: { name?: unknown }) => typeof entry?.name === 'string' && entry.name.endsWith('.md'))
    .map((entry: { name: string; sha: string }) => ({ name: entry.name, sha: entry.sha }));
}

export async function getBlogFile(filename: string): Promise<BlogFileContent> {
  const { token, repo, branch } = requireBlogGitHubConfig();
  const res = await fetch(`${contentsUrl(repo, `content/blog/${filename}`)}?ref=${branch}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    if (res.status === 404) {
      throw new BlogGitHubError(`${filename} not found`, 404);
    }
    const body = await res.json().catch(() => ({}));
    throw new BlogGitHubError(body?.message ?? `GitHub request failed (${res.status})`, res.status);
  }
  const body = await res.json();
  return {
    path: body.path,
    sha: body.sha,
    content: Buffer.from(body.content, 'base64').toString('utf8'),
  };
}

async function putBlogFile(filename: string, content: string, message: string, sha: string | undefined): Promise<void> {
  const { token, repo, branch } = requireBlogGitHubConfig();
  const res = await fetch(contentsUrl(repo, `content/blog/${filename}`), {
    method: 'PUT',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      ...(sha ? { sha } : {}),
      branch,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new BlogGitHubError(body?.message ?? `GitHub request failed (${res.status})`, res.status);
  }
}

export async function createBlogFile(filename: string, content: string, message: string): Promise<void> {
  return putBlogFile(filename, content, message, undefined);
}

export async function updateBlogFile(filename: string, content: string, sha: string, message: string): Promise<void> {
  return putBlogFile(filename, content, message, sha);
}

export async function deleteBlogFile(filename: string, sha: string, message: string): Promise<void> {
  const { token, repo, branch } = requireBlogGitHubConfig();
  const res = await fetch(contentsUrl(repo, `content/blog/${filename}`), {
    method: 'DELETE',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, sha, branch }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new BlogGitHubError(body?.message ?? `GitHub request failed (${res.status})`, res.status);
  }
}
