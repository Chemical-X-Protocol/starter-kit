// Terminal output for the error catcher: the failure summary, the pre-post preview and the interactive post prompt.
import { copyToClipboard } from '../audit/social-git.js';
import { publishIssue } from './publisher.js';
import { openBrowser, confirmAction } from '../terminal.js';

export const printFailureSummary = (report, issue, savedPath, postError = null) => {
  process.stderr.write(`\n\x1b[31m✕ Command Failed: ${report.message}\x1b[0m\n`);
  if (postError) {
    process.stderr.write(`  \x1b[33m• Issue not posted:\x1b[0m ${postError}\n`);
  }
  process.stderr.write(`  \x1b[33m• Prepped Issue:\x1b[0m ${issue.webUrl}\n`);
  if (savedPath) {
    process.stderr.write(`  \x1b[33m• Local Report:\x1b[0m ${savedPath}\n`);
  } else if (postError) {
    process.stderr.write('  \x1b[33m• Local Report:\x1b[0m not saved\n');
  }
};

// Shows exactly what an opt-in post will send, before the request goes out.
export const previewPost = (targetRepo, issue, savedPath = null) => {
  const lines = [
    '',
    `\x1b[36m▸ Posting error report to GitHub Issues: ${targetRepo}\x1b[0m`,
    `  Title: ${issue.title}`,
    `  Labels: ${(issue.labels || []).join(', ') || '(none)'}`
  ];
  if (savedPath) lines.push(`  Local copy: ${savedPath}`);
  lines.push('  Body:', '', issue.body, '');
  process.stderr.write(`${lines.join('\n')}\n`);
};

export const promptUserToPublish = async (targetRepo, issue, savedPath = null) => {
  previewPost(targetRepo, issue, savedPath);
  const confirmed = await confirmAction(`Post this error report to ${targetRepo}?`, 'Post Issue', 'Skip', false);
  if (!confirmed) {
    return { success: false, url: null, issueNumber: null, error: null };
  }

  const publishResult = await publishIssue(targetRepo, issue.title, issue.body, issue.labels);
  if (publishResult.success) {
    process.stdout.write(`\x1b[32m✔ Issue published: ${publishResult.url}\x1b[0m\n`);
    openBrowser(publishResult.url);
  } else {
    copyToClipboard(issue.body);
    process.stdout.write(`\x1b[33m⚠ Publish failed (${publishResult.error || 'unknown error'}). Markdown copied to clipboard. Opening browser...\x1b[0m\n`);
    openBrowser(issue.webUrl);
  }
  return publishResult;
};
