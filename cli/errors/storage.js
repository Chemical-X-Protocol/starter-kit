import fs from 'node:fs';
import path from 'node:path';
import { detectGitRepoInfo } from '../audit/social-git.js';

const DEFAULT_REPO = 'Chemical-X-Protocol/starter-kit';
export const MAX_ISSUE_REPORTS = 10;

const pruneOldReports = (issuesDir, keep) => {
  const reports = fs.readdirSync(issuesDir).filter((name) => /^issue-\d+(?:-\d+)?\.md$/.test(name)).sort();
  const excess = reports.slice(0, Math.max(0, reports.length - keep));
  for (const name of excess) fs.rmSync(path.join(issuesDir, name), { force: true });
};

export const resolveTargetIssuesRepo = (options = {}, cwd = process.cwd()) => {
  const hasRepoOption = Boolean(options.repo);
  if (hasRepoOption) return options.repo;
  const hasEnvRepo = Boolean(process.env.CHEMX_ISSUES_REPO);
  if (hasEnvRepo) return process.env.CHEMX_ISSUES_REPO;

  const repoInfo = detectGitRepoInfo(cwd);
  const hasOwnerAndRepo = Boolean(repoInfo?.owner && repoInfo?.repo);
  const isNotDefault = repoInfo?.owner !== 'default';
  const isGitHubRepo = hasOwnerAndRepo && isNotDefault;
  if (isGitHubRepo) return repoInfo.nameWithOwner;

  return DEFAULT_REPO;
};

export const saveIssueArtifact = (cwd, issue, options = {}) => {
  const shouldSkipFileWrite = Boolean(options.skipFileWrite);
  if (shouldSkipFileWrite) {
    return null;
  }
  try {
    const issuesDir = path.resolve(cwd, '.chemx', 'issues');
    const isMissingIssuesDir = !fs.existsSync(issuesDir);
    if (isMissingIssuesDir) {
      fs.mkdirSync(issuesDir, { recursive: true });
    }
    const filename = `issue-${String(Date.now()).padStart(13, '0')}-${process.pid}.md`;
    const artifactPath = path.join(issuesDir, filename);
    const lastIssuePath = path.join(issuesDir, 'last-error-issue.md');

    fs.writeFileSync(artifactPath, issue.body, 'utf-8');
    fs.writeFileSync(lastIssuePath, issue.body, 'utf-8');
    pruneOldReports(issuesDir, options.maxReports ?? MAX_ISSUE_REPORTS);
    return artifactPath;
  } catch {
    return null;
  }
};
