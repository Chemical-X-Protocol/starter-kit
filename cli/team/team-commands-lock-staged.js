/**
 * Chemical X Protocol: `chemx team lock check-staged [files...] [--as=@me]`.
 * The pre-commit lease guard (#2492). Exit 0: no staged file is under another handle's live lease
 * (a lapsed lease of yours is a warning). Exit 1: one or more are, with the holder, purpose, expiry
 * and what to do. With no file arguments it checks `git diff --cached`. The committing handle is
 * --as, else CHEMX_AGENT_ID, else a session handle; with none of those the committer is a human and
 * any live agent lease on a staged file refuses.
 */
import { execFileSync } from 'node:child_process';
import { activityHolder } from './lease-activity.js';
import { checkStagedLeases } from './staged-leases.js';
import { clockTime, minutesAgo } from './lease-lapse.js';
import { parseFlags } from './team-flags.js';

const EXIT_REFUSED = 1;
const SKIP_NOTE = 'To commit anyway, accept the risk with: CHEMX_SKIP_PRECOMMIT=1 git commit';

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });

// The repo root and the staged paths relative to it; null when git cannot say.
const stagedFromGit = (cwd) => {
  try {
    const root = git(cwd, ['rev-parse', '--show-toplevel']).trim();
    const names = git(cwd, ['diff', '--cached', '--name-only', '--diff-filter=ACDMRT', '-z']);
    return { root, files: names.split('\0').filter(Boolean) };
  } catch {
    return null;
  }
};

const describeRefusal = (refusal, now) => {
  const purpose = refusal.purpose ? ` (${refusal.purpose})` : '';
  const left = Math.max(0, Math.round((refusal.expiresAt - now) / 60000));
  return `${refusal.file}: leased by ${refusal.holder}${purpose} until ${clockTime(refusal.expiresAt)} (${left} min left)`;
};

const describeWarning = (warning, now) => (
  `${warning.file}: your lease expired at ${clockTime(warning.lapsedAt)} (${minutesAgo(warning.lapsedAt, now)} min ago); nobody holds it now. The commit goes ahead. If you keep editing, re-acquire it: chemx team lock acquire ${warning.file}`
);

/** The text for a result: refusals with remedies, then warnings. Empty when there is nothing to say. */
export const formatStagedReport = (result, now = Date.now()) => {
  const lines = [];
  const hasRefusals = result.refusals.length > 0;
  if (hasRefusals) {
    lines.push(`Commit blocked: ${result.refusals.length} staged file(s) are leased by another handle.`);
    result.refusals.forEach((refusal) => lines.push(`  ${describeRefusal(refusal, now)}`));
    lines.push('What to do: wait for the lease to end (any chemx activity by the holder extends it, so it can outlast the time shown),');
    lines.push('or DM the holder (chemx team dm @<holder> "..."), or ask them to hand it over (chemx team task handoff).');
    lines.push(result.isHuman ? `No CHEMX_AGENT_ID is set, so any live agent lease blocks. ${SKIP_NOTE}` : SKIP_NOTE);
  }
  result.warnings.forEach((warning) => lines.push(`Warning: ${describeWarning(warning, now)}`));
  return lines.join('\n');
};

/**
 * Entry for `chemx team lock check-staged ...args`, taken before the team db opens: the check reads
 * lease tables read-only, so it must not create or migrate a .chemx/index.db in a repo that has none
 * (a pre-commit hook runs it in every repo).
 */
export const runCheckStagedArgs = (args, isCli, cwd) => {
  const flags = parseFlags(args);
  const files = args.filter((arg, index) => !arg.startsWith('-') && args[index - 1] !== '--as');
  return runLockCheckStaged(files, flags, isCli, cwd);
};

export const runLockCheckStaged = (files, flags, isCli, cwd) => {
  const given = files.length > 0;
  const staged = given ? { root: cwd, files } : stagedFromGit(cwd);
  const hasStaged = Boolean(staged);
  if (!hasStaged) {
    if (isCli) process.stderr.write('check-staged: could not read the staged files from git; nothing was checked.\n');
    return { ok: true, checked: false, refusals: [], warnings: [] };
  }
  const committer = activityHolder(flags.as);
  const result = { ...checkStagedLeases(staged.files, committer, { root: staged.root }), checked: true, committer };
  const report = formatStagedReport(result);
  if (!isCli) return result;
  const isJson = Boolean(flags.isJson);
  const isReportShown = report !== '' && !isJson;
  const isRefused = !result.ok;
  const out = isJson ? [process.stdout, `${JSON.stringify(result, null, 2)}\n`] : [process.stderr, `${report}\n`];
  const shouldWrite = isJson || isReportShown;
  if (shouldWrite) out[0].write(out[1]);
  process.exitCode = isRefused ? EXIT_REFUSED : process.exitCode;
  return result;
};
