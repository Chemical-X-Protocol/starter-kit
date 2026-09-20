#!/usr/bin/env node

import './silence-warnings.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runAudit as executeAstAudit,
  auditFile,
  formatTerminalReport,
  generateMarkdownReport,
  saveAuditSnapshot,
  copyToClipboard,
  buildMasterPrompt,
  groupViolationsBySeverity
} from './audit.js';
import {
  runScaffold,
  runInit,
  runGenerateCapsule,
  runGenerateWizard,
  printHelp
} from './scaffold.js';
import {
  runInteractiveAuditNavigator,
  showConversionMenu,
  handleShareToDiscussions
} from './navigator.js';
import { renderDashboardBanner } from './navigator-banner.js';
import {
  isGradeBelowMinimum,
  evaluateAuditFailure,
  isNonInteractiveSession
} from './audit/rules-predicates.js';
import { runAuditPreflight, resolveGitAuditScope } from './audit-preflight.js';
import { runInstallWizard } from './installer.js';
import { runPillarsWizard } from './pillars-wizard.js';
import { runBadgeCommand } from './badge.js';
import { runBuildAudit } from './build.js';
import { runSearch, syncSearchIndex, resolveTargetDir, syncViolationsIndex, recordAuditSnapshot, handleCheckCommand } from './search.js';
import { runMutatorCli } from './mutators.js';
import { runReaderCli, readTokenOptimized } from './reader.js';
import { runPatcherCli, patchFile, runWriterCli, writeFile } from './patcher.js';
import { runMcpServer, runMcpInstaller } from './mcp/index.js';
import { runTypecheckAudit, runTestAudit, runProjectVerify } from './verify.js';
import { runTeamCli, autoGenerateTasksFromAudit } from './team/index.js';
import { startUiServer } from './ui-server.js';
import { sanitizeOutputStreams } from './terminal.js';
import {
  handleError,
  installGlobalErrorCatcher,
  withErrorCatcher,
  publishIssue
} from './errors/index.js';

sanitizeOutputStreams();
installGlobalErrorCatcher();

const getPackageVersion = () => {
  try {
    const pkgPath = new URL('../package.json', import.meta.url);
    const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent);
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
};

const rawArgs = process.argv.slice(2);
const invokedBin = path.basename(process.argv[1] || '');
const CAPSULE_PREFIXES = ['m-', 'a-', 'o-', 't-', 'use-', 'v-'];

const isCapsulePrefix = (arg) => CAPSULE_PREFIXES.some((prefix) => arg.startsWith(prefix));

const loadProjectConfig = () => {
  const cfgPath = path.resolve(process.cwd(), '.chemx', 'config.json');
  if (!fs.existsSync(cfgPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return {};
  }
};

export const runAudit = async (customDir = null, isCli = false) => {
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
    if (gitScope.ok) {
      fileList = gitScope.files;
    }
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

  const auditOptions = {
    outputFile,
    model,
    costPerMillion,
    fast: isFast,
    fileList
  };

  const report = executeAstAudit(targetDir, auditOptions);
  saveAuditSnapshot(report);
  const syncRes = syncSearchIndex(targetDir, process.cwd());
  if (syncRes?.db) {
    syncViolationsIndex(syncRes.db, report.violations);
    recordAuditSnapshot(syncRes.db, report);

    const isTriage = rawArgs.includes('--triage');
    if (isTriage) {
      const createdTasks = autoGenerateTasksFromAudit(syncRes.db, { cwd: process.cwd(), targetDir });
      if (isCli && !isJson) {
        process.stdout.write(`\x1b[32m✔\x1b[0m Auto-triage generated ${createdTasks.length} team task(s) from audit violations.\n`);
      }
    }
  }

  const isSevereViolation = (v) => {
    const isCritical = v.severity === 'CRITICAL';
    const isHigh = v.severity === 'HIGH';
    return isCritical || isHigh;
  };

  const hasCriticalOrHigh = report.violations.some(isSevereViolation);
  const hasViolations = report.violations.length > 0;
  const isStrictFail = isStrict && hasViolations;
  const isGradeFail = isGradeBelowMinimum(report.health.grade, minGrade);
  const hasMinScore = minScore !== null && !isNaN(minScore);
  const isScoreFail = hasMinScore && report.health.score < minScore;
  const hasThreshold = Boolean(minGrade) || hasMinScore;
  const isDefaultFail = !hasThreshold && !isStrict && hasCriticalOrHigh;
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
        () => runScaffold(undefined, rawArgs, runAudit),
        handleReAudit
      );
    } else {
      if (isUnroll) {
        process.stdout.write(formatTerminalReport(report));
        if (isInteractive) {
          await showConversionMenu(() => runScaffold(undefined, rawArgs, runAudit));
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
          if (isGradeFail) {
            process.stdout.write(`  \x1b[31m•\x1b[0m Grade ${report.health.grade} is below required minimum tier ${minGrade}\n`);
          }
          if (isScoreFail) {
            process.stdout.write(`  \x1b[31m•\x1b[0m Score ${report.health.score}/100 is below required minimum score ${minScore}/100\n`);
          }
          if (isDefaultFail) {
            process.stdout.write(`  \x1b[31m•\x1b[0m Unresolved hazards: ${critical.length} Critical, ${high.length} High (run 'chemx audit --unroll' to inspect)\n`);
          }
          if (isStrictFail) {
            process.stdout.write(`  \x1b[31m•\x1b[0m Strict mode: ${report.violations.length} total violation(s) detected\n`);
          }
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

export {
  auditFile,
  runBuildAudit,
  runSearch,
  syncSearchIndex,
  runMcpServer,
  runMcpServer as startMcpServer,
  runMcpInstaller,
  runReaderCli,
  readTokenOptimized,
  runPatcherCli,
  patchFile,
  runWriterCli,
  writeFile,
  runTeamCli,
  runPillarsWizard,
  handleError,
  withErrorCatcher,
  publishIssue
};

const main = async () => {
  const firstArg = rawArgs[0];

  switch (firstArg) {
    case 'team':
    case 'swarm':
    case 'feed':
      runTeamCli(rawArgs.slice(1), true);
      break;
    case 'mcp':
    case 'mcp-server':
    case 'server':
      await runMcpServer(rawArgs.slice(1));
      break;
    case 'read':
    case 'view':
      runReaderCli(rawArgs.slice(1), true);
      break;
    case 'patch':
    case 'edit':
      runPatcherCli(rawArgs.slice(1), true);
      break;
    case 'write':
      runWriterCli(rawArgs.slice(1), true);
      break;
    case 'search':
    case 'q':
    case 'query':
    case 'find':
      await runSearch(rawArgs.slice(1), true);
      break;
    case 'build':
    case 'run':
    case 'wrap':
      await runBuildAudit(rawArgs.slice(1), true);
      break;
    case 'audit': {
      const posDir = (rawArgs[1] && !rawArgs[1].startsWith('-')) ? rawArgs[1] : null;
      await runAudit(posDir, true);
      break;
    }
    case 'init':
      await runInit(rawArgs[1] || 'src/chemical-x', rawArgs, runAudit);
      break;
    case 'create':
    case 'scaffold': {
      const nonFlagArgs = rawArgs.slice(1).filter((arg) => !arg.startsWith('-'));
      await runScaffold(nonFlagArgs[0], rawArgs, runAudit);
      break;
    }
    case 'hook':
    case 'hooks':
    case 'install-hooks':
    case 'setup-ci':
      await runInstallWizard(rawArgs[1] || process.cwd());
      break;
    case 'pillars':
    case 'rules':
    case 'config:pillars':
      await runPillarsWizard(rawArgs.slice(1), process.cwd());
      break;
    case 'check':
      handleCheckCommand(rawArgs[1], {
        isJson: rawArgs.includes('--json'),
        isCli: true
      });
      break;
    case 'add:prop':
    case 'add:state':
    case 'add:action':
    case 'fix':
      await runMutatorCli(rawArgs, true);
      break;
    case 'add':
      if (['prop', 'state', 'action'].includes(rawArgs[1])) {
        await runMutatorCli(rawArgs, true);
      } else {
        await runGenerateWizard(rawArgs.slice(1));
      }
      break;
    case 'g':
    case 'gen':
    case 'generate':
    case 'capsule':
      await runGenerateWizard(rawArgs.slice(1));
      break;
    case 'badge':
    case 'badges':
      await runBadgeCommand(rawArgs.slice(1));
      break;
    case 'install-mcp':
    case 'setup-mcp':
      await runMcpInstaller(rawArgs.slice(1));
      break;
    case '-v':
    case '--version':
    case 'version':
      process.stdout.write(`create-chemx v${getPackageVersion()}\n`);
      break;
    case 'verify':
    case 'check:all':
      await runProjectVerify(rawArgs.slice(1), true);
      break;
    case 'typecheck':
    case 'check:types':
    case 'tsc':
      await runTypecheckAudit(rawArgs.slice(1), true);
      break;
    case 'test':
    case 'tests':
    case 'check:test':
      await runTestAudit(rawArgs.slice(1), true);
      break;
    case 'ui':
    case 'preview':
    case 'dashboard':
      {
        const portArg = rawArgs.find((a) => a.startsWith('--port='));
        const port = portArg ? parseInt(portArg.split('=')[1], 10) : 4173;
        await startUiServer({ port, isCli: true, cwd: process.cwd() });
      }
      break;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      if (!firstArg) {
        printHelp();
      } else if (isCapsulePrefix(firstArg)) {
        await runGenerateWizard(rawArgs);
      } else {
        process.stderr.write(`\x1b[31mError:\x1b[0m Unknown command "${firstArg}".\n`);
        process.stderr.write(`Run "chemx --help" for a list of available commands.\n\n`);
        process.exit(1);
      }
      break;
  }
};

const isDirectExecution = () => {
  if (!process.argv[1]) return false;
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const invokedFile = fs.realpathSync(process.argv[1]);
    return currentFile === invokedFile;
  } catch {
    return false;
  }
};

if (isDirectExecution()) {
  main().catch(async (err) => {
    await handleError(err, {
      command: process.argv.slice(2).join(' '),
      cwd: process.cwd(),
      exitCode: 1
    });
    process.exit(1);
  });
}
