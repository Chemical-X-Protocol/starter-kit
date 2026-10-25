// `chemx doctor [--fix] [--fetch] [--json] [--root=<dir>]`: one report on how this machine runs chemx.
// --fetch refreshes the kit's origin/main ref first (the only network use; a failed fetch is reported, not failed).
// --fix only repairs safe, idempotent items (hooks and the .mcp.json launch, via install-hooks with
// backups); it never edits shims, never touches foreign entries and never kills processes.

import { STATUS, combineStatuses, toExitCode } from '../result-status.js';
import { KIT_ROOT, readKitVersion } from '../hooks/launcher.js';
import { parseInstallArgs, runInstallHooks } from '../hooks/install-hooks-cli.js';
import { checkBins, checkJestLayout, checkNodeVersion } from './check-env.js';
import { checkCiPin, checkKit, checkKitOrigin } from './check-kit.js';
import { checkMcpLaunch, checkMcpProcesses } from './check-mcp.js';
import { checkIndex } from './check-index.js';
import { checkHooks, checkShims } from './check-host.js';

const LINE_INDENT = 19;
const MARKS = { [STATUS.PASS]: 'ok  ', [STATUS.FAIL]: 'FAIL', [STATUS.INCONCLUSIVE]: '??  ' };

export const runDoctorChecks = async ({ projectRoot, cliVersion, procRoot, envPath, kitRoot = KIT_ROOT, claudeHome, nodePath, isFetch = false }) => [
  checkNodeVersion(),
  checkBins({ cliVersion, envPath }),
  checkKit({ kitRoot, cliVersion }),
  checkKitOrigin({ kitRoot, isFetch }),
  checkCiPin({ projectRoot, cliVersion }),
  checkMcpLaunch({ projectRoot, cliVersion }),
  checkMcpProcesses({ cliVersion, procRoot, claudeHome }),
  await checkIndex({ projectRoot }),
  checkHooks({ projectRoot }),
  checkShims({ projectRoot }),
  checkJestLayout({ projectRoot, nodePath }),
].filter(Boolean);

const applySafeFixes = (checks, projectRoot) => {
  const fixable = checks.filter((check) => check.status === STATUS.FAIL && check.fixable);
  const hasFixes = fixable.length > 0;
  if (!hasFixes) return null;
  const isMcpFix = fixable.some((check) => check.id === 'mcp-launch');
  const hooksScope = checks.find((check) => check.id === 'hooks')?.scope ?? 'project';
  const args = ['--host=claude', `--scope=${hooksScope}`, `--root=${projectRoot}`, `--kit=${KIT_ROOT}`, ...(isMcpFix ? ['--write-mcp'] : [])];
  return runInstallHooks(parseInstallArgs(args, projectRoot));
};

export const renderText = (report) => {
  const lines = [`chemx doctor (${report.status}) root=${report.projectRoot} cli=${report.cliVersion}`];
  for (const check of report.checks) {
    lines.push(`  ${MARKS[check.status] ?? check.status} ${check.id.padEnd(11)} ${check.summary}`);
    for (const line of check.lines ?? []) lines.push(`${' '.repeat(LINE_INDENT)}${line}`);
  }
  const fixHint = report.checks.some((check) => check.status === STATUS.FAIL && check.fixable) && !report.fix;
  if (fixHint) lines.push('  Run chemx doctor --fix to repair hooks and the MCP launch (backups in .chemx/backups).');
  const hasFixReport = Boolean(report.fix);
  if (hasFixReport) lines.push(`  fix: install-hooks ${report.fix.status}; ${report.fix.actions.map((action) => `${action.label} ${action.status}`).join(', ')}`);
  return `${lines.join('\n')}\n`;
};

export const runDoctor = async ({ projectRoot, isFix = false, isFetch = false, procRoot = '/proc', envPath = process.env.PATH ?? '', kitRoot = KIT_ROOT, claudeHome, nodePath }) => {
  const cliVersion = readKitVersion();
  const context = { projectRoot, cliVersion, procRoot, envPath, kitRoot, claudeHome, nodePath, isFetch };
  let checks = await runDoctorChecks(context);
  const fix = isFix ? applySafeFixes(checks, projectRoot) : null;
  if (fix) checks = await runDoctorChecks(context);
  const status = combineStatuses(checks.map((check) => check.status));
  return { status, projectRoot, cliVersion, checks, fix };
};

export const runDoctorCli = async (args, { stdout = process.stdout, cwd = process.cwd() } = {}) => {
  const { projectRoot } = parseInstallArgs(['--host=claude', ...args.filter((arg) => arg.startsWith('--root='))], cwd);
  const report = await runDoctor({ projectRoot, isFix: args.includes('--fix'), isFetch: args.includes('--fetch') });
  stdout.write(args.includes('--json') ? `${JSON.stringify(report)}\n` : renderText(report));
  return toExitCode(report.status);
};
