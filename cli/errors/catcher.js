import fs from 'node:fs';
import { formatIssueContent } from './formatter.js';
import { publishIssue } from './publisher.js';
import { sanitizeText } from './sanitizer.js';
import { formatFailureNotice, printFailureSummary, previewPost, promptUserToPublish } from './report-output.js';
import { isOfflineMode, describeOffline } from '../network-policy.js';
import { resolveTargetIssuesRepo, saveIssueArtifact } from './storage.js';
import { resolveCatcherPolicy } from './policy.js';

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
    message: sanitizeText(errorObj.message),
    name: errorObj.name,
    stack: sanitizeText(errorObj.stack || ''),
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
  // An opt-in post also saves the report, so an offline or failed post still names a local copy.
  const policy = resolveCatcherPolicy(options);
  const savedPath = policy.shouldSaveReport ? saveIssueArtifact(cwd, issue, options) : null;

  let publishResult = { success: false, url: null, issueNumber: null, error: null };
  const isOffline = isOfflineMode();

  if (policy.shouldAutoPost) {
    // The preview goes to stderr even when silent (--json/--silent keep stdout clean); only the MCP tool opts out with preview: false.
    const isPreviewEnabled = options.preview !== false && !isOffline;
    if (isPreviewEnabled) previewPost(targetRepo, issue, savedPath);
    publishResult = await publishIssue(targetRepo, issue.title, issue.body, issue.labels);
    // With options.silent the outcome is only in the returned publishResult.
    const shouldLogUrl = !options.silent && publishResult.success;
    const shouldLogFailure = !options.silent && !publishResult.success;
    if (shouldLogUrl) {
      process.stdout.write(`\n\x1b[32m✔ Issue automatically created: ${publishResult.url}\x1b[0m\n`);
    } else if (shouldLogFailure) {
      printFailureSummary(report, issue, savedPath, publishResult.error || 'unknown error');
    }
  } else {
    const shouldShowFailureNotice = !options.silent;
    if (shouldShowFailureNotice) {
      const isOfflineNoteNeeded = policy.canPromptUser && isOffline;
      const offlineNote = isOfflineNoteNeeded ? describeOffline('Posting a GitHub issue') : null;
      const shouldShowIssueUrl = Boolean(policy.shouldShowIssueUrl);
      const issueUrl = shouldShowIssueUrl ? issue.webUrl : null;
      process.stderr.write(formatFailureNotice(report.message, savedPath, issueUrl, policy.useColor, offlineNote));
      const canPromptToPublish = policy.canPromptUser && !isOffline;
      if (canPromptToPublish) {
        publishResult = await promptUserToPublish(targetRepo, issue, savedPath);
      }
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
        const shouldLogTask = Boolean(created && !options.silent);
        if (shouldLogTask) {
          process.stdout.write(`  \x1b[36m• Swarm Task:\x1b[0m #${created.id} queued to track issue resolution\n`);
        }
      }
    } catch (err) {
      // Non-blocking: the issue is already published; only the task record failed.
      const reason = err instanceof Error ? err.message : String(err);
      const shouldLogError = !options.silent;
      if (shouldLogError) process.stderr.write(`  • Swarm task not recorded: ${reason}\n`);
    }
  }

  return { report, issue, publishResult, savedPath };
};
