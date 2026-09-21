/**
 * cmd-audit.js — Audit command orchestrator.
 * Single responsibility: run the full AST audit pipeline given CLI args.
 * Extracted from cli/index.js per Directive 1.A (Monolith Decomposition).
 */

import { printHelp } from '../help.js';

/**
 * @param {string|null} customDir
 * @param {boolean} isCli
 * @param {string[]} rawArgs  - process.argv slice already resolved by the caller
 * @param {() => object} loadProjectConfig
 */
export const runAudit = async (customDir, isCli, rawArgs, loadProjectConfig) => {
  const {
    runAudit: executeAstAudit,
    formatTerminalReport,
    generateMarkdownReport,
    saveAuditSnapshot,
    copyToClipboard,
    buildMasterPrompt,
    groupViolationsBySeverity
  } = await import('../audit.js');
  const {
    runInteractiveAuditNavigator,
    showConversionMenu,
    handleShareToDiscussions
  } = await import('../navigator.js');
  const { renderDashboardBanner } = await import('../navigator-banner.js');
  const {
    isGradeBelowMinimum,
    evaluateAuditFailure,
    isNonInteractiveSession
  } = await import('../audit/rules-predicates.js');
  const { runAuditPreflight, resolveGitAuditScope } = await import('../audit-preflight.js');
  const { syncSearchIndex, resolveTargetDir, syncViolationsIndex, recordAuditSnapshot } = await import('../search.js');
  const { autoGenerateTasksFromAudit } = await import('../team/index.js');
  const { runScaffold } = await import('../scaffold.js');

  const projectConfig = loadProjectConfig();
  const isJson = rawArgs.includes('--json');
  const isMarkdown = rawArgs.includes('--markdown') || rawArgs.includes('--md');
  const isUnroll = rawArgs.includes('--unroll') || rawArgs.includes('--all');
  const isShare = rawArgs.includes('--share') || rawArgs.includes('--post');
  const isStrict = rawArgs.includes('--strict');
  const isPromptOnFail = rawArgs.includes('--prompt-on-fail');
  const isCopyPrompt = rawArgs.includes('--copy-prompt');

  const dirFlag = rawArgs.find((arg) => arg.startsWith('--dir='));
  const outputFlag = rawArgs.find((arg) => arg.startsWith('--output=') || arg.startsWith('-o='));
  const outputFile = outputFlag ? outputFlag.split('=')[1] : null;

  const minGradeFlag = rawArgs.find((arg) => arg.startsWith('--min-grade='));
  const minGrade = (minGradeFlag ? minGradeFlag.split('=')[1] : (process.env.CHEMX_MIN_GRADE || projectConfig.minGrade || '')).toUpperCase();

  const minScoreFlag = rawArgs.find((arg) => arg.startsWith('--min-score='));
  const minScoreRaw = minScoreFlag ? minScoreFlag.split('=')[1] : (process.env.CHEMX_MIN_SCORE || projectConfig.minScore || null);
  const minScore = minScoreRaw !== null && minScoreRaw !== undefined ? parseInt(String(minScoreRaw), 10) : null;

  const modelFlag = rawArgs.find((arg) => arg.startsWith('--model='));
  const model = modelFlag ? modelFlag.split('=')[1] : (projectConfig.model || 'blended');
  const costFlag = rawArgs.find((arg) => arg.startsWith('--cost-per-million='));
  const costPerMillion = costFlag ? parseFloat(costFlag.split('=')[1]) : null;

  const isNonInteractive = isNonInteractiveSession(rawArgs);
  const isInteractive = !isNonInteractive && Boolean(process.stdin.isTTY && process.stdout.isTTY);

  let targetDir = resolveTargetDir(customDir, dirFlag);
  let isFast = rawArgs.includes('--fast') || rawArgs.includes('--quick');
  let fileList = null;

  const hasGitFlag = rawArgs.includes('--git') || rawArgs.includes('--changed');
  if (hasGitFlag) {
    const gitScope = resolveGitAuditScope(process.cwd());
    if (gitScope.ok) fileList = gitScope.files;
  }

  const shouldRunPreflight = isCli && isInteractive && !isJson && !isMarkdown && !isShare;
  if (shouldRunPreflight) {
    const preflight = await runAuditPreflight(rawArgs, {
      customDir,
      defaultDir: targetDir,
      cwd: process.cwd()
    });
    targetDir = preflight.targetDir;
    isFast = preflight.fast;
    fileList = preflight.fileList;
  }

  const auditOptions = { outputFile, model, costPerMillion, fast: isFast, fileList };
  const report = executeAstAudit(targetDir, auditOptions);
  saveAuditSnapshot(report);
  const syncRes = syncSearchIndex(targetDir, process.cwd());

  if (syncRes?.db) {
    syncViolationsIndex(syncRes.db, report.violations);
    recordAuditSnapshot(syncRes.db, report);
    if (rawArgs.includes('--triage')) {
      const createdTasks = autoGenerateTasksFromAudit(syncRes.db, { cwd: process.cwd(), targetDir });
      if (isCli && !isJson) {
        process.stdout.write(`\x1b[32m✔\x1b[0m Auto-triage generated ${createdTasks.length} team task(s) from audit violations.\n`);
      }
    }
  }

  // Stage 1: Atomic failure predicates
  const isSevereViolation = (v) => v.severity === 'CRITICAL' || v.severity === 'HIGH';
  const hasCriticalOrHigh = report.violations.some(isSevereViolation);
  const hasViolations = report.violations.length > 0;
  const isStrictFail = isStrict && hasViolations;
  const isGradeFail = isGradeBelowMinimum(report.health.grade, minGrade);
  const hasMinScore = minScore !== null && !isNaN(minScore);
  const isScoreFail = hasMinScore && report.health.score < minScore;
  const hasThreshold = Boolean(minGrade) || hasMinScore;
  const isDefaultFail = !hasThreshold && !isStrict && hasCriticalOrHigh;

  // Stage 2: Unified failure decision
  const hasFailingViolations = evaluateAuditFailure([isStrictFail, isDefaultFail, isGradeFail, isScoreFail]);

  if (isJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (isCli) process.exit(hasFailingViolations ? 1 : 0);
    return report;
  }

  if (isMarkdown && !outputFile) {
    const md = generateMarkdownReport(report);
    process.stdout.write(md + '\n');
    if (isCli) process.exit(hasFailingViolations ? 1 : 0);
    return report;
  }

  if (isCli) {
    if (isShare) {
      await handleShareToDiscussions(report);
      process.exit(0);
    }

    if (isInteractive && !isUnroll) {
      const handleReAudit = () => {
        const refreshed = executeAstAudit(targetDir, auditOptions);
        saveAuditSnapshot(refreshed);
        return refreshed;
      };
      await runInteractiveAuditNavigator(
        report,
        () => runScaffold(undefined, rawArgs, (d, cli) => runAudit(d, cli, rawArgs, loadProjectConfig)),
        handleReAudit
      );
    } else {
      if (isUnroll) {
        process.stdout.write(formatTerminalReport(report));
        if (isInteractive) {
          await showConversionMenu(() => runScaffold(undefined, rawArgs, (d, cli) => runAudit(d, cli, rawArgs, loadProjectConfig)));
        }
      } else {
        const { critical, high, medium, low } = groupViolationsBySeverity(report.violations);
        const highMediumCount = high.length + medium.length;
        renderDashboardBanner(
          report.health,
          report.metrics,
          report.violations,
          critical,
          highMediumCount,
          low,
          report.contextAnalysis,
          report.aiSlop,
          { clear: false }
        );

        if (hasFailingViolations && !isInteractive) {
          process.stdout.write('\n\x1b[1m\x1b[31m✕ [Chemical X] Architectural health verification failed:\x1b[0m\n');
          if (isGradeFail) process.stdout.write(`  \x1b[31m•\x1b[0m Grade ${report.health.grade} is below required minimum tier ${minGrade}\n`);
          if (isScoreFail) process.stdout.write(`  \x1b[31m•\x1b[0m Score ${report.health.score}/100 is below required minimum score ${minScore}/100\n`);
          if (isDefaultFail) process.stdout.write(`  \x1b[31m•\x1b[0m Unresolved hazards: ${critical.length} Critical, ${high.length} High (run 'chemx audit --unroll' to inspect)\n`);
          if (isStrictFail) process.stdout.write(`  \x1b[31m•\x1b[0m Strict mode: ${report.violations.length} total violation(s) detected\n`);
          process.stdout.write('  \x1b[36m💡 Convert hazards into team tasks: chemx team task triage\x1b[0m\n');
        }
      }
    }

    if (hasFailingViolations && (isPromptOnFail || isCopyPrompt)) {
      const prompt = buildMasterPrompt(report);
      if (prompt) {
        const copied = copyToClipboard(prompt);
        if (copied) {
          process.stdout.write('\n\x1b[1m\x1b[32m✔ AI Agent refactoring prompt copied to clipboard!\x1b[0m\n');
          process.stdout.write('\x1b[36mPaste directly into Cursor, Claude, or Windsurf to resolve architectural hazards.\x1b[0m\n\n');
        } else if (isCopyPrompt) {
          process.stdout.write('\n\x1b[33m⚠ Could not access system clipboard.\x1b[0m\n\n');
        }
      }
    }

    process.exit(hasFailingViolations ? 1 : 0);
  }

  process.stdout.write(formatTerminalReport(report));
  return report;
};
