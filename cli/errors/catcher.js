import fs from 'node:fs';
import { copyToClipboard } from '../audit/social-git.js';
import { formatIssueContent } from './formatter.js';
import { publishIssue } from './publisher.js';
import { openBrowser, confirmAction } from '../terminal.js';
import { resolveTargetIssuesRepo, saveIssueArtifact } from './storage.js';

export { resolveTargetIssuesRepo, saveIssueArtifact };

export const resolveChemxVersion = () => {
  try {
    const pkgContent = fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf-8');
    return JSON.parse(pkgContent).version || 'unknown';
  } catch {
    return 'unknown';
  }
};

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
    chemxVersion: options.chemxVersion || resolveChemxVersion(),
    context: options.context || {}
  };

  const issue = formatIssueContent(report, targetRepo, options.labels);
  const savedPath = saveIssueArtifact(cwd, issue, options);

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
    const isAgentEnv = Boolean(process.env.AGENT || process.env.ANTIGRAVITY || process.env.CURSOR || process.env.NON_INTERACTIVE);
    const isExplicitPrompt = Boolean(options.promptIssue || process.env.CHEMX_PROMPT_ISSUES === 'true');
    const canPromptUser = isTty && !isCiEnv && !isAgentEnv && isExplicitPrompt;

    process.stderr.write(`\n\x1b[31m✕ Command Failed: ${report.message}\x1b[0m\n`);
    process.stderr.write(`  \x1b[33m• Prepped Issue:\x1b[0m ${issue.webUrl}\n`);
    if (savedPath) {
      process.stderr.write(`  \x1b[33m• Local Report:\x1b[0m ${savedPath}\n`);
    }

    if (canPromptUser) {
      publishResult = await promptUserToPublish(targetRepo, issue);
    }
  }

  // Swarm task DAG integration: track published issues as actionable tasks
  const isAutoTaskEnabled = options.createTask !== false && process.env.CHEMX_AUTO_TASK !== 'false';
  const hasPublishedUrl = Boolean(publishResult.url);
  const canRegisterTask = publishResult.success && hasPublishedUrl && isAutoTaskEnabled;

  if (canRegisterTask) {
    try {
      const { openIndexDb } = await import('../search-db.js');
      const { createTask } = await import('../team/team-db-tasks.js');
      const db = openIndexDb(cwd);
      if (db) {
        const taskTitle = `Resolve issue: ${report.message.slice(0, 70)}`;
        const taskDesc = `Automated GitHub Issue: ${publishResult.url}\n\nCommand: ${report.command}\n\n${report.stack || report.message}`;
        const created = createTask(db, {
          title: taskTitle,
          description: taskDesc,
          origin_type: 'github_issue',
          task_url: publishResult.url,
          status: 'queued',
          priority: 1
        });
        if (created && !options.silent) {
          process.stdout.write(`  \x1b[36m• Swarm Task:\x1b[0m #${created.id} queued to track issue resolution\n`);
        }
      }
    } catch {
      // Non-blocking fallback if database is unavailable
    }
  }

  return { report, issue, publishResult, savedPath };
};
