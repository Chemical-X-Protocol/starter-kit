import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  hasGum,
  gumChoose,
  gumInput,
  promptQuestion,
  openBrowser,
  stripAnsi
} from './terminal.js';
import {
  URL_LEARN,
  URL_STANDARD,
  URL_MASTER
} from './license.js';
import {
  formatTerminalReport,
  generateMarkdownReport,
  groupViolationsBySeverity,
  formatGradeFSection,
  formatGradeDSection,
  formatGradeCSection,
  formatGradeBSection,
  formatGradeASection,
  getChemicalXAsciiBanner,
  detectGitHubUser,
  detectGitRepoInfo,
  copyToClipboard,
  generateDiscussionContent,
  generateTransformationDiscussionContent,
  publishDiscussion,
  saveAuditSnapshot,
  getAuditHistory,
  getAuditBaseline,
  createSnapshotFromReport,
  formatTransformationTerminal,
  formatHistoryTimelineTerminal,
  buildGradeFPrompt,
  buildGradeDPrompt,
  buildGradeCPrompt,
  buildGradeBPrompt,
  buildMasterPrompt,
  DISCUSSION_CATEGORY,
  DISCUSSION_CATEGORY_SLUG,
  ORG_DISCUSSIONS_URL,
  DEFAULT_DISCUSSION_REPO
} from './audit.js';

export const resolveGradeColor = (grade) => {
  if (grade === 'A+' || grade === 'A') return '\x1b[32;1m';
  if (grade === 'B') return '\x1b[36;1m';
  if (grade === 'C') return '\x1b[33;1m';
  if (grade === 'D') return '\x1b[38;5;208;1m';
  return '\x1b[31;1m';
};

export const resolveGradeBadge = (grade) => {
  const color = resolveGradeColor(grade);
  const padded = grade.length === 1 ? `${grade} ` : grade;
  return `${color}[Grade: ${padded}]\x1b[0m`;
};

export const resolveCriticalGrade = (count) => {
  if (count === 0) return 'A+';
  if (count === 1) return 'D';
  return 'F';
};

export const resolveHighMedGrade = (count) => {
  if (count === 0) return 'A+';
  if (count <= 3) return 'B';
  if (count <= 8) return 'C';
  if (count <= 15) return 'D';
  return 'F';
};

export const resolveLowGrade = (count) => {
  if (count === 0) return 'A+';
  if (count <= 5) return 'B';
  if (count <= 15) return 'C';
  return 'D';
};

export const resolvePillarGrade = (pillars) => {
  const values = Object.values(pillars || {});
  const failed = values.filter((p) => p.status === 'FAILED').length;
  const warn = values.filter((p) => p.status === 'WARN').length;
  if (failed === 0 && warn === 0) return 'A+';
  if (failed === 0) return 'B';
  if (failed <= 2) return 'C';
  if (failed <= 4) return 'D';
  return 'F';
};

export const resolveHotspotGrade = (hotspots) => {
  if (!hotspots || hotspots.length === 0) return 'A+';
  const hasExtreme = hotspots.some((h) => h.lineCount >= 2000);
  if (hasExtreme) return 'F';
  const hasSevere = hotspots.some((h) => h.lineCount >= 1000);
  if (hasSevere) return 'D';
  const hasWarning = hotspots.some((h) => h.lineCount > 500);
  if (hasWarning) return 'C';
  return 'B';
};

export const resolveContextGrade = (riskTier) => {
  if (riskTier === 'LOW') return 'A';
  if (riskTier === 'MEDIUM') return 'B';
  if (riskTier === 'HIGH') return 'D';
  return 'F';
};

export const extractPromptFromContent = (content) => {
  if (!content || !content.includes('Copy and paste the block below directly into Cursor / Claude / Windsurf:')) {
    return null;
  }
  const clean = stripAnsi(content);
  const marker = 'Copy and paste the block below directly into Cursor / Claude / Windsurf:';
  const markerIdx = clean.indexOf(marker);
  if (markerIdx === -1) return null;

  const afterMarker = clean.slice(markerIdx + marker.length);
  const borderStartIdx = afterMarker.indexOf('├');
  const sliceFrom = borderStartIdx !== -1 ? afterMarker.slice(borderStartIdx) : afterMarker;

  const lines = sliceFrom.split('\n');
  const promptLines = [];
  let recording = false;

  for (const line of lines) {
    if (line.includes('├')) {
      recording = true;
      continue;
    }
    if (line.includes('└')) {
      break;
    }
    if (recording) {
      const cleanedLine = line.replace(/^\s*│\s?/, '');
      promptLines.push(cleanedLine);
    }
  }

  const result = promptLines.join('\n').trim();
  return result.length > 0 ? result : null;
};

export const showPagedContent = async (content, promptText = null) => {
  if (process.stdout.isTTY) {
    console.clear();
  }
  process.stdout.write(content + '\n\n');

  const effectivePrompt = (promptText && promptText.trim().length > 0)
    ? promptText.trim()
    : extractPromptFromContent(content);

  if (effectivePrompt) {
    while (true) {
      if (hasGum()) {
        const choice = gumChoose([
          '1. 📋 Copy AI Agent Prompt to Clipboard',
          '2. <-- Back to Audit Dashboard'
        ]);
        if (choice && choice.startsWith('1.')) {
          const success = copyToClipboard(effectivePrompt);
          if (success) {
            process.stdout.write('\n\x1b[1m\x1b[32m✔ AI Agent refactoring prompt copied to clipboard!\x1b[0m\n');
            process.stdout.write('\x1b[36mPaste directly into Cursor, Claude, or Windsurf to begin automated refactoring.\x1b[0m\n\n');
          } else {
            process.stdout.write('\n\x1b[33m⚠ Could not access system clipboard.\x1b[0m\n\n');
          }
          gumChoose(['<-- Back to Audit Dashboard']);
          break;
        }
        break;
      } else {
        process.stdout.write('\n\x1b[1mOptions:\x1b[0m\n');
        process.stdout.write('  [c] 📋 Copy AI Agent Prompt to Clipboard\n');
        process.stdout.write('  [Enter] <-- Back to Audit Dashboard\n');
        const input = await promptQuestion('Select option [Enter]: ');
        if (input.trim().toLowerCase() === 'c') {
          const success = copyToClipboard(effectivePrompt);
          if (success) {
            process.stdout.write('\n\x1b[1m\x1b[32m✔ AI Agent refactoring prompt copied to clipboard!\x1b[0m\n');
            process.stdout.write('\x1b[36mPaste directly into Cursor, Claude, or Windsurf to begin automated refactoring.\x1b[0m\n\n');
          } else {
            process.stdout.write('\n\x1b[33m⚠ Could not access system clipboard.\x1b[0m\n\n');
          }
          await promptQuestion('Press Enter to return to Audit Dashboard...');
          break;
        }
        break;
      }
    }
  } else {
    if (hasGum()) {
      gumChoose(['<-- Back to Audit Dashboard']);
    } else {
      await promptQuestion('Press Enter to return to menu...');
    }
  }
};

export const showConversionMenu = async (onScaffold = null) => {
  while (true) {
    if (hasGum()) {
      spawnSync(
        'gum',
        [
          'style',
          '--border=rounded',
          '--border-foreground=81',
          '--padding=0 1',
          '--bold',
          'Chemical X: The Secret Sauce to Vibe Coding\nStop letting AI agents scour 2,000-line monoliths and hallucinate.\n25+ Years XP | Codified by Principal Systems Architect Xopher Pollard\nTarget File Budget: Max 500 lines/file (<100 lines/molecule) | 85% Token Burn Cut'
        ],
        { stdio: 'inherit' }
      );

      const choice = gumChoose(
        [
          '1. Visit chemicalx.xophz.com to learn more',
          '2. Buy eBook w/ AGENTS.md Rule Book ($27) -> Launch Checkout',
          '3. Buy Power Puff Edition ($47) -> Launch Checkout',
          '4. Enter License Key to Scaffold (Power Puff License Holders)',
          '5. Back to Navigator'
        ],
        'Unlock Chemical X: Power Puff Edition & Scaffolding:'
      );

      if (choice.startsWith('1.')) {
        process.stdout.write(`\n\x1b[36mOpening Chemical X Portal in browser:\x1b[0m ${URL_LEARN}\n\n`);
        openBrowser(URL_LEARN);
        continue;
      }
      if (choice.startsWith('2.')) {
        process.stdout.write(`\n\x1b[36mOpening Standard Vault checkout (eBook + AGENTS.md):\x1b[0m ${URL_STANDARD}\n\n`);
        openBrowser(URL_STANDARD);
        continue;
      }
      if (choice.startsWith('3.')) {
        process.stdout.write(`\n\x1b[36mOpening Power Puff Edition checkout (Repo + Hooks + Prompts):\x1b[0m ${URL_MASTER}\n\n`);
        openBrowser(URL_MASTER);
        continue;
      }
      if (choice.startsWith('4.')) {
        if (onScaffold) await onScaffold();
        break;
      }
      break;
    } else {
      process.stdout.write(
        '\n\x1b[1m\x1b[38;2;98;201;255mChemical X: The Secret Sauce to Vibe Coding\x1b[0m\n' +
        'Stop letting AI agents scour 2,000-line monoliths and hallucinate breaking changes.\n' +
        '25+ Years XP | Codified by Principal Systems Architect Xopher Pollard\n' +
        'Target File Budget: Max 500 lines/file (<100 lines per molecule capsule).\n\n'
      );
      process.stdout.write(`  [1] Visit chemicalx.xophz.com to learn more\n`);
      process.stdout.write(
        `  [2] Buy eBook w/ AGENTS.md Rule Book ($27) - ${URL_STANDARD}\n` +
        `      Includes: Kindle/Print PDF eBook, 7 Molecular Architecture Chapters, Universal AGENTS.md & .cursorrules\n`
      );
      process.stdout.write(
        `  [3] Buy Power Puff Edition ($47) - ${URL_MASTER}\n` +
        `      Includes: Private Starter-Kit Repo, Pre-Commit Line Budget Hooks, 10x Prompts, VIP Discord\n`
      );
      process.stdout.write('  [4] Enter License Key to Scaffold (Power Puff License Holders)\n');
      process.stdout.write('  [5] Back to Navigator\n\n');

      const selection = await promptQuestion('Select option [1-5] (default: 5): ');
      const effectiveSelection = selection.trim() || '5';
      if (effectiveSelection === '1') {
        process.stdout.write(`\nOpening: ${URL_LEARN}\n\n`);
        openBrowser(URL_LEARN);
        continue;
      }
      if (effectiveSelection === '2') {
        process.stdout.write(`\nOpening: ${URL_STANDARD}\n\n`);
        openBrowser(URL_STANDARD);
        continue;
      }
      if (effectiveSelection === '3') {
        process.stdout.write(`\nOpening: ${URL_MASTER}\n\n`);
        openBrowser(URL_MASTER);
        continue;
      }
      if (effectiveSelection === '4') {
        if (onScaffold) await onScaffold();
        break;
      }
      break;
    }
  }
};

export const handleShareToDiscussions = async (report) => {
  const repoInfo = detectGitRepoInfo();
  const detectedUser = detectGitHubUser();
  const defaultProject = repoInfo.nameWithOwner || path.basename(process.cwd());

  const baseline = getAuditBaseline();
  const currentSnapshot = createSnapshotFromReport(report);
  const history = getAuditHistory();

  const hasTransformationHistory = Boolean(
    baseline && (history.length > 1 || baseline.health.score !== currentSnapshot.health.score || baseline.violations.total !== currentSnapshot.violations.total)
  );

  let shareType = 'single';
  if (hasTransformationHistory) {
    if (hasGum()) {
      const choice = gumChoose([
        '1. 🚀 Post Transformation Showcase (Before vs. After Delta)',
        '2. 📋 Post Single Audit Scorecard (Current Snapshot Only)'
      ]);
      if (choice && choice.includes('1.')) {
        shareType = 'transformation';
      }
    } else {
      process.stdout.write('\nSelect Discussion Post Format:\n');
      process.stdout.write('  [1] 🚀 Post Transformation Showcase (Before vs. After Delta)\n');
      process.stdout.write('  [2] 📋 Post Single Audit Scorecard (Current Snapshot Only)\n');
      const choice = await promptQuestion('Choice [1]: ');
      if (!choice || choice.trim() === '1') {
        shareType = 'transformation';
      }
    }
  }

  let user = detectedUser;
  let projectName = defaultProject;
  const modeLabel = shareType === 'transformation' ? 'Transformation Showcase (Delta)' : 'Single Audit Scorecard';

  if (hasGum()) {
    spawnSync(
      'gum',
      [
        'style',
        '--border=rounded',
        '--border-foreground=81',
        '--padding=0 2',
        '--bold',
        `Post Audit to GitHub Discussions\nBoard: ${ORG_DISCUSSIONS_URL}\nCategory: ${DISCUSSION_CATEGORY}\nMode: ${modeLabel}`
      ],
      { stdio: 'inherit' }
    );

    user = gumInput('Your GitHub username:', detectedUser) || detectedUser;
    projectName = gumInput('Project name for audit post:', defaultProject) || defaultProject;
  } else {
    process.stdout.write(
      `\n\x1b[1m\x1b[38;2;98;201;255mPost Audit to GitHub Discussions (${DISCUSSION_CATEGORY})\x1b[0m\n`
    );
    user = (await promptQuestion(`Your GitHub username [@${detectedUser}]: `)) || detectedUser;
    projectName = (await promptQuestion(`Project name for audit post [${defaultProject}]: `)) || defaultProject;
  }

  const { title, category, categorySlug, body } = shareType === 'transformation' && baseline
    ? generateTransformationDiscussionContent(baseline, currentSnapshot, user, projectName, repoInfo.url)
    : generateDiscussionContent(report, user, projectName, repoInfo.url);

  process.stdout.write('\nAttempting automatic publish to GitHub Discussions...\n');
  const pubResult = await publishDiscussion(DEFAULT_DISCUSSION_REPO, title, body, category);

  const isPubSuccessful = Boolean(pubResult.success && pubResult.url);
  if (isPubSuccessful) {
    process.stdout.write('\n\x1b[1m\x1b[32m✔ Successfully published discussion!\x1b[0m\n');
    process.stdout.write(`Discussion URL: \x1b[36m${pubResult.url}\x1b[0m\n\n`);
    openBrowser(pubResult.url);
  } else {
    if (pubResult.error) {
      const errLower = pubResult.error.toLowerCase();
      const isAuthError = errLower.includes('auth') || errLower.includes('token') || errLower.includes('credentials') || errLower.includes('login');
      const isCategoryError = errLower.includes('category');
      if (isAuthError) {
        process.stdout.write('\x1b[33mℹ Note: GitHub CLI credentials expired. Run `gh auth login` to enable 1-click publishing.\x1b[0m\n');
      } else if (isCategoryError) {
        process.stdout.write(`\x1b[33mℹ Note: Discussion category "${category}" not found on ${DEFAULT_DISCUSSION_REPO}.\x1b[0m\n`);
      }
    }
    copyToClipboard(body);
    const targetSlug = categorySlug || DISCUSSION_CATEGORY_SLUG || 'npx-chemx-audit';
    const discussionUrl = `${ORG_DISCUSSIONS_URL}/new?category=${encodeURIComponent(targetSlug)}&title=${encodeURIComponent(title)}`;
    process.stdout.write('\n\x1b[32m✔ Formatted audit report copied to your system clipboard!\x1b[0m\n');
    process.stdout.write(`Opening GitHub Discussions composer in default browser:\n  \x1b[36m${discussionUrl}\x1b[0m\n`);
    process.stdout.write('\x1b[33mSimply paste (Ctrl+V / Cmd+V) the body and click "Start discussion"!\x1b[0m\n\n');
    openBrowser(discussionUrl);
  }

  if (hasGum()) {
    gumChoose(['<-- Back to Audit Dashboard']);
  } else {
    await promptQuestion('Press Enter to return to menu...');
  }
};

export const runInteractiveAuditNavigator = async (report, onScaffold = null) => {
  saveAuditSnapshot(report);
  const { metrics, health, hotspots, violations, pillars } = report;
  const { critical, high, medium, low } = groupViolationsBySeverity(violations);
  const highMediumCount = high.length + medium.length;

  const passedPillarsCount = Object.values(pillars || {}).filter((p) => p.status === 'PASSED').length;

  const extremeMonoliths = hotspots.filter((h) => h.lineCount >= 2000);
  const severeMonoliths = hotspots.filter((h) => h.lineCount >= 1000 && h.lineCount < 2000);
  const warningMonoliths = hotspots.filter((h) => h.lineCount >= 500 && h.lineCount < 1000);

  const gradeFCount = critical.length + extremeMonoliths.length;
  const gradeDCount = high.length + severeMonoliths.length;
  const gradeCCount = medium.length + warningMonoliths.length;
  const gradeBCount = low.length;
  const gradeACount = passedPillarsCount;

  const actions = [
    {
      key: 'report',
      tag: '\x1b[36m[Report   ]\x1b[0m',
      label: '📋 Show Full Report (All Sections at Once)',
      action: async () => {
        await showPagedContent(formatTerminalReport(report), buildMasterPrompt(report));
      }
    },
    {
      key: 'progress',
      tag: '\x1b[32m[Progress ]\x1b[0m',
      label: '📈 View Before & After Transformation Progress',
      action: async () => {
        const baseline = getAuditBaseline();
        const history = getAuditHistory();
        const currentSnapshot = createSnapshotFromReport(report);

        let output = '';
        if (baseline) {
          output += formatTransformationTerminal(baseline, currentSnapshot);
        } else {
          output += '\n\x1b[33mNo baseline audit found. Current audit established as baseline.\x1b[0m\n';
        }

        if (history.length > 0) {
          output += '\n\n' + formatHistoryTimelineTerminal(history);
        }

        await showPagedContent(output);
      }
    },
    {
      key: 'share',
      tag: '\x1b[35m[Share    ]\x1b[0m',
      label: `🕵  Post to GitHub Discussions (${DISCUSSION_CATEGORY})`,
      action: async () => {
        await handleShareToDiscussions(report);
      }
    },
    {
      key: 'export',
      tag: '\x1b[36m[Export   ]\x1b[0m',
      label: '💾 Export Markdown Report to File',
      action: async () => {
        const outName = hasGum()
          ? gumInput('Export file path:', 'AUDIT_REPORT.md') || 'AUDIT_REPORT.md'
          : (await promptQuestion('Export file path [AUDIT_REPORT.md]: ')) || 'AUDIT_REPORT.md';
        const md = generateMarkdownReport(report);
        fs.writeFileSync(path.resolve(process.cwd(), outName), md, 'utf-8');
        process.stdout.write(`\x1b[32m✔ Exported markdown audit report to ${outName}\x1b[0m\n\n`);
        if (hasGum()) {
          gumChoose(['<-- Back to Audit Dashboard']);
        }
      }
    },
    {
      key: 'upgrade',
      tag: '\x1b[33m[Upgrade  ]\x1b[0m',
      label: '💎 Unlock Full Molecular Rules & Scaffolding (Chemical X: Power Puff Edition)',
      action: async () => {
        await showConversionMenu(onScaffold);
      }
    }
  ];

  const gradeTiers = [
    {
      grade: 'F',
      count: gradeFCount,
      icon: '❌',
      description: 'Critical Hazards & Extreme Monoliths',
      action: async () => {
        await showPagedContent(formatGradeFSection(report), buildGradeFPrompt(report));
      }
    },
    {
      grade: 'D',
      count: gradeDCount,
      icon: '⚠️ ',
      description: 'High Severity Debts & Severe Monoliths',
      action: async () => {
        await showPagedContent(formatGradeDSection(report), buildGradeDPrompt(report));
      }
    },
    {
      grade: 'C',
      count: gradeCCount,
      icon: '⚡',
      description: 'Medium Severity Debts & Monolith Drift',
      action: async () => {
        await showPagedContent(formatGradeCSection(report), buildGradeCPrompt(report));
      }
    },
    {
      grade: 'B',
      count: gradeBCount,
      icon: 'ℹ️ ',
      description: 'Low Hygiene Issues & Minor Debts',
      action: async () => {
        await showPagedContent(formatGradeBSection(report), buildGradeBPrompt(report));
      }
    },
    {
      grade: 'A',
      count: gradeACount,
      icon: '✅',
      description: 'Compliant Checks & Passing Pillars',
      action: async () => {
        await showPagedContent(formatGradeASection(report));
      }
    }
  ];

  const activeGrades = gradeTiers
    .filter((g) => g.count > 0)
    .map((g) => ({
      key: `grade_${g.grade.toLowerCase()}`,
      grade: g.grade.toLowerCase(),
      tag: resolveGradeBadge(g.grade),
      label: `${g.icon} Grade ${g.grade}: ${g.description} (${g.count} ${g.grade === 'A' ? 'clean' : 'items'})`,
      action: g.action
    }));

  const exitAction = {
    key: 'exit',
    tag: '\x1b[90m[Exit     ]\x1b[0m',
    label: '🚪 Exit',
    action: async () => {}
  };

  const menuItems = [...actions, ...activeGrades, exitAction];
  const menuOptions = [];
  let currentIndex = 1;

  for (const act of actions) {
    act.index = currentIndex;
    const pad = String(currentIndex).padStart(2, ' ');
    menuOptions.push(` ${pad}. ${act.tag} ${act.label}`);
    currentIndex++;
  }

  if (activeGrades.length > 0) {
    menuOptions.push('──────────────────────────────────────────────────────────────────────');
    for (const g of activeGrades) {
      g.index = currentIndex;
      const pad = String(currentIndex).padStart(2, ' ');
      menuOptions.push(` ${pad}. ${g.tag} ${g.label}`);
      currentIndex++;
    }
    menuOptions.push('──────────────────────────────────────────────────────────────────────');
  }

  exitAction.index = currentIndex;
  const exitPad = String(currentIndex).padStart(2, ' ');
  menuOptions.push(` ${exitPad}. ${exitAction.tag} ${exitAction.label}`);

  while (true) {
    if (process.stdout.isTTY) {
      console.clear();
    }
    process.stdout.write(getChemicalXAsciiBanner());

    const gColor = resolveGradeColor(health.grade);
    const critColor = critical.length > 0 ? '\x1b[31;1m' : '\x1b[32m';
    const highMedColor = highMediumCount > 0 ? '\x1b[33;1m' : '\x1b[32m';
    const lowColor = low.length > 0 ? '\x1b[36m' : '\x1b[32m';

    if (hasGum()) {
      spawnSync(
        'gum',
        [
          'style',
          '--border=rounded',
          '--border-foreground=81',
          '--padding=0 2',
          '--bold',
          `\x1b[1m\x1b[38;2;98;201;255mChemical X Protocol: Architectural Audit Dashboard\x1b[0m\n` +
          `Health Score: \x1b[1m\x1b[38;2;98;201;255m${health.score}/100\x1b[0m ${gColor}[Grade: ${health.grade}]\x1b[0m (${gColor}${health.label}\x1b[0m)\n` +
          `Scanned: \x1b[36m${metrics.scannedFiles} files\x1b[0m | LOC: \x1b[36m${metrics.totalLoc}\x1b[0m | Violations: \x1b[33m${violations.length}\x1b[0m\n` +
          `Hazards: ${critColor}${critical.length} Critical\x1b[0m | ${highMedColor}${highMediumCount} High/Med\x1b[0m | ${lowColor}${low.length} Low\x1b[0m`
        ],
        { stdio: 'inherit' }
      );

      const choice = gumChoose(menuOptions, 'Select an audit section or grade to inspect:');
      const cleanChoice = stripAnsi(choice || '').trim();

      const isSeparator = !choice || cleanChoice.includes('───') || cleanChoice.includes('---');
      if (isSeparator) {
        continue;
      }

      const match = menuItems.find((item) => {
        const prefix = `${item.index}.`;
        if (cleanChoice.startsWith(prefix) || cleanChoice === String(item.index)) return true;
        if (item.key === 'exit' && (cleanChoice.includes('Exit') || cleanChoice.toLowerCase() === 'exit')) return true;
        if (item.key === 'report' && cleanChoice.includes('Report')) return true;
        if (item.key === 'share' && cleanChoice.includes('Share')) return true;
        if (item.key === 'export' && cleanChoice.includes('Export')) return true;
        if (item.key === 'upgrade' && (cleanChoice.includes('Upgrade') || cleanChoice.includes('Power Puff') || cleanChoice.includes('Molecular Rules'))) return true;
        if (item.grade && (cleanChoice.toLowerCase().includes(`grade ${item.grade}`) || cleanChoice.toLowerCase().includes(`grade: ${item.grade}`))) return true;
        return false;
      });

      const shouldExit = !match || match.key === 'exit';
      if (shouldExit) {
        break;
      }

      await match.action();
    } else {
      process.stdout.write(
        `\n\x1b[1m\x1b[38;2;98;201;255mChemical X Protocol: Architectural Audit Dashboard\x1b[0m\n` +
        `Health Score: \x1b[1m\x1b[38;2;98;201;255m${health.score}/100\x1b[0m ${gColor}[Grade: ${health.grade}]\x1b[0m (${gColor}${health.label}\x1b[0m)\n` +
        `Scanned: \x1b[36m${metrics.scannedFiles} files\x1b[0m | LOC: \x1b[36m${metrics.totalLoc}\x1b[0m | Violations: \x1b[33m${violations.length}\x1b[0m\n` +
        `Hazards: ${critColor}${critical.length} Critical\x1b[0m | ${highMedColor}${highMediumCount} High/Med\x1b[0m | ${lowColor}${low.length} Low\x1b[0m\n\n`
      );

      for (const opt of menuOptions) {
        process.stdout.write(`  ${opt}\n`);
      }
      process.stdout.write('\n');

      const promptMsg = `Select option [1-${exitAction.index}] (default: ${exitAction.index}): `;
      const selection = await promptQuestion(promptMsg);
      const effective = selection.trim().toLowerCase() || String(exitAction.index);

      const isSep = effective.includes('---') || effective.includes('───');
      if (isSep) continue;

      const match = menuItems.find((item) => {
        if (effective === String(item.index)) return true;
        if (item.key === 'exit' && (effective === 'exit' || effective === String(exitAction.index))) return true;
        if (item.key === effective) return true;
        if (item.grade && (effective === item.grade || effective === `grade ${item.grade}`)) return true;
        return false;
      });

      const shouldExit = !match || match.key === 'exit';
      if (shouldExit) {
        break;
      }

      await match.action();
      await promptQuestion('Press Enter to return to menu...');
    }
  }
};
