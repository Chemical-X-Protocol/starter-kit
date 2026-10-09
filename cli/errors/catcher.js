import fs from 'node:fs';
import { formatIssueContent } from './formatter.js';
import { publishIssue } from './publisher.js';
import { sanitizeText } from './sanitizer.js';
import { printFailureSummary, previewPost, promptUserToPublish } from './report-output.js';
import { isOfflineMode, describeOffline } from '../network-policy.js';
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

export const handleError = async (err, options = {}) => {
  const cwd = options.cwd || process.cwd();
  const errorObj = err instanceof Error ? err : new Error(String(err));
  const targetRepo = resolveTargetIssuesRepo(options, cwd);

  const rawCmd = options.command || process.argv.slice(2).join(' ');
  const command = sanitizeText(rawCmd) || 'chemx';

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

  // Posting is opt-in only (--post-issue, autoPost, CHEMX_AUTO_POST_ISSUES=true). A CI token alone never posts.
  const isCiEnv = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);
  const shouldAutoPost = Boolean(options.autoPost || process.env.CHEMX_AUTO_POST_ISSUES === 'true');

  let publishResult = { success: false, url: null, issueNumber: null, error: null };
  const isOffline = isOfflineMode();

  if (shouldAutoPost) {
    if (!options.silent && !isOffline) previewPost(targetRepo, issue, savedPath);
    publishResult = await publishIssue(targetRepo, issue.title, issue.body, issue.labels);
    // With options.silent the outcome is only in the returned publishResult.
    if (!options.silent && publishResult.success) {
      process.stdout.write(`\n\x1b[32m✔ Issue automatically created: ${publishResult.url}\x1b[0m\n`);
    } else if (!options.silent) {
      printFailureSummary(report, issue, savedPath, publishResult.error || 'unknown error');
    }
  } else if (!options.silent) {
    const isTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const isAgentEnv = Boolean(process.env.AGENT || process.env.ANTIGRAVITY || process.env.CURSOR || process.env.NON_INTERACTIVE);
    const isExplicitPrompt = Boolean(options.promptIssue || process.env.CHEMX_PROMPT_ISSUES === 'true');
    const canPromptUser = isTty && !isCiEnv && !isAgentEnv && isExplicitPrompt;
    const offlineNote = isExplicitPrompt && isOffline ? describeOffline('Posting a GitHub issue') : null;

    printFailureSummary(report, issue, savedPath, offlineNote);

    if (canPromptUser && !isOffline) {
      publishResult = await promptUserToPublish(targetRepo, issue, savedPath);
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
    } catch (err) {
      // Non-blocking: the issue is already published; only the task record failed.
      const reason = err instanceof Error ? err.message : String(err);
      if (!options.silent) process.stderr.write(`  • Swarm task not recorded: ${reason}\n`);
    }
  }

  return { report, issue, publishResult, savedPath };
};
