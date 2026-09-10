#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  runAudit as executeAstAudit,
  auditFile,
  formatTerminalReport,
  generateMarkdownReport,
  saveAuditSnapshot
} from './audit.js';
import {
  runScaffold,
  runInit,
  runGenerateCapsule,
  printHelp
} from './scaffold.js';
import {
  runInteractiveAuditNavigator,
  showConversionMenu,
  handleShareToDiscussions
} from './navigator.js';

const rawArgs = process.argv.slice(2);
const invokedBin = path.basename(process.argv[1] || '');
const isCreateInvoked =
  invokedBin.includes('create-chemx') || (rawArgs[0] && rawArgs[0] === 'create');

const resolveTargetDir = (custom, flag) => {
  if (custom) return custom;
  if (flag) return flag.split('=')[1];
  if (fs.existsSync('src')) return 'src';
  return '.';
};

export const runAudit = async (customDir = null, isCli = false) => {
  const isJson = rawArgs.includes('--json');
  const isMarkdown = rawArgs.includes('--markdown') || rawArgs.includes('--md');
  const isUnroll = rawArgs.includes('--unroll') || rawArgs.includes('--all');
  const isShare = rawArgs.includes('--share') || rawArgs.includes('--post');
  const isStrict = rawArgs.includes('--strict');
  const dirFlag = rawArgs.find((arg) => arg.startsWith('--dir='));
  const outputFlag = rawArgs.find((arg) => arg.startsWith('--output=') || arg.startsWith('-o='));
  const outputFile = outputFlag ? outputFlag.split('=')[1] : null;

  const targetDir = resolveTargetDir(customDir, dirFlag);
  const report = executeAstAudit(targetDir, { outputFile });
  saveAuditSnapshot(report);

  if (isJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (isCli) process.exit(report.violations.length > 0 ? 1 : 0);
    return report;
  }

  if (isMarkdown) {
    const md = generateMarkdownReport(report);
    process.stdout.write(md + '\n');
    if (isCli) process.exit(report.violations.length > 0 ? 1 : 0);
    return report;
  }

  if (outputFile) {
    process.stdout.write(`\x1b[32m✔ Exported markdown audit report to:\x1b[0m ${outputFile}\n\n`);
  }

  if (isCli) {
    if (isShare) {
      await handleShareToDiscussions(report);
      process.exit(0);
    }

    const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

    if (isInteractive && !isUnroll) {
      await runInteractiveAuditNavigator(report, () => runScaffold(undefined, rawArgs, runAudit));
    } else {
      process.stdout.write(formatTerminalReport(report));
      if (isInteractive && isUnroll) {
        await showConversionMenu(() => runScaffold(undefined, rawArgs, runAudit));
      }
    }

    const hasFailingViolations = isStrict
      ? report.violations.length > 0
      : report.violations.some((v) => v.severity === 'CRITICAL' || v.severity === 'HIGH');
    process.exit(hasFailingViolations ? 1 : 0);
  }

  process.stdout.write(formatTerminalReport(report));
  return report;
};

export { auditFile };

const main = async () => {
  const firstArg = rawArgs[0];

  if (isCreateInvoked) {
    const dirArg = firstArg === 'create' ? rawArgs[1] : firstArg;
    await runScaffold(dirArg, rawArgs, runAudit);
    return;
  }

  switch (firstArg) {
    case 'audit':
      await runAudit(null, true);
      break;
    case 'init':
      await runInit(rawArgs[1] || 'src/chemical-x', rawArgs, runAudit);
      break;
    case 'create':
      await runScaffold(rawArgs[1], rawArgs, runAudit);
      break;
    case 'generate':
    case 'capsule':
    case 'add':
      if (!rawArgs[1]) {
        process.stderr.write(
          'Usage: npx chemx generate <capsule-name>\nExample: npx chemx generate m-user-avatar\n'
        );
        process.exit(1);
      }
      runGenerateCapsule(rawArgs[1]);
      break;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      if (firstArg && firstArg.startsWith('m-')) {
        runGenerateCapsule(firstArg);
      } else if (firstArg && !firstArg.startsWith('-')) {
        await runScaffold(firstArg, rawArgs, runAudit);
      } else {
        printHelp();
      }
      break;
  }
};

main().catch((err) => {
  process.stderr.write(`\x1b[31m✕ Unexpected Error: ${err.message}\x1b[0m\n`);
  process.exit(1);
});
