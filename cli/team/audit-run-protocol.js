/**
 * Chemical X Protocol: protocol gaps and hijack signals for one agent of a run (#2561).
 *
 *   commits without a task id   a chemx commit or git commit whose text has no #<id>
 *   edits without a lease       a chemx patch/write(--overwrite|--append)/autofix of a file the agent had no
 *                               `team lock acquire` for (command or feed) before the edit; a plain write of a
 *                               new file is not counted (it has nothing to lease), nor is a later edit of
 *                               a file the same agent created that way
 *   claims never closed         `team task claim <id>` with no done/blocked/cancelled update for that id, unless
 *                               the db says the task is no longer in_progress
 *   hijack signals              the final result does not mention the task, together with zero steps or a
 *                               near-zero cost (#2508)
 *
 * Limits: lease and claim words are read from commands (CLI or MCP) in the transcript. A path is resolved with
 * the call's cwd, its literal cd/pushd steps and simple NAME=value assignments of the same command line, then
 * compared as an absolute path (a feed lease, stored root-relative, matches when the absolute path ends with it,
 * so two files with the same root-relative tail in different roots are not told apart). A path that stays
 * unresolved (unset variable, substitution, `cd -`) is listed by unresolvedEdits, never as unleased. A claim made by a
 * tool other than chemx team task is not seen. The hijack test is a text heuristic and says `possible`
 * unless two signals agree.
 */
import path from 'node:path';

const EDIT_VERBS = new Set(['patch', 'write', 'autofix']);
const CLOSE_STATES = new Set(['done', 'blocked', 'cancelled', 'canceled', 'completed', 'queued']);
const LEASE_SLACK_MS = 5000;
const NEAR_ZERO_SHARE = 0.05;
const COMMAND_LIMIT = 200;

const clip = (text) => String(text).replace(/\s+/g, ' ').trim().slice(0, COMMAND_LIMIT);
const nonFlags = (args) => args.filter((w) => !w.startsWith('-'));

/** A path as the leasing code would see it: relative to the call's cwd when it sits under it. */
export const keyOf = (inv, word) => {
  const text = String(word ?? '').replace(/^\.\//, '');
  const isUnder = Boolean(inv.cwd) && path.isAbsolute(text) && text.startsWith(inv.cwd + path.sep);
  return isUnder ? path.relative(inv.cwd, text) : text;
};

const UNRESOLVED_TEXT = /[$`]/;
const VAR_REF = /\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g;
const MAX_VAR_DEPTH = 4;

// A word with its simple variables expanded from the call's own assignments (inv.vars), or null when any `$` or
// backtick is left (an unset variable, a substitution, a special parameter).
const expandText = (word, vars, depth = 0) => {
  const home = process.env.HOME ?? '';
  const withHome = String(word).replace(/^~(?=\/|$)/, home).replace(/\$\{HOME\}|\$HOME\b/g, home);
  const isOver = depth > MAX_VAR_DEPTH;
  const missing = { hit: false };
  const text = withHome.replace(VAR_REF, (whole, braced, bare) => {
    const value = vars?.[braced ?? bare];
    const isKnown = typeof value === 'string' && !isOver;
    if (!isKnown) missing.hit = true;
    return isKnown ? expandText(value, vars, depth + 1) ?? '' : whole;
  });
  const isUnresolved = missing.hit || UNRESOLVED_TEXT.test(text) || withHome.includes('`');
  return isUnresolved ? null : text;
};

// Where the call ran: its cwd moved by the literal cd/pushd steps the shell parse recorded, or null when unknown.
const cwdOf = (inv) => {
  const isKnown = Boolean(inv.cwd) && !inv.dir?.unknown;
  if (!isKnown) return null;
  const steps = (inv.dir?.steps ?? []).map((step) => expandText(step, inv.vars));
  const isResolved = steps.every((step) => step !== null);
  return isResolved ? steps.reduce((cwd, step) => path.resolve(cwd, step), inv.cwd) : null;
};

/**
 * A path as the leasing code would compare it, or null when it cannot be resolved (#4543). Absolute when the
 * call's cwd (after its cd steps) and the word's variables are known; a bare relative spelling only when the
 * call recorded no cwd and no cd. `display` is relative to the call's cwd when it sits under it.
 */
export const resolveEditPath = (inv, word) => {
  const printed = inv.printedPath ? String(inv.printedPath) : String(word ?? '');
  const text = expandText(printed.replace(/^\.\//, ''), inv.vars);
  const cwd = cwdOf(inv);
  const isUnexpanded = text === null;
  const isBare = !inv.cwd && !inv.dir?.unknown && (inv.dir?.steps ?? []).length === 0;
  const isAbsolute = !isUnexpanded && path.isAbsolute(text);
  const absolute = isAbsolute ? path.normalize(text) : cwd && !isUnexpanded && path.resolve(cwd, text);
  const result = absolute ? { key: absolute, display: displayOf(inv, absolute) } : null;
  const bare = { key: path.normalize(String(text)), display: text };
  const isBareWord = isBare && !isAbsolute && !isUnexpanded;
  return isBareWord ? bare : result;
};

const displayOf = (inv, absolute) => {
  const isUnder = Boolean(inv.cwd) && absolute.startsWith(inv.cwd + path.sep);
  return isUnder ? path.relative(inv.cwd, absolute) : absolute;
};

// Two spellings of one file: equal, or an absolute path ending in the other's root-relative form (the feed and
// the lease table store paths relative to the coordination root).
export const sameFile = (a, b) => {
  const isEqual = a === b;
  const aAbs = path.isAbsolute(a);
  const bAbs = path.isAbsolute(b);
  const isTail = (abs, rel) => abs.endsWith(`${path.sep}${rel}`);
  const isMixed = aAbs !== bAbs;
  const hasTail = isMixed && (aAbs ? isTail(a, b) : isTail(b, a));
  return isEqual || hasTail;
};

const isCommit = (inv) => {
  const isChemxCommit = inv.kind === 'chemx' && inv.argv[0] === 'commit';
  const isGitCommit = inv.kind === 'shell' && inv.argv[0] === 'git' && inv.argv[1] === 'commit';
  return isChemxCommit || isGitCommit;
};

// A commit inside a scratch repo (a command that touches /tmp, mktemp or ~/.claude) is test scaffolding, not a task commit.
// Decided per invocation from its own argv: --help/-h is exempt, and --task=N, --task N, --no-task=... or #N in its own words carry a task.
const hasTaskMark = (argv) => argv.some((w, i) => {
  const isTaskFlag = /^--task=\S+/.test(w) || /^--no-task(=|$)/.test(w);
  const isSpaced = w === '--task' && /^\d+$/.test(argv[i + 1] ?? '');
  return isTaskFlag || isSpaced || /#\d+/.test(w);
});
const isHelp = (argv) => argv.some((w) => w === '--help' || w === '-h');

// One shell line holding several commits is reported once (by time and line).
export const commitsWithoutTask = (invs) => {
  const seen = new Set();
  const result = [];
  for (const inv of invs) {
    const isMissing = isCommit(inv) && !inv.isScratch && !isHelp(inv.argv) && !hasTaskMark(inv.argv);
    const key = `${inv.at}\u0000${inv.raw}`;
    const isNew = isMissing && !seen.has(key);
    if (isMissing) seen.add(key);
    if (isNew) result.push({ at: inv.at, via: inv.via, command: clip(inv.raw) });
  }
  return result;
};

const teamTask = (inv, verb) => inv.kind === 'chemx' && inv.argv[0] === 'team' && inv.argv[1] === 'task' && inv.argv[2] === verb;

const editOf = (inv) => {
  const isEdit = inv.kind === 'chemx' && EDIT_VERBS.has(inv.argv[0]);
  if (!isEdit) return null;
  const verb = inv.argv[0];
  const isNewFileWrite = verb === 'write' && !inv.argv.includes('--overwrite') && !inv.argv.includes('--append');
  const [file] = nonFlags(inv.argv.slice(1));
  const isCounted = Boolean(file) && !isNewFileWrite;
  const resolved = isCounted ? resolveEditPath(inv, file) : null;
  const found = { at: inv.at, file: resolved?.display ?? file, key: resolved?.key ?? null, verb, via: inv.via };
  return isCounted ? found : null;
};

// A file the agent created itself with a plain write: it had nothing to lease, and later edits of it need none either.
const createdOf = (inv) => {
  const isWrite = inv.kind === 'chemx' && inv.argv[0] === 'write';
  const isNew = isWrite && !inv.argv.includes('--overwrite') && !inv.argv.includes('--append');
  const [file] = isNew ? nonFlags(inv.argv.slice(1)) : [];
  return file ? resolveEditPath(inv, file)?.key ?? null : null;
};

const acquireOf = (inv) => {
  const isAcquire = inv.kind === 'chemx' && inv.argv[0] === 'team' && inv.argv[1] === 'lock' && inv.argv[2] === 'acquire';
  const [file] = isAcquire ? nonFlags(inv.argv.slice(3)) : [];
  const key = file ? resolveEditPath(inv, file)?.key : null;
  return key ? { at: inv.at, file: key } : null;
};

/**
 * Edits with no earlier lease. taken: that handle's feed lease events [{ file, at }].
 * A lease with no timestamp on either side counts as earlier (the order is unknown, so no accusation).
 */
export const editsWithoutLease = (invs, taken = []) => {
  const acquires = [...invs.map(acquireOf).filter(Boolean), ...taken];
  const isBefore = (lease, edit) => lease.at === null || edit.at === null || lease.at <= edit.at + LEASE_SLACK_MS;
  const seen = new Set();
  const created = invs.map(createdOf).filter(Boolean);
  const result = [];
  for (const edit of invs.map(editOf).filter((e) => e && e.key !== null)) {
    const isOwnFile = created.some((file) => sameFile(file, edit.key));
    const isLeased = isOwnFile || acquires.some((lease) => sameFile(lease.file, edit.key) && isBefore(lease, edit));
    const key = `${edit.key}\u0000${edit.verb}`;
    const isNew = !seen.has(key);
    seen.add(key);
    const isGap = !isLeased && isNew;
    if (isGap) result.push({ at: edit.at, file: edit.file, verb: edit.verb, via: edit.via });
  }
  return result;
};

/** Every counted edit with a resolved path: [{ at, key, file, verb }]. Lets the lease audit compare edits to lapses (#4543). */
export const resolvedEdits = (invs) => invs.map(editOf).filter((e) => e && e.key !== null);

/** Edits whose path could not be resolved (an unset variable, a substitution, an unknown cd): not judged either way. */
export const unresolvedEdits = (invs) => invs.map(editOf)
  .filter((e) => e && e.key === null)
  .map((e) => ({ at: e.at, file: e.file, verb: e.verb, via: e.via, unresolved: true }));

const idsOf = (invs, verb) => invs.filter((inv) => teamTask(inv, verb)).map((inv) => Number(nonFlags(inv.argv.slice(3))[0])).filter(Number.isFinite);

const closedIds = (invs) => {
  const done = idsOf(invs, 'done');
  const updates = invs.filter((inv) => teamTask(inv, 'update')).map((inv) => nonFlags(inv.argv.slice(3)));
  const closing = updates.filter(([, state]) => CLOSE_STATES.has(String(state))).map(([id]) => Number(id));
  return new Set([...done, ...closing]);
};

/** Claimed task ids with no closing command; statuses (id -> status) from the db drop ones already closed elsewhere. */
export const unclosedClaims = (invs, statuses = new Map()) => {
  const closed = closedIds(invs);
  const claimed = [...new Set(idsOf(invs, 'claim'))];
  return claimed.filter((id) => {
    const status = statuses.get(id);
    const isOpenInDb = status === undefined || status === 'in_progress';
    return !closed.has(id) && isOpenInDb;
  });
};

const taskTokens = (taskText) => {
  const ids = [...String(taskText).matchAll(/#(\d{2,})/g)].map((m) => `#${m[1]}`);
  const files = [...String(taskText).matchAll(/(?:^|\n)\s*(?:Target\s+)?(?:File|Files)\s*:\s*(\S+)/gi)].map((m) => m[1].replace(/[,;]$/, ''));
  const handle = /You are[^@\n]{0,40}(@[\w-]+)/.exec(taskText)?.[1];
  return [...new Set([...ids, ...files, ...(handle ? [handle] : [])])].slice(0, 12);
};

// A forced-schema result carries these keys; two or more filled in is the shape of an answer to the task.
const SCHEMA_KEYS = ['commits', 'specs', 'deliverables', 'openIssues', 'evidence', 'problem', 'fix', 'verdict', 'findings'];
const isFilled = (v) => (Array.isArray(v) ? v.length > 0 : String(v ?? '').trim() !== '');

const isSchemaShaped = (output) => {
  const isObject = output !== null && typeof output === 'object' && !Array.isArray(output);
  if (!isObject) return false;
  return SCHEMA_KEYS.filter((k) => isFilled(output[k])).length >= 2;
};

/**
 * Did the agent's final result address its task?
 * On-task: it names an id, a target file or basename, or the handle, or it is a filled schema-shaped result.
 * Not guaranteed: a schema-shaped result that is about something else still passes.
 * @returns {{ level: 'likely'|'possible'|null, signals: string[] }}
 */
export const hijackSignals = ({ taskText, finalOutput, finalText, workCalls, cost, medianCost }) => {
  const result = finalOutput ? JSON.stringify(finalOutput) : String(finalText ?? '');
  const tokens = taskTokens(taskText);
  const signals = [];
  const noResult = result.trim() === '';
  const names = tokens.map((t) => (t.includes('/') ? t.split('/').pop() : t));
  const isMentioned = [...tokens, ...names].some((t) => result.includes(t));
  const isShaped = isSchemaShaped(finalOutput);
  const offTask = !noResult && tokens.length > 0 && !isMentioned && !isShaped;
  const zeroSteps = workCalls === 0;
  const nearZeroCost = medianCost > 0 && cost < medianCost * NEAR_ZERO_SHARE;
  if (noResult) signals.push('no-final-result');
  if (offTask) signals.push('result-does-not-mention-task');
  if (zeroSteps) signals.push('zero-steps');
  if (nearZeroCost) signals.push('near-zero-cost');
  const isAboutTask = !noResult && !offTask;
  const isThin = zeroSteps || nearZeroCost;
  const isLikely = !isAboutTask && isThin;
  const isPossible = !isAboutTask || zeroSteps;
  const ladder = [isLikely && 'likely', isPossible && 'possible'];
  return { level: ladder.find(Boolean) || null, signals };
};
