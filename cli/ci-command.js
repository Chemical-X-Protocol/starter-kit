/**
 * Chemical X Protocol: `chemx ci [<pr>|<branch>|<url>] [--repo owner/name] [--wait [--timeout=<dur>]] [--json]`
 * and `chemx ci --protection [--repo owner/name]` (#6760, K15).
 * Prints a pull request's checks one line each and its merge state in one line, read through gh.
 * Exit 0 every check passed, 1 a check failed or was cancelled, 3 checks pending or none reported yet
 * (also a --wait that ran out of time), 2 could not read (gh missing, PR not found, bad arguments).
 * --wait polls every 30 s and prints only what changed. --protection warns when the default branch
 * requires no status checks, where `gh pr merge --auto` merges at once. See docs/ci.md.
 */
import { setTimeout as sleepFor } from 'node:timers/promises';
import { parseDuration, DEFAULT_TIMEOUT_MS } from './wait-command.js';
import { runGh } from './ci-gh.js';
import { readSnapshot, snapshotLines, snapshotJson } from './ci-checks.js';
import { runProtection } from './ci-protection.js';

export const CI_POLL_MS = 30000;

const EXIT_OF_VERDICT = { pass: 0, fail: 1, pending: 3, none: 3 };
const FINAL_VERDICTS = new Set(['pass', 'fail']);
const BARE_FLAGS = { '--wait': 'wait', '--protection': 'protection', '--json': 'json' };

const VALUE_FLAGS = {
  '--repo': (opts, value) => { opts.repo = value; },
  '--timeout': (opts, value) => {
    const ms = parseDuration(value);
    const isBad = ms === null;
    opts.error ??= isBad ? `--timeout needs a duration such as 90, 90s, 5m or 2h, got "${value}"` : null;
    opts.timeoutMs = isBad ? opts.timeoutMs : ms;
  }
};

// Reads the word at `at` into opts or targets; returns how many words it used (a flag may take the next one as its value).
const readWord = (args, at, opts, targets) => {
  const arg = args[at];
  const equals = arg.startsWith('--') ? arg.indexOf('=') : -1;
  const isInline = equals !== -1;
  const flag = isInline ? arg.slice(0, equals) : arg;
  const setValue = VALUE_FLAGS[flag];
  const isTarget = !arg.startsWith('-');
  const isBare = Object.hasOwn(BARE_FLAGS, flag);
  if (isBare) opts[BARE_FLAGS[flag]] = true;
  if (isTarget) targets.push(arg.replace(/^#(?=\d+$)/, ''));
  if (!setValue) return 1;
  const value = isInline ? arg.slice(equals + 1) : args[at + 1];
  const hasValue = value !== undefined && (isInline || !String(value).startsWith('-'));
  opts.error ??= hasValue ? null : `${flag} needs a value: ${flag} <value> or ${flag}=<value>`;
  if (hasValue) setValue(opts, value);
  return hasValue && !isInline ? 2 : 1;
};

/** Parse the words after `chemx ci`. `error` is set for the first problem; the rest of the object is still filled. */
export const parseCiArgs = (args = []) => {
  const opts = { target: null, repo: null, wait: false, timeoutMs: DEFAULT_TIMEOUT_MS, protection: false, json: false, error: null };
  const targets = [];
  for (let at = 0; at < args.length; at += readWord(args, at, opts, targets));
  opts.target = targets[0] ?? null;
  const problems = [
    [targets.length > 1, `give one pull request (a number, branch or URL), got ${targets.length}`],
    [opts.protection && targets.length > 0, '--protection reads the repository, not a pull request: drop the pull request argument'],
    [opts.protection && opts.wait, '--protection and --wait cannot be combined']
  ];
  const found = problems.find(([applies]) => applies);
  if (found) opts.error ??= found[1];
  return opts;
};

const stillPending = (snapshot) => {
  const names = snapshot.checks.filter((check) => check.bucket === 'pending').map((check) => check.name);
  return names.length > 0 ? `still pending: ${names.join(', ')}` : 'no checks were reported';
};

const finish = (snapshot, opts, env, extra = {}) => {
  if (opts.json) env.write(`${JSON.stringify({ ...snapshotJson(snapshot), ...extra }, null, 2)}\n`);
  return { code: EXIT_OF_VERDICT[snapshot.verdict], verdict: snapshot.verdict, snapshot };
};

// One read, or with --wait a read every pollMs until the checks pass, one fails, or the timeout runs out.
const runPullRequest = async (opts, env) => {
  const started = env.clock();
  let previous = null;
  while (true) {
    const snapshot = readSnapshot(env.gh, opts, env.clock());
    const isUnreadable = Boolean(snapshot.error);
    if (isUnreadable) return { code: 2, message: snapshot.error };
    const lines = snapshotLines(snapshot, previous);
    const hasNews = !opts.json && lines.length > 0;
    if (hasNews) env.write(`${lines.join('\n')}\n`);
    previous = snapshot;
    const isSettled = FINAL_VERDICTS.has(snapshot.verdict) || !opts.wait;
    if (isSettled) return finish(snapshot, opts, env);
    const elapsed = env.clock() - started;
    const isOut = elapsed + env.pollMs > opts.timeoutMs;
    const says = `timed out after ${Math.round(elapsed / 1000)}s (limit ${Math.round(opts.timeoutMs / 1000)}s); ${stillPending(snapshot)}\n`;
    const saysTimeout = isOut && !opts.json;
    if (saysTimeout) env.write(says);
    if (isOut) return finish(snapshot, opts, env, { timedOut: true });
    await env.sleep(env.pollMs);
  }
};

/**
 * @param {string[]} args the words after `chemx ci`
 * @param {{ gh?: Function, write?: Function, clock?: Function, sleep?: Function, pollMs?: number }} [deps] stand-ins for specs
 * @returns {Promise<{ code: number, message?: string, verdict?: string, snapshot?: object, report?: object }>}
 */
export const runCi = async (args, deps = {}) => {
  const opts = parseCiArgs(args);
  if (opts.error) return { code: 2, message: `chemx ci: ${opts.error}` };
  const env = {
    gh: deps.gh ?? runGh,
    write: deps.write ?? ((text) => process.stdout.write(text)),
    clock: deps.clock ?? Date.now,
    sleep: deps.sleep ?? sleepFor,
    pollMs: deps.pollMs ?? CI_POLL_MS
  };
  return opts.protection ? runProtection(opts, env) : runPullRequest(opts, env);
};

export const runCiCli = async (args) => {
  const result = await runCi(args);
  if (result.message) process.stderr.write(`${result.message}\n`);
  return result.code;
};
