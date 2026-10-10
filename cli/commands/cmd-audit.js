/**
 * cmd-audit.js: Audit command orchestrator.
 * Single responsibility: run the full AST audit pipeline given CLI args.
 * Extracted from cli/index.js per Directive 1.A (Monolith Decomposition).
 */

import path from 'node:path';
import { isStdinTty, isStdoutTty } from '../terminal.js';

/**
 * @param {string|null} customDir
 * @param {boolean} isCli
 * @param {string[]} rawArgs  - process.argv slice already resolved by the caller
 * @param {() => object} loadProjectConfig
 */
export const runAudit = async (customDir, isCli, rawArgs, loadProjectConfig) => {
  // Core imports only. Presentation (navigator, dashboard banner, terminal report) is loaded
  // inside the branches that render for a human terminal (cli/seam.spec.js).
  const { runAudit: executeAstAudit } = await import('../audit-engine.js');
  const { saveAuditSnapshot } = await import('../audit/history.js');
  const { groupViolationsBySeverity } = await import('../audit/reporter-utils.js');
  const {
    isGradeBelowMinimum,
    evaluateAuditFailure,
    isNonInteractiveSession
  } = await import('../audit/rules-predicates.js');
  const { resolveGitAuditScope, resolveStagedAuditScope } = await import('../audit-preflight-git.js');
  const { syncSearchIndex, syncViolationsIndex } = await import('../search.js');
  const { resolveAuditScope, toRelDir } = await import('../audit-scope.js');
  const { computeGateVerdict } = await import('../audit/gate-verdict.js');
  const { buildAuditSummary } = await import('../audit/audit-summary.js');
  const { writeRatchet, RATCHET_FILE } = await import('../audit/ratchet.js');
  const { writeAuditStatus } = await import('../audit/status-file.js');
  const { loadProjectConfig: loadSharedConfig } = await import('../config/index.js');
  const { triageFromIndex } = await import('../team/team-commands-triage.js');
  const loadNavigator = () => import('../navigator.js');
  const formatTerminalReport = async (r) => (await import('../audit/reporter.js')).formatTerminalReport(r);
  const runScaffold = async (...args) => (await import('../scaffold.js')).runScaffold(...args);

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
  const isInteractive = !isNonInteractive && isStdinTty() && isStdoutTty();

  const isCustomDirFlag = Boolean(customDir?.startsWith('--dir='));
  const customDirValue = isCustomDirFlag ? customDir.split('=')[1] : customDir;
  const explicitDir = customDirValue || (dirFlag ? dirFlag.split('=')[1] : null);
  const resolvedScope = resolveAuditScope({ projectRoot: process.cwd(), explicitDir });
  const isStagedScope = rawArgs.includes('--staged');
  const hasGitFlag = rawArgs.includes('--git') || rawArgs.includes('--changed') || isStagedScope;
  const isGitScopedAmbiguity = hasGitFlag && resolvedScope.reason === 'ambiguous';
  const scope = isGitScopedAmbiguity ? { ok: true, dir: process.cwd(), relDir: '.', source: 'git' } : resolvedScope;
  const hasScopeError = !scope.ok;
  if (hasScopeError) {
    const refusal = { success: false, error: scope.message, reason: scope.reason, candidates: scope.candidates };
    process.stdout.write(isJson ? `${JSON.stringify(refusal)}\n` : `\x1b[31m✖ ${scope.message}\x1b[0m\n`);
    if (isCli) process.exit(1);
    return refusal;
  }
  let targetDir = scope.dir;
  let isFast = rawArgs.includes('--fast') || rawArgs.includes('--quick');
  let fileList = null;

  if (hasGitFlag) {
    const gitScope = isStagedScope ? resolveStagedAuditScope(process.cwd()) : resolveGitAuditScope(process.cwd());
    const hasUsableGitScope = Boolean(gitScope.ok || isStagedScope);
    if (hasUsableGitScope) fileList = gitScope.files;
  }
  // An empty staged list is a vacuous pass for a commit gate, never a silent whole-project scan.
  const hasNothingStaged = isStagedScope && fileList.length === 0;
  if (hasNothingStaged) {
    const empty = { files: 0, scope: 'staged', gate: { passing: true, basis: 'staged', note: 'No staged source files to audit.' } };
    process.stdout.write(isJson ? `${JSON.stringify(empty)}\n` : `${empty.gate.note}\n`);
    return empty;
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

  const shouldRunPreflight = isCli && isInteractive && !isJson && !isMarkdown && !isShare && !isStagedScope;
  if (shouldRunPreflight) {
    const { runAuditPreflight } = await import('../audit-preflight.js');
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
  // The Forge ledger rides on audits that also sync the index (not pre-commit, --no-index or --no-fingerprint).
  const isFingerprintOptOut = rawArgs.includes('--no-index') || rawArgs.includes('--no-fingerprint');
  const isFingerprinting = !isFingerprintOptOut && !isStagedScope;
  const auditOptions = { outputFile, model, costPerMillion, fast: isFast, fileList, stage, config: auditConfig, includeTests, fingerprint: isFingerprinting };
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
  report.scope = auditRelDir;
  const historyScope = { scope: auditRelDir, isPartial: isPartialAudit };
  saveAuditSnapshot(report, process.cwd(), historyScope);
  const hasSkippedConflicts = report.skippedConflicts?.length > 0;
  if (hasSkippedConflicts) {
    const { describeSkipped } = await import('../conflicts.js');
    process.stderr.write(`⚠ audit ${describeSkipped(report.skippedConflicts)}\n`);
  }
  // Triage needs a full-scope audit and the index sync: partial runs vouch for only some files.
  const isTriageOptOut = rawArgs.includes('--no-triage');
  const hasIndexSync = !rawArgs.includes('--no-index') && !isStagedScope;
  // --git / --changed that fell back to a full scan (nothing changed) is still a git-scoped intent.
  const isPartialIntent = isPartialAudit || hasGitFlag;
  // Triage writes to the shared team db, so it runs only when asked: --triage or .chemxrc autoTriage: true (#5480).
  const isTriageRequested = rawArgs.includes('--triage');
  const isTriageEnabled = isTriageRequested || projectConfig?.autoTriage === true;
  const shouldTriage = isTriageEnabled && !isTriageOptOut && !isPartialIntent && hasIndexSync;
  const isTriageIgnored = isTriageRequested && !shouldTriage && !isTriageOptOut;
  if (isTriageIgnored) {
    process.stderr.write('triage skipped: partial scan (--fast/--git/--staged) or --no-index\n');
  }
  let hasTriaged = false;
  try {
    // Pre-commit runs skip the full index sync (tens of seconds); the audit itself needs no index.
    const shouldSyncIndex = hasIndexSync;
    const syncRes = shouldSyncIndex ? syncSearchIndex(targetDir, process.cwd()) : null;

    const hasSyncDb = Boolean(syncRes?.db);
    if (hasSyncDb) {
      // A --fast or --git audit checks only part of the scope, so it vouches for no file.
      syncViolationsIndex(syncRes.db, report.violations, { scope: isPartialAudit ? null : syncRes.scope });
      if (shouldTriage) {
        // Hazards come from this package's index; tasks go to the team db for the cwd (#2488).
        const triaged = triageFromIndex(syncRes.db, { cwd: process.cwd(), targetDir });
        const createdTasks = triaged.created;
        hasTriaged = true;
        const { listTasks } = await import('../team/index.js');
        const { collectTaskRules } = await import('../audit/prompt-rule-lines.js');
        report.taskRules = collectTaskRules(listTasks(triaged.teamDb, { repo: triaged.repo }));
        const shouldLogTriage = isCli && !isJson && createdTasks.length > 0;
        if (shouldLogTriage) {
          process.stdout.write(`\x1b[32m✔\x1b[0m Auto-triage synchronized ${createdTasks.length} team task(s) in SQLite backlog.\n`);
        }
      }
      const hasClonesFlag = rawArgs.includes('--clones');
      if (hasClonesFlag) {
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
      const hasHotspotGraphFlag = rawArgs.includes('--hotspot-graph');
      if (hasHotspotGraphFlag) {
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
    const isDebugEnabled = Boolean(process.env.DEBUG);
    if (isDebugEnabled) process.stderr.write(`[debug] Indexing bypassed: ${err?.message}\n`);
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
  const thresholdNotes = [
    isGradeFail && `grade ${report.health.grade} is below minimum ${minGrade}`,
    isScoreFail && `score ${report.health.score} is below minimum ${minScore}`,
    isStrictFail && `strict mode: ${report.violations.length} violation(s)`
  ].filter(Boolean);
  const hasThresholdFailure = !isDraft && thresholdNotes.length > 0;
  report.gate = hasThresholdFailure
    ? { ...report.gate, isPassing: false, basis: 'threshold', note: thresholdNotes.join('; ') }
    : { ...report.gate, isPassing: !hasFailingViolations };
  writeAuditStatus(process.cwd(), { scope: auditRelDir, report });

  if (isJson) {
    const isFullJson = rawArgs.includes('--full');
    const payload = isFullJson ? report : buildAuditSummary(report, { projectRoot: process.cwd(), scope: auditRelDir });
    process.stdout.write(JSON.stringify(payload, null, isFullJson ? 2 : 0) + '\n');
    if (isCli) process.exitCode = hasFailingViolations ? 1 : 0;
    return report;
  }

  const hasMarkdownStdout = Boolean(isMarkdown && !outputFile);
  if (hasMarkdownStdout) {
    const { generateMarkdownReport } = await import('../audit/reporter-markdown.js');
    const md = generateMarkdownReport(report);
    process.stdout.write(md + '\n');
    if (isCli) process.exitCode = hasFailingViolations ? 1 : 0;
    return report;
  }

  if (isCli) {
    if (isShare) {
      const { handleShareToDiscussions } = await loadNavigator();
      const { shareExitCode, hasYesFlag } = await import('../share-consent.js');
      const shared = await handleShareToDiscussions(report, { isYes: hasYesFlag(rawArgs) });
      process.exit(shareExitCode(shared));
    }

    const shouldPromptInteractive = Boolean(isInteractive && !isUnroll);
    if (shouldPromptInteractive) {
      const handleReAudit = () => {
        const refreshed = executeAstAudit(targetDir, auditOptions);
        refreshed.taskRules = report.taskRules;
        saveAuditSnapshot(refreshed, process.cwd(), historyScope);
        return refreshed;
      };
      const { runInteractiveAuditNavigator } = await loadNavigator();
      await runInteractiveAuditNavigator(
        report,
        () => runScaffold(undefined, rawArgs, (d, cli) => runAudit(d, cli, rawArgs, loadProjectConfig)),
        handleReAudit
      );
    } else {
      if (isUnroll) {
        process.stdout.write(await formatTerminalReport(report));
        if (isInteractive) {
          const { showConversionMenu } = await loadNavigator();
          await showConversionMenu(() => runScaffold(undefined, rawArgs, (d, cli) => runAudit(d, cli, rawArgs, loadProjectConfig)));
        }
      } else {
        const { critical, high, medium, low } = groupViolationsBySeverity(report.violations);
        const highMediumCount = high.length + medium.length;
        const isHumanTerminal = isStdoutTty();
        if (isHumanTerminal) {
          const { renderDashboardBanner } = await import('../navigator-banner.js');
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
        } else {
          const { formatPlainAuditSummary } = await import('../audit/audit-plain.js');
          const summary = buildAuditSummary(report, { projectRoot: process.cwd(), scope: auditRelDir });
          process.stdout.write(formatPlainAuditSummary(summary));
        }

        const shouldPrintFailureSummary = Boolean(hasFailingViolations && !isInteractive);
        if (shouldPrintFailureSummary) {
          process.stdout.write('\n\x1b[1m\x1b[31m✕ [Chemical X] Architectural health verification failed:\x1b[0m\n');
          if (isGradeFail) process.stdout.write(`  \x1b[31m•\x1b[0m Grade ${report.health.grade} is below required minimum tier ${minGrade}\n`);
          if (isScoreFail) process.stdout.write(`  \x1b[31m•\x1b[0m Score ${report.health.score}/100 is below required minimum score ${minScore}/100\n`);
          if (isDefaultFail) process.stdout.write(`  \x1b[31m•\x1b[0m Unresolved hazards: ${critical.length} Critical, ${high.length} High (run 'chemx audit --unroll' to inspect)\n`);
          if (isStrictFail) process.stdout.write(`  \x1b[31m•\x1b[0m Strict mode: ${report.violations.length} total violation(s) detected\n`);
          if (!hasTriaged) process.stdout.write('  \x1b[36m💡 Convert hazards into team tasks (opt-in, writes to the shared board): chemx audit --triage\x1b[0m\n');
        }
      }
    }

    const shouldBuildPrompt = Boolean(hasFailingViolations && (isPromptOnFail || isCopyPrompt));
    if (shouldBuildPrompt) {
      const { buildMasterPrompt } = await import('../audit/prompts.js');
      const { copyToClipboard } = await import('../audit/social-git.js');
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

  process.stdout.write(await formatTerminalReport(report));
  return report;
};
