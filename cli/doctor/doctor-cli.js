// `chemx doctor [--fix] [--json] [--root=<dir>]`: one report on how this machine runs chemx.
// --fix only repairs safe, idempotent items (hooks and the .mcp.json launch, via install-hooks with
// backups); it never edits shims, never touches foreign entries and never kills processes.

import { STATUS, combineStatuses, toExitCode } from '../result-status.js';
import { KIT_ROOT, readKitVersion } from '../hooks/launcher.js';
import { parseInstallArgs, runInstallHooks } from '../hooks/install-hooks-cli.js';
import { checkBins, checkNodeVersion } from './check-env.js';
import { checkMcpLaunch, checkMcpProcesses } from './check-mcp.js';
import { checkIndex } from './check-index.js';
import { checkHooks, checkShims } from './check-host.js';

const MARKS = { [STATUS.PASS]: 'ok  ', [STATUS.FAIL]: 'FAIL', [STATUS.INCONCLUSIVE]: '??  ' };

export const runDoctorChecks = async ({ projectRoot, cliVersion, procRoot, envPath }) => [
  checkNodeVersion(),
  checkBins({ cliVersion, envPath }),
  checkMcpLaunch({ projectRoot, cliVersion }),
  checkMcpProcesses({ cliVersion, procRoot }),
  await checkIndex({ projectRoot }),
  checkHooks({ projectRoot }),
  checkShims({ projectRoot }),
];

const applySafeFixes = (checks, projectRoot) => {
  const fixable = checks.filter((check) => check.status === STATUS.FAIL && check.fixable);
  const hasFixes = fixable.length > 0;
  if (!hasFixes) return null;
  const isMcpFix = fixable.some((check) => check.id === 'mcp-launch');
  const hooksScope = checks.find((check) => check.id === 'hooks')?.scope ?? 'project';
  const args = ['--host=claude', `--scope=${hooksScope}`, `--root=${projectRoot}`, `--kit=${KIT_ROOT}`, ...(isMcpFix ? [] : ['--no-mcp'])];
  return runInstallHooks(parseInstallArgs(args, projectRoot));
};

const renderText = (report) => {
  const lines = [`chemx doctor (${report.status}) root=${report.projectRoot} cli=${report.cliVersion}`];
  for (const check of report.checks) lines.push(`  ${MARKS[check.status] ?? check.status} ${check.id.padEnd(11)} ${check.summary}`);
  const fixHint = report.checks.some((check) => check.status === STATUS.FAIL && check.fixable) && !report.fix;
  if (fixHint) lines.push('  Run chemx doctor --fix to repair hooks and the MCP launch (backups in .chemx/backups).');
  const hasFixReport = Boolean(report.fix);
  if (hasFixReport) lines.push(`  fix: install-hooks ${report.fix.status}; ${report.fix.actions.map((action) => `${action.label} ${action.status}`).join(', ')}`);
  return `${lines.join('\n')}\n`;
};

export const runDoctor = async ({ projectRoot, isFix = false, procRoot = '/proc', envPath = process.env.PATH ?? '' }) => {
  const cliVersion = readKitVersion();
  const context = { projectRoot, cliVersion, procRoot, envPath };
  let checks = await runDoctorChecks(context);
  const fix = isFix ? applySafeFixes(checks, projectRoot) : null;
  if (fix) checks = await runDoctorChecks(context);
  const status = combineStatuses(checks.map((check) => check.status));
  return { status, projectRoot, cliVersion, checks, fix };
};

export const runDoctorCli = async (args, { stdout = process.stdout, cwd = process.cwd() } = {}) => {
  const { projectRoot } = parseInstallArgs(['--host=claude', ...args.filter((arg) => arg.startsWith('--root='))], cwd);
  const report = await runDoctor({ projectRoot, isFix: args.includes('--fix') });
  stdout.write(args.includes('--json') ? `${JSON.stringify(report)}\n` : renderText(report));
  return toExitCode(report.status);
};
