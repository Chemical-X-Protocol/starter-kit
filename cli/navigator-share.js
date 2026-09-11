import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  hasGum,
  gumChoose,
  gumInput,
  promptQuestion,
  openBrowser
} from './terminal.js';
import {
  detectGitRepoInfo,
  detectGitHubUser,
  getAuditBaseline,
  createSnapshotFromReport,
  getAuditHistory,
  generateTransformationDiscussionContent,
  generateDiscussionContent,
  publishDiscussion,
  copyToClipboard,
  ORG_DISCUSSIONS_URL,
  DISCUSSION_CATEGORY,
  DEFAULT_DISCUSSION_REPO,
  DISCUSSION_CATEGORY_SLUG
} from './audit.js';

export const handleShareToDiscussions = async (report) => {
  const repoInfo = detectGitRepoInfo();
  const detectedUser = detectGitHubUser();
  const defaultProject = repoInfo.nameWithOwner || path.basename(process.cwd());

  const baseline = getAuditBaseline();
  const currentSnapshot = createSnapshotFromReport(report);
  const history = getAuditHistory();

  const isScoreDifferent = baseline && baseline.health.score !== currentSnapshot.health.score;
  const isViolationsDifferent = baseline && baseline.violations.total !== currentSnapshot.violations.total;
  const hasTransformationHistory = Boolean(baseline && (history.length > 1 || isScoreDifferent || isViolationsDifferent));

  let shareType = 'single';
  if (hasTransformationHistory) {
    if (hasGum()) {
      const choice = gumChoose([
        '1. 🚀 Post Transformation Showcase (Before vs. After Delta)',
        '2. 📋 Post Single Audit Scorecard (Current Snapshot Only)'
      ]);
      if (choice?.includes('1.')) shareType = 'transformation';
    } else {
      process.stdout.write('\nSelect Discussion Post Format:\n');
      process.stdout.write('  [1] 🚀 Post Transformation Showcase (Before vs. After Delta)\n');
      process.stdout.write('  [2] 📋 Post Single Audit Scorecard (Current Snapshot Only)\n');
      const choice = await promptQuestion('Choice [1]: ');
      if (!choice || choice.trim() === '1') shareType = 'transformation';
    }
  }

  let user = detectedUser;
  let projectName = defaultProject;
  const modeLabel = shareType === 'transformation' ? 'Transformation Showcase (Delta)' : 'Single Audit Scorecard';

  if (hasGum()) {
    spawnSync('gum', ['style', '--border=rounded', '--border-foreground=81', '--padding=0 2', '--bold',
      `Post Audit to GitHub Discussions\nBoard: ${ORG_DISCUSSIONS_URL}\nCategory: ${DISCUSSION_CATEGORY}\nMode: ${modeLabel}`
    ], { stdio: 'inherit' });

    user = gumInput('Your GitHub username:', detectedUser) || detectedUser;
    projectName = gumInput('Project name for audit post:', defaultProject) || defaultProject;
  } else {
    process.stdout.write(`\n\x1b[1m\x1b[38;2;98;201;255mPost Audit to GitHub Discussions (${DISCUSSION_CATEGORY})\x1b[0m\n`);
    user = (await promptQuestion(`Your GitHub username [@${detectedUser}]: `)) || detectedUser;
    projectName = (await promptQuestion(`Project name for audit post [${defaultProject}]: `)) || defaultProject;
  }

  const isTransformationPost = shareType === 'transformation' && Boolean(baseline);
  const { title, category, categorySlug, body } = isTransformationPost
    ? generateTransformationDiscussionContent(baseline, currentSnapshot, user, projectName, repoInfo.url)
    : generateDiscussionContent(report, user, projectName, repoInfo.url);

  process.stdout.write('\nAttempting automatic publish to GitHub Discussions...\n');
  const pubResult = await publishDiscussion(DEFAULT_DISCUSSION_REPO, title, body, category);

  if (pubResult.success && pubResult.url) {
    process.stdout.write(`\n\x1b[1m\x1b[32m✔ Successfully published discussion!\x1b[0m\nDiscussion URL: \x1b[36m${pubResult.url}\x1b[0m\n\n`);
    openBrowser(pubResult.url);
  } else {
    copyToClipboard(body);
    const targetSlug = categorySlug || DISCUSSION_CATEGORY_SLUG || 'npx-chemx-audit';
    const discussionUrl = `${ORG_DISCUSSIONS_URL}/new?category=${encodeURIComponent(targetSlug)}&title=${encodeURIComponent(title)}`;
    process.stdout.write('\n\x1b[32m✔ Formatted audit report copied to your system clipboard!\x1b[0m\n');
    process.stdout.write(`Opening GitHub Discussions composer in default browser:\n  \x1b[36m${discussionUrl}\x1b[0m\n\n`);
    openBrowser(discussionUrl);
  }

  if (hasGum()) {
    gumChoose(['<-- Back to Audit Dashboard']);
  } else {
    await promptQuestion('Press Enter to return to menu...');
  }
};
