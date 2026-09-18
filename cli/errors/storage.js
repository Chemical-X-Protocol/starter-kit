import fs from 'node:fs';
import path from 'node:path';
import { detectGitRepoInfo } from '../audit/social-git.js';

const DEFAULT_REPO = 'Chemical-X-Protocol/starter-kit';

export const resolveTargetIssuesRepo = (options = {}, cwd = process.cwd()) => {
  if (options.repo) return options.repo;
  if (process.env.CHEMX_ISSUES_REPO) return process.env.CHEMX_ISSUES_REPO;

  const repoInfo = detectGitRepoInfo(cwd);
  const hasOwnerAndRepo = Boolean(repoInfo?.owner && repoInfo?.repo);
  const isNotDefault = repoInfo?.owner !== 'default';
  const isGitHubRepo = hasOwnerAndRepo && isNotDefault;
  if (isGitHubRepo) return repoInfo.nameWithOwner;

  return DEFAULT_REPO;
};

export const saveIssueArtifact = (cwd, issue, options = {}) => {
  if (options.skipFileWrite) {
    return null;
  }
  try {
    const issuesDir = path.resolve(cwd, '.chemx', 'issues');
    if (!fs.existsSync(issuesDir)) {
      fs.mkdirSync(issuesDir, { recursive: true });
    }
    const filename = `issue-${Date.now()}.md`;
    const artifactPath = path.join(issuesDir, filename);
    const lastIssuePath = path.join(issuesDir, 'last-error-issue.md');

    fs.writeFileSync(artifactPath, issue.body, 'utf-8');
    fs.writeFileSync(lastIssuePath, issue.body, 'utf-8');
    return artifactPath;
  } catch {
    return null;
  }
};
