import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  hasGum,
  gumChoose,
  gumInput,
  promptQuestion,
  isInteractive
} from './terminal.js';
import { isOfflineMode, describeOffline } from './network-policy.js';
import { STATUS } from './result-status.js';
import { hasYesFlag, renderSharePreview, confirmShare, shareResult } from './share-consent.js';
import { reportShareOutcome } from './share-outcome.js';
import {
  detectGitRepoInfo,
  detectGitHubUser,
  getAuditBaseline,
  createSnapshotFromReport,
  getAuditHistory,
  generateTransformationDiscussionContent,
  generateDiscussionContent,
  publishOrUpdateDiscussion,
  getStoredDiscussion,
  ORG_DISCUSSIONS_URL,
  DISCUSSION_CATEGORY,
  DEFAULT_DISCUSSION_REPO
} from './audit.js';

export const handleShareToDiscussions = async (report, options = {}) => {
  const isYes = options.isYes ?? hasYesFlag(process.argv);
  const canPrompt = options.isInteractive ?? isInteractive();
  const isOffline = isOfflineMode();
  if (isOffline) {
    const reason = describeOffline('Posting to GitHub Discussions');
    process.stderr.write(`${reason}\n`);
    return shareResult(STATUS.INCONCLUSIVE, false, reason, { offline: true });
  }
  // Refuse before any gh/GitHub lookup: a non-interactive share needs an explicit --yes.
  const isRefusedNonInteractive = !canPrompt && !isYes;
  if (isRefusedNonInteractive) {
    const consent = await confirmShare({ repo: DEFAULT_DISCUSSION_REPO, isYes, canPrompt });
    process.stderr.write(`${consent.reason}\n`);
    return shareResult(STATUS.FAIL, false, consent.reason);
  }

  const repoInfo = detectGitRepoInfo();
  const detectedUser = detectGitHubUser();
  const defaultProject = repoInfo.nameWithOwner || path.basename(process.cwd());

  const baseline = getAuditBaseline();
  const currentSnapshot = createSnapshotFromReport(report);
  const history = getAuditHistory();

  const isScoreDifferent = baseline && baseline.health.score !== currentSnapshot.health.score;
  const isViolationsDifferent = baseline && baseline.violations.total !== currentSnapshot.violations.total;
  const hasTransformationHistory = Boolean(baseline && (history.length > 1 || isScoreDifferent || isViolationsDifferent));

  let shareType = hasTransformationHistory ? 'transformation' : 'single';
  const shouldAskFormat = hasTransformationHistory && canPrompt;
  if (shouldAskFormat) {
    shareType = 'single';
    if (hasGum()) {
      const choice = gumChoose([
        '1. 🚀 Post Transformation Showcase (Before vs. After Delta)',
        '2. 📋 Post Single Audit Scorecard (Current Snapshot Only)'
      ]);
      const isTransformationChoice = Boolean(choice?.includes('1.'));
      if (isTransformationChoice) shareType = 'transformation';
    } else {
      process.stdout.write('\nSelect Discussion Post Format:\n');
      process.stdout.write('  [1] 🚀 Post Transformation Showcase (Before vs. After Delta)\n');
      process.stdout.write('  [2] 📋 Post Single Audit Scorecard (Current Snapshot Only)\n');
      const choice = await promptQuestion('Choice [1]: ');
      const isTransformationTyped = !choice || choice.trim() === '1';
      if (isTransformationTyped) shareType = 'transformation';
    }
  }

  let detectedSite = '';
  const pkgPath = path.resolve(process.cwd(), 'package.json');
  const hasPackageJson = fs.existsSync(pkgPath);
  if (hasPackageJson) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      detectedSite = pkg.homepage || pkg.website || '';
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Could not read package.json homepage: ${reason}\n`);
      detectedSite = '';
    }
  }

  const stored = getStoredDiscussion();
  const shouldUseStoredWebsite = Boolean(!detectedSite && stored?.website);
  if (shouldUseStoredWebsite) {
    detectedSite = stored.website;
  }

  let user = detectedUser;
  let projectName = defaultProject;
  let liveUrl = detectedSite;
  const modeLabel = shareType === 'transformation' ? 'Transformation Showcase (Delta)' : 'Single Audit Scorecard';

  const useGum = canPrompt && hasGum();
  if (!canPrompt) {
    process.stdout.write(`\nPreparing ${modeLabel} with detected defaults (non-interactive).\n`);
  } else if (useGum) {
    spawnSync('gum', ['style', '--border=rounded', '--border-foreground=81', '--padding=0 2', '--bold',
      `Post Audit to GitHub Discussions\nBoard: ${ORG_DISCUSSIONS_URL}\nCategory: ${DISCUSSION_CATEGORY}\nMode: ${modeLabel}`
    ], { stdio: 'inherit' });

    user = gumInput('Your GitHub username:', detectedUser) || detectedUser;
    projectName = gumInput('Project name for audit post:', defaultProject) || defaultProject;
    liveUrl = gumInput('Website URL (optional):', detectedSite) || detectedSite;
  } else {
    process.stdout.write(`\n\x1b[1m\x1b[38;2;98;201;255mPost Audit to GitHub Discussions (${DISCUSSION_CATEGORY})\x1b[0m\n`);
    user = (await promptQuestion(`Your GitHub username [@${detectedUser}]: `)) || detectedUser;
    projectName = (await promptQuestion(`Project name for audit post [${defaultProject}]: `)) || defaultProject;
    liveUrl = (await promptQuestion(`Website URL (optional) [${detectedSite}]: `)) || detectedSite;
  }

  const isTransformationPost = shareType === 'transformation' && Boolean(baseline);
  const { title, category, categorySlug, body } = isTransformationPost
    ? generateTransformationDiscussionContent(baseline, currentSnapshot, user, projectName, repoInfo.url, liveUrl)
    : generateDiscussionContent(report, user, projectName, repoInfo.url, liveUrl);

  const isStoredForTarget = Boolean(stored && stored.number && (!stored.repo || stored.repo === DEFAULT_DISCUSSION_REPO));
  const existingNumber = isStoredForTarget ? stored.number : null;
  process.stdout.write(renderSharePreview({ repo: DEFAULT_DISCUSSION_REPO, category, title, body, existingNumber }));
  const consent = await confirmShare({ repo: DEFAULT_DISCUSSION_REPO, isYes, canPrompt });
  const isConfirmed = Boolean(consent.confirmed);
  if (!isConfirmed) {
    process.stderr.write(`${consent.reason}\n`);
    const refusedStatus = consent.declined ? STATUS.INCONCLUSIVE : STATUS.FAIL;
    return shareResult(refusedStatus, false, consent.reason, { declined: consent.declined });
  }

  process.stdout.write('\nAttempting publish to GitHub Discussions...\n');
  const pubResult = await publishOrUpdateDiscussion(DEFAULT_DISCUSSION_REPO, title, body, category, {
    projectName,
    website: liveUrl
  });

  return reportShareOutcome({ pubResult, title, body, categorySlug, canPrompt });
};
