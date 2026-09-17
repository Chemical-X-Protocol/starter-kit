import { spawnSync } from 'node:child_process';

export const publishIssueViaHttp = async (token, repo, title, body, labels = []) => {
  const hasBasicInputs = Boolean(token && repo && title);
  const hasRepoSlash = Boolean(repo && repo.includes('/'));
  const isInputValid = hasBasicInputs && hasRepoSlash;
  if (!isInputValid) {
    return { success: false, url: null, issueNumber: null, error: 'Invalid GitHub issue payload' };
  }

  try {
    const url = `https://api.github.com/repos/${repo}/issues`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Chemical-X-Error-Catcher',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title, body, labels })
    });

    const isCreated = response.status === 201;
    if (isCreated) {
      const data = await response.json();
      return { success: true, url: data.html_url, issueNumber: data.number, error: null };
    }

    const errText = await response.text();
    return { success: false, url: null, issueNumber: null, error: `GitHub API error (${response.status}): ${errText}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, url: null, issueNumber: null, error: msg };
  }
};

export const publishIssueViaGh = (repo, title, body, labels = []) => {
  const isInputValid = Boolean(repo && title);
  if (!isInputValid) {
    return { success: false, url: null, issueNumber: null, error: 'Invalid parameters for gh CLI' };
  }

  try {
    const args = ['issue', 'create', '-R', repo, '--title', title, '--body', body];
    for (const label of labels) {
      args.push('--label', label);
    }

    const res = spawnSync('gh', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    const isSuccess = res.status === 0;
    if (isSuccess) {
      const issueUrl = (res.stdout || '').trim();
      const numMatch = issueUrl.match(/\/issues\/(\d+)/);
      const issueNumber = numMatch ? parseInt(numMatch[1], 10) : null;
      return { success: true, url: issueUrl, issueNumber, error: null };
    }

    const errText = (res.stderr || '').trim();
    return { success: false, url: null, issueNumber: null, error: errText || 'Failed to create issue via gh' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, url: null, issueNumber: null, error: msg };
  }
};

export const publishIssue = async (repo, title, body, labels = []) => {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const hasToken = Boolean(token && token.length > 0);
  if (hasToken) {
    const httpRes = await publishIssueViaHttp(token, repo, title, body, labels);
    if (httpRes.success) return httpRes;
  }

  return publishIssueViaGh(repo, title, body, labels);
};
