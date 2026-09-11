import { groupViolationsBySeverity } from './reporter.js';
import { PILLAR_EMOJIS } from './reporter-utils.js';

export {
  parseGitRemoteUrl,
  detectGitRepoInfo,
  detectGitHubUser,
  copyToClipboard
} from './social-git.js';

export {
  publishDiscussionViaHttp,
  publishDiscussionViaGh,
  publishDiscussion
} from './social-publisher.js';

export const DISCUSSION_CATEGORY = 'npx chemx audit';
export const DISCUSSION_CATEGORY_SLUG = 'npx-chemx-audit';
export const ORG_DISCUSSIONS_URL = 'https://github.com/orgs/Chemical-X-Protocol/discussions';
export const DEFAULT_DISCUSSION_REPO = 'Chemical-X-Protocol/.github';

export const resolveBadgeColor = (score) => {
  if (score >= 90) return '06b6d4';
  if (score >= 70) return 'f59e0b';
  return 'ef4444';
};

export const resolveHotspotTierText = (lineCount) => {
  if (lineCount >= 2000) return '🔴 **CRITICAL (>= 2,000 LOC)**';
  if (lineCount >= 1000) return '🟠 **SEVERE (>= 1,000 LOC)**';
  if (lineCount > 500) return '🟡 **WARNING (> 500 LOC)**';
  return '🟢 Compliant';
};

export const resolvePillarProgressionBadge = (isImproved, beforeStatus, afterStatus) => {
  if (isImproved) return '🟢 **RESOLVED**';
  if (beforeStatus === afterStatus) return '⚪ **UNCHANGED**';
  return '🔴 **DEGRADED**';
};

const isExtremeMonolith = (h) => h.lineCount >= 2000;
const isSevereMonolith = (h) => h.lineCount >= 1000 && h.lineCount < 2000;
const isWarningMonolith = (h) => h.lineCount >= 500 && h.lineCount < 1000;

export const generateDiscussionContent = (report, username, projectName = 'Codebase', repoUrl = '') => {
  const { health, metrics, pillars, hotspots, contextAnalysis, violations } = report;
  const isHighScoring = health.score >= 80;
  const badgeColor = resolveBadgeColor(health.score);
  const encodedGrade = encodeURIComponent(`${health.score}/100 (${health.grade})`);

  const category = DISCUSSION_CATEGORY;
  const categorySlug = DISCUSSION_CATEGORY_SLUG;
  const prefix = isHighScoring ? '[Showcase]' : '[Teardown]';
  const title = `${prefix} ${projectName} : MHI ${health.score}/100 [Grade: ${health.grade}]`;

  const lines = [];
  lines.push(`# ${isHighScoring ? 'Crystalline' : 'Architecture'} Audit Report: ${projectName}`);
  lines.push('');
  lines.push(`[![Chemical X MHI](https://img.shields.io/badge/Chemical%20X%20MHI-${encodedGrade}-${badgeColor}?style=for-the-badge)](https://chemicalx.xophz.com)`);
  lines.push('');
  lines.push(`* **Audited by**: @${username}`);
  const resolvedRepoUrl = repoUrl || (/^[\w\-.]+\/[\w\-.]+$/.test(projectName) ? `https://github.com/${projectName}` : '');
  if (resolvedRepoUrl) {
    lines.push(`* **Repository**: ${resolvedRepoUrl}`);
  }
  lines.push(`* **Molecular Health Index**: **${health.score} / 100** (Grade: **${health.grade}** - ${health.label})`);
  lines.push(`* **Source Files Analyzed**: ${metrics.scannedFiles} files (${metrics.totalLoc} total LOC)`);
  lines.push(`* **Token Reduction Potential**: **${contextAnalysis.potentialSavingsPct}%** (Estimated ${contextAnalysis.estimatedTokens.toLocaleString()} tokens)`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 1. 7-Pillar Architectural Matrix');
  lines.push('');
  lines.push('| Pillar | Status | Hazards |');
  lines.push('| :--- | :---: | :---: |');

  const resolveStatusDisplay = (status) => {
    if (status === 'PASSED') return '🟢 **PASSED**';
    if (status === 'WARN') return '🟡 **WARN**';
    return '🔴 **FAILED**';
  };

  const resolveHazardsDisplay = (count, status) => {
    if (count === 0) return '🟢 0';
    if (status === 'FAILED') return `🔴 **${count}**`;
    return `🟡 **${count}**`;
  };

  for (const [pillarName, data] of Object.entries(pillars)) {
    const icon = PILLAR_EMOJIS[pillarName] || '🏛️';
    const statusText = resolveStatusDisplay(data.status);
    const hazardsText = resolveHazardsDisplay(data.violations, data.status);
    lines.push(`| ${icon} ${pillarName} | ${statusText} | ${hazardsText} |`);
  }
  lines.push('');

  const { critical, high, medium, low } = groupViolationsBySeverity(violations);
  const extremeMonoliths = hotspots.filter(isExtremeMonolith).length;
  const severeMonoliths = hotspots.filter(isSevereMonolith).length;
  const warningMonoliths = hotspots.filter(isWarningMonolith).length;
  const totalMonoliths = extremeMonoliths + severeMonoliths + warningMonoliths;

  lines.push('---');
  lines.push('');
  lines.push('## 2. Monolith & Architectural Hazard Summary');
  lines.push('');
  lines.push(`* **Monolith Files (> 500 LOC)**: **${totalMonoliths} files**`);
  if (totalMonoliths > 0) {
    lines.push(`  * Warning Tier (500 - 999 LOC): ${warningMonoliths} files`);
    lines.push(`  * Severe Tier (1,000 - 1,999 LOC): ${severeMonoliths} files`);
    lines.push(`  * Extreme Monoliths (2,000+ LOC): ${extremeMonoliths} files`);
  }
  lines.push(`* **Hazard Breakdown**: Critical: **${critical.length}** | High/Med: **${high.length + medium.length}** | Low: **${low.length}**`);
  lines.push('');

  lines.push('---');
  lines.push('');
  if (isHighScoring) {
    lines.push('### Community Takeaway');
    lines.push('This project follows Chemical X Molecular Architecture principles with isolated capsules and self-cleaning hooks.');
  } else {
    lines.push('### Seeking Refactoring Feedback');
    lines.push('Looking for recommendations on breaking down flagged monolithic debts into crystalline molecule capsules (< 100 LOC). Any advice is welcome!');
  }
  lines.push('');
  lines.push('*Audited using [Chemical X Protocol Starter Kit](https://github.com/Chemical-X-Protocol/awesome-secret-sauce).*');

  return {
    title,
    category,
    categorySlug,
    body: lines.join('\n')
  };
};

export const generateTransformationDiscussionContent = (
  beforeSnapshot,
  afterSnapshot,
  username,
  projectName = 'Codebase',
  repoUrl = ''
) => {
  const scoreBefore = beforeSnapshot.health.score;
  const scoreAfter = afterSnapshot.health.score;
  const scoreDelta = scoreAfter - scoreBefore;

  const critDelta = afterSnapshot.violations.critical - beforeSnapshot.violations.critical;
  const totalDelta = afterSnapshot.violations.total - beforeSnapshot.violations.total;
  const monoDelta = afterSnapshot.monoliths.total - beforeSnapshot.monoliths.total;
  const tokensDelta = afterSnapshot.tokens.estimatedExcessTokens - beforeSnapshot.tokens.estimatedExcessTokens;

  const category = DISCUSSION_CATEGORY;
  const categorySlug = DISCUSSION_CATEGORY_SLUG;
  const title = `[Transformation] ${projectName} : ${beforeSnapshot.health.grade} (${scoreBefore}) -> ${afterSnapshot.health.grade} (${scoreAfter})`;

  const formatDelta = (val, invertGood = false) => {
    if (val === 0) return '0 (No change)';
    const isGood = invertGood ? val < 0 : val > 0;
    const sign = val > 0 ? `+${val}` : `${val}`;
    return isGood ? `🟢 **${sign}**` : `🔴 **${sign}**`;
  };

  const lines = [];
  lines.push(`# 🚀 Architectural Transformation: ${projectName}`);
  lines.push('');
  lines.push(`[![Chemical X Transformation](https://img.shields.io/badge/Chemical%20X-Transformation%20Showcase-62c9ff?style=for-the-badge)](https://chemicalx.xophz.com)`);
  lines.push('');
  lines.push(`* **Audited by**: @${username}`);
  const resolvedRepoUrl = repoUrl || (/^[\w\-.]+\/[\w\-.]+$/.test(projectName) ? `https://github.com/${projectName}` : '');
  if (resolvedRepoUrl) {
    lines.push(`* **Repository**: ${resolvedRepoUrl}`);
  }
  lines.push(`* **Transformation Summary**: Upgraded codebase from **Grade ${beforeSnapshot.health.grade} (${scoreBefore}/100)** to **Grade ${afterSnapshot.health.grade} (${scoreAfter}/100)**.`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 1. Before vs. After Metric Comparison');
  lines.push('');
  lines.push('| Metric | Before (Baseline) | After (Refactored) | Delta |');
  lines.push('| :--- | :---: | :---: | :---: |');
  lines.push(`| **Molecular Health (MHI)** | ${scoreBefore} / 100 (${beforeSnapshot.health.grade}) | ${scoreAfter} / 100 (${afterSnapshot.health.grade}) | ${formatDelta(scoreDelta)} |`);
  lines.push(`| **Critical Hazards** | ${beforeSnapshot.violations.critical} | ${afterSnapshot.violations.critical} | ${formatDelta(critDelta, true)} |`);
  lines.push(`| **Total Violations** | ${beforeSnapshot.violations.total} | ${afterSnapshot.violations.total} | ${formatDelta(totalDelta, true)} |`);
  lines.push(`| **Monolith Files (>500 LOC)** | ${beforeSnapshot.monoliths.total} | ${afterSnapshot.monoliths.total} | ${formatDelta(monoDelta, true)} |`);
  lines.push(`| **Excess Token Burn** | ${beforeSnapshot.tokens.estimatedExcessTokens.toLocaleString()} tok | ${afterSnapshot.tokens.estimatedExcessTokens.toLocaleString()} tok | ${formatDelta(tokensDelta, true)} |`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 2. 7-Pillar Progression');
  lines.push('');
  lines.push('| Pillar | Before Status | After Status | Progression |');
  lines.push('| :--- | :---: | :---: | :---: |');

  const allPillars = new Set([
    ...Object.keys(beforeSnapshot.pillars || {}),
    ...Object.keys(afterSnapshot.pillars || {})
  ]);

  for (const pillar of allPillars) {
    const b = beforeSnapshot.pillars?.[pillar] || { status: 'UNKNOWN', violations: 0 };
    const a = afterSnapshot.pillars?.[pillar] || { status: 'UNKNOWN', violations: 0 };
    const icon = PILLAR_EMOJIS[pillar] || '🏛️';
    const isImproved = a.violations < b.violations || (b.status !== 'PASSED' && a.status === 'PASSED');
    const badge = resolvePillarProgressionBadge(isImproved, b.status, a.status);
    lines.push(`| ${icon} ${pillar} | ${b.status} | ${a.status} | ${badge} |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('### Community Takeaway');
  lines.push('Refactored using Chemical X Molecular Architecture standards. Monoliths decomposed into crystalline domain capsules (< 100 LOC) with self-cleaning hooks.');
  lines.push('');
  lines.push('*Transformation tracked via [Chemical X Protocol Starter Kit](https://github.com/Chemical-X-Protocol/awesome-secret-sauce).*');

  return {
    title,
    category,
    categorySlug,
    body: lines.join('\n')
  };
};
