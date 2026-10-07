/**
 * cmd-audit.js: Audit command orchestrator.
 * Single responsibility: run the full AST audit pipeline given CLI args.
 * Extracted from cli/index.js per Directive 1.A (Monolith Decomposition).
 */

import path from 'node:path';
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
  const { syncSearchIndex, syncViolationsIndex, recordAuditSnapshot } = await import('../search.js');
  const { resolveAuditScope, toRelDir } = await import('../audit-scope.js');
  const { computeGateVerdict } = await import('../audit/gate-verdict.js');
  const { writeRatchet, RATCHET_FILE } = await import('../audit/ratchet.js');
  const { loadProjectConfig: loadSharedConfig } = await import('../config/index.js');
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

  const stageFlag = rawArgs.find((arg) => arg.startsWith('--stage='));
  let stage = 'strict';
  if (stageFlag) {
    stage = stageFlag.split('=')[1];
  } else if (rawArgs.includes('--relax') || rawArgs.includes('--draft')) {
    stage = 'draft';
  } else if (isStrict) {
    stage = 'strict';
  } else if (projectConfig.stage) {
    stage = projectConfig.stage;
  }
  const isDraft = stage === 'draft';

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

  const isCustomDirFlag = Boolean(customDir?.startsWith('--dir='));
  const customDirValue = isCustomDirFlag ? customDir.split('=')[1] : customDir;
  const explicitDir = customDirValue || (dirFlag ? dirFlag.split('=')[1] : null);
  const resolvedScope = resolveAuditScope({ projectRoot: process.cwd(), explicitDir });
  const hasGitFlag = rawArgs.includes('--git') || rawArgs.includes('--changed');
  const isGitScopedAmbiguity = hasGitFlag && resolvedScope.reason === 'ambiguous';
  const scope = isGitScopedAmbiguity ? { ok: true, dir: process.cwd(), relDir: '.', source: 'git' } : resolvedScope;
  if (!scope.ok) {
    const refusal = { success: false, error: scope.message, reason: scope.reason, candidates: scope.candidates };
    process.stdout.write(isJson ? `${JSON.stringify(refusal)}\n` : `\x1b[31m✖ ${scope.message}\x1b[0m\n`);
    if (isCli) process.exit(1);
    return refusal;
  }
  let targetDir = scope.dir;
  let isFast = rawArgs.includes('--fast') || rawArgs.includes('--quick');
  let fileList = null;

  if (hasGitFlag) {
    const gitScope = resolveGitAuditScope(process.cwd());
    if (gitScope.ok) fileList = gitScope.files;
  }

  const isRebaseline = rawArgs.includes('--rebaseline');
  const isPartialScan = hasGitFlag || isFast;
  const isPartialRebaseline = isRebaseline && isPartialScan;
  if (isPartialRebaseline) {
    const message = '--rebaseline needs a full scan; drop --git, --changed, --fast, and --quick.';
    process.stdout.write(isJson ? `${JSON.stringify({ success: false, error: message })}\n` : `\x1b[31m✖ ${message}\x1b[0m\n`);
    if (isCli) process.exit(1);
    return { success: false, error: message };
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

  const includeTests = rawArgs.includes('--include-tests') || rawArgs.includes('--tests');
  const auditConfig = loadSharedConfig(process.cwd(), rawArgs);
  const auditOptions = { outputFile, model, costPerMillion, fast: isFast, fileList, stage, config: auditConfig, includeTests };
  const report = executeAstAudit(targetDir, auditOptions);
  const auditRelDir = toRelDir(process.cwd(), path.resolve(process.cwd(), targetDir));
  if (isRebaseline) {
    const ratchet = writeRatchet(process.cwd(), { scope: auditRelDir, violations: report.violations });
    const ruleCount = Object.keys(ratchet.rules).length;
    report.rebaseline = { file: RATCHET_FILE, scope: auditRelDir, rules: ruleCount, violations: report.totalViolations };
    if (!isJson) process.stdout.write(`\x1b[32m✔\x1b[0m Recorded ${RATCHET_FILE} for scope "${auditRelDir}": ${ruleCount} rules, ${report.totalViolations} violations\n`);
  }
  const isPartialAudit = Boolean(fileList) || isFast;
  report.gate = computeGateVerdict({ projectRoot: process.cwd(), scope: auditRelDir, violations: report.violations, isPartialScan: isPartialAudit });
  saveAuditSnapshot(report);
  try {
    const syncRes = syncSearchIndex(targetDir, process.cwd());

    if (syncRes?.db) {
      syncViolationsIndex(syncRes.db, report.violations);
      const shouldTriage = rawArgs.includes('--triage');
      if (shouldTriage) {
        const createdTasks = autoGenerateTasksFromAudit(syncRes.db, { cwd: process.cwd(), targetDir });
        const shouldLogTriage = isCli && !isJson && createdTasks.length > 0;
        if (shouldLogTriage) {
          process.stdout.write(`\x1b[32m✔\x1b[0m Auto-triage synchronized ${createdTasks.length} team task(s) in SQLite backlog.\n`);
        }
      }
      if (rawArgs.includes('--clones')) {
        const { detectSemanticClones } = await import('../audit/clone-detector.js');
        const { formatCloneReport } = await import('../audit/reporter-clones.js');
        const cloneThresholdArg = rawArgs.find((a) => a.startsWith('--clone-threshold='));
        const threshold = cloneThresholdArg ? parseFloat(cloneThresholdArg.split('=')[1]) : 0.85;
        const clones = detectSemanticClones(syncRes.db, { threshold });
        if (isJson) {
          report.clones = clones;
        } else {
          process.stdout.write(formatCloneReport(clones));
        }
      }
      if (rawArgs.includes('--hotspot-graph')) {
        const { calculateCascadingHotspotGraph } = await import('../search-queries-hotspot-graph.js');
        const { formatHotspotGraphReport } = await import('../audit/reporter-hotspot-graph.js');
        const limitArg = rawArgs.find((a) => a.startsWith('--limit='));
        const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 10;
        const graph = calculateCascadingHotspotGraph(syncRes.db, { limit });
        if (isJson) {
          report.hotspotGraph = graph;
        } else {
          process.stdout.write(formatHotspotGraphReport(graph));
        }
      }
    }
  } catch (err) {
    if (process.env.DEBUG) process.stderr.write(`[debug] Indexing bypassed: ${err?.message}\n`);
  }

  // Stage 1: Atomic failure predicates
  const isCriticalViolation = (v) => v.severity === 'CRITICAL';
  const hasCritical = report.violations.some(isCriticalViolation);
  const hasViolations = report.violations.length > 0;
  const isStrictFail = isStrict && hasViolations;
  const isGradeFail = isGradeBelowMinimum(report.health.grade, minGrade);
  const hasMinScore = minScore !== null && !isNaN(minScore);
  const isScoreFail = hasMinScore && report.health.score < minScore;
  const hasThreshold = Boolean(minGrade) || hasMinScore;
  const isDefaultFail = !hasThreshold && !isStrict && !report.gate.isPassing;

  // Stage 2: Unified failure decision
  const hasStandardFailure = evaluateAuditFailure([isStrictFail, isDefaultFail, isGradeFail, isScoreFail]);
  const hasFailingViolations = isDraft ? hasCritical : hasStandardFailure;

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
