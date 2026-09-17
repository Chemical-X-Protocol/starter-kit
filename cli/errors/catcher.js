import { copyToClipboard } from '../audit/social-git.js';
import { formatIssueContent } from './formatter.js';
import { publishIssue } from './publisher.js';
import { openBrowser, confirmAction } from '../terminal.js';
import { resolveTargetIssuesRepo, saveIssueArtifact } from './storage.js';

export { resolveTargetIssuesRepo, saveIssueArtifact };

const promptUserToPublish = async (targetRepo, issue) => {
  const confirmed = await confirmAction('Post this error report directly to GitHub Issues?', 'Post Issue', 'Skip', false);
  if (!confirmed) {
    return { success: false, url: null, issueNumber: null, error: null };
  }

  const publishResult = await publishIssue(targetRepo, issue.title, issue.body, issue.labels);
  if (publishResult.success) {
    process.stdout.write(`\x1b[32m✔ Issue published: ${publishResult.url}\x1b[0m\n`);
    openBrowser(publishResult.url);
  } else {
    copyToClipboard(issue.body);
    process.stdout.write(`\x1b[33m⚠ Publish failed. Markdown copied to clipboard. Opening browser...\x1b[0m\n`);
    openBrowser(issue.webUrl);
  }
  return publishResult;
};

export const handleError = async (err, options = {}) => {
  const cwd = options.cwd || process.cwd();
  const errorObj = err instanceof Error ? err : new Error(String(err));
  const targetRepo = resolveTargetIssuesRepo(options, cwd);

  const rawCmd = options.command || process.argv.slice(2).join(' ');
  const command = rawCmd || 'chemx';

  const report = {
    message: errorObj.message,
    name: errorObj.name,
    stack: errorObj.stack || '',
    command,
    cwd,
    exitCode: options.exitCode ?? 1,
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: `${process.platform}-${process.arch}`,
    chemxVersion: options.chemxVersion || '26.9.17',
    context: options.context || {}
  };

  const issue = formatIssueContent(report, targetRepo, options.labels);
  const savedPath = saveIssueArtifact(cwd, issue);

  const hasToken = Boolean(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
  const isCiEnv = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);
  const isExplicitAutoPost = Boolean(options.autoPost || process.env.CHEMX_AUTO_POST_ISSUES === 'true');
  const isCiAutoPost = isCiEnv && hasToken && options.autoPost !== false;
  const shouldAutoPost = isExplicitAutoPost || isCiAutoPost;

  let publishResult = { success: false, url: null, issueNumber: null, error: null };

  if (shouldAutoPost) {
    publishResult = await publishIssue(targetRepo, issue.title, issue.body, issue.labels);
    if (publishResult.success && !options.silent) {
      process.stdout.write(`\n\x1b[32m✔ Issue automatically created: ${publishResult.url}\x1b[0m\n`);
    }
  } else if (!options.silent) {
    const isTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const isInteractive = isTty && !isCiEnv;
    process.stderr.write(`\n\x1b[31m✕ Command Failed: ${report.message}\x1b[0m\n`);
    process.stderr.write(`  \x1b[33m• Prepped Issue:\x1b[0m ${issue.webUrl}\n`);
    if (savedPath) {
      process.stderr.write(`  \x1b[33m• Local Report:\x1b[0m ${savedPath}\n`);
    }

    if (isInteractive) {
      publishResult = await promptUserToPublish(targetRepo, issue);
    }
  }

  return { report, issue, publishResult, savedPath };
};
