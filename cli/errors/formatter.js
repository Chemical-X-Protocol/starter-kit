import { sanitizeText, sanitizeStackTrace } from './sanitizer.js';

export const buildIssueTitle = (report) => {
  const cmd = report.command ? report.command.split(' ')[0] : 'chemx';
  const rawMsg = report.message || 'Unknown error occurred';
  const cleanMsg = rawMsg.split('\n')[0].replace(/[\r\n\t]+/g, ' ').trim();
  const truncatedMsg = cleanMsg.length > 70 ? `${cleanMsg.slice(0, 67)}...` : cleanMsg;
  return `[ChemX Failure] ${cmd}: ${truncatedMsg}`;
};

export const buildIssueBody = (report) => {
  const rawStack = report.stack || report.message;
  const stackContent = rawStack || 'No stack trace available';
  const sanitizedStack = sanitizeStackTrace(stackContent);
  const sanitizedCommand = sanitizeText(report.command || 'chemx');
  const sanitizedCwd = sanitizeText(report.cwd || process.cwd());

  const lines = [
    '### 🚨 Chemical X Execution Failure Report',
    '',
    'An automated failure report was prepared by the Chemical X Universal Error Catcher.',
    '',
    '#### 📊 Execution Context',
    `| Property | Value |`,
    `| :--- | :--- |`,
    `| **Command** | \`${sanitizedCommand}\` |`,
    `| **Exit Code** | \`${report.exitCode ?? 1}\` |`,
    `| **Timestamp** | \`${report.timestamp || new Date().toISOString()}\` |`,
    `| **Node.js** | \`${report.nodeVersion || process.version}\` |`,
    `| **Platform** | \`${report.platform || process.platform}\` |`,
    `| **ChemX Version** | \`${report.chemxVersion || 'unknown'}\` |`,
    `| **Working Dir** | \`${sanitizedCwd}\` |`
  ];

  if (report.gitBranch) {
    lines.push(`| **Git Branch** | \`${report.gitBranch}\` |`);
  }
  if (report.gitCommit) {
    lines.push(`| **Git Commit** | \`${report.gitCommit}\` |`);
  }

  lines.push('');
  lines.push('#### 💥 Diagnostic Stack Trace');
  lines.push('<details open>');
  lines.push('<summary>Click to collapse error details</summary>');
  lines.push('');
  lines.push('```text');
  lines.push(sanitizedStack.trim());
  lines.push('```');
  lines.push('</details>');

  if (report.context && Object.keys(report.context).length > 0) {
    lines.push('');
    lines.push('#### 🔍 Additional Metadata');
    lines.push('```json');
    lines.push(JSON.stringify(report.context, null, 2));
    lines.push('```');
  }

  lines.push('');
  lines.push('---');
  lines.push('> *Generated automatically by Chemical X Protocol Universal Error Catcher.*');

  return lines.join('\n');
};

export const buildIssueWebUrl = (repo, title, body, labels = []) => {
  const hasRepo = Boolean(repo && repo.includes('/'));
  const safeRepo = hasRepo ? repo : 'Chemical-X-Protocol/starter-kit';
  const base = `https://github.com/${safeRepo}/issues/new`;
  const params = new URLSearchParams();
  params.set('title', title);
  params.set('body', body);
  if (labels && labels.length > 0) {
    params.set('labels', labels.join(','));
  }
  return `${base}?${params.toString()}`;
};

export const formatIssueContent = (report, targetRepo, customLabels = null) => {
  const defaultLabels = ['chemx-failure', 'bug'];
  const labels = customLabels || defaultLabels;
  const title = buildIssueTitle(report);
  const body = buildIssueBody(report);
  const webUrl = buildIssueWebUrl(targetRepo, title, body, labels);

  return {
    title,
    body,
    labels,
    webUrl,
    targetRepo
  };
};
