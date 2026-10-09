/**
 * chemx status [path] [--json] [--as=@you]: git status --porcelain with each changed file's live lease.
 * Guarantees: lists what git reports, and the unexpired lease (holder, purpose, expiry, task from a
 * "#<id>" in the purpose) the coordination db shows for that file right now.
 * Not guaranteed: a flag is a hint, not proof. "unleased" can be a finished edit that was released;
 * "leased by another" needs a known handle (--as or CHEMX_AGENT_ID). It never changes any file or lease.
 */
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { liveLeases } from './lease-view.js';
import { activityHolder, agentFromArgs } from './team/lease-activity.js';

export const STATUS_HELP = [
  'chemx status [path] [--json] [--as=@you]',
  '  git status --porcelain for this package (or path); each changed file shows its live lease:',
  '  holder, purpose, task (#id from the purpose) and minutes left.',
  '  Flags: "unleased" = changed and no live lease (someone may be mid-edit, or the edit is finished);',
  '  "leased by another" = a different handle holds it (needs --as or CHEMX_AGENT_ID).',
  '  Reads only; never changes files or leases. Always exits 0 unless git fails.'
].join('\n');

const git = (cwd, args) => execFileSync('git', ['-c', 'core.quotepath=off', ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Parses `git status --porcelain` text into { code, file } entries (rename targets only). */
export const parsePorcelain = (text) => text.split('\n').filter((line) => line.length > 3).map((line) => {
  const rest = line.slice(3);
  const arrow = rest.indexOf(' -> ');
  const isRename = arrow >= 0;
  return { code: line.slice(0, 2), file: isRename ? rest.slice(arrow + 4) : rest };
});

const taskOf = (purpose) => {
  const match = /#(\d+)/.exec(purpose || '');
  return match ? Number(match[1]) : null;
};

const stateOf = (lease, me) => {
  const hasLease = Boolean(lease);
  if (!hasLease) return 'unleased';
  const isMine = Boolean(me) && lease.locked_by === me;
  if (isMine) return 'yours';
  const isOther = Boolean(me);
  return isOther ? 'other' : 'held';
};

/** Pure: joins entries with leases. */
export const annotate = (entries, leases, top, me, now = Date.now()) => entries.map((entry) => {
  const abs = path.join(top, entry.file);
  const lease = leases.find((item) => item.abs === abs);
  const state = stateOf(lease, me);
  const base = { code: entry.code, file: entry.file, state, flagged: state === 'unleased' || state === 'other' };
  if (!lease) return base;
  const minutesLeft = Math.round((lease.expires_at - now) / 60000);
  return { ...base, holder: lease.locked_by, purpose: lease.purpose, task: taskOf(lease.purpose), minutesLeft };
});

export const countLine = (rows) => {
  const count = (state) => rows.filter((row) => row.state === state).length;
  const parts = [`${rows.length} changed`, `${count('yours')} leased by you`, `${count('other')} leased by another`, `${count('held')} leased (handle unknown)`, `${count('unleased')} unleased`];
  return parts.join(', ');
};

const FLAG_TEXT = { unleased: '  [unleased: someone may be mid-edit]', other: '  [leased by another handle: do not edit]' };

const rowText = (row) => {
  const task = row.task ? ` task #${row.task}` : '';
  const lease = row.holder ? `  ${row.holder} "${row.purpose}"${task} ${row.minutesLeft}m left` : '';
  return `${row.code} ${row.file}${lease}${FLAG_TEXT[row.state] || ''}`;
};

export const runStatus = (args = [], isCli = true, cwd = process.cwd()) => {
  const wantsHelp = args.includes('--help') || args.includes('-h');
  if (wantsHelp) {
    if (isCli) process.stdout.write(`${STATUS_HELP}\n`);
    return { code: 0, help: true };
  }
  const scope = args.find((arg, i) => !arg.startsWith('-') && args[i - 1] !== '--as') || '.';
  let top;
  let raw;
  try {
    top = git(cwd, ['rev-parse', '--show-toplevel']).trim();
    raw = git(cwd, ['status', '--porcelain', '--untracked-files=all', '--', scope]);
  } catch (err) {
    if (isCli) process.stderr.write(`chemx status: git failed: ${String(err.message).split('\n')[0]}\n`);
    return { code: 1, error: 'git failed' };
  }
  const me = activityHolder(agentFromArgs(args));
  const rows = annotate(parsePorcelain(raw), liveLeases(cwd), top, me);
  const summary = countLine(rows);
  if (isCli) {
    const isJson = args.includes('--json');
    process.stdout.write(isJson ? `${JSON.stringify({ rows, summary }, null, 2)}\n` : `${rows.map(rowText).concat(summary).join('\n')}\n`);
  }
  return { code: 0, rows, summary };
};
