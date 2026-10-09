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
 * Limits: lease and claim words are read from commands (CLI or MCP) in the transcript; a path is compared as
 * written, relative to the call's cwd, so a lease taken under another spelling is missed. A claim made by a
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

const isCommit = (inv) => {
  const isChemxCommit = inv.kind === 'chemx' && inv.argv[0] === 'commit';
  const isGitCommit = inv.kind === 'shell' && inv.argv[0] === 'git' && inv.argv[1] === 'commit';
  return isChemxCommit || isGitCommit;
};

// A commit inside a scratch repo (a command that touches /tmp, mktemp or ~/.claude) is test scaffolding, not a task commit.
export const commitsWithoutTask = (invs) => invs
  .filter((inv) => isCommit(inv) && !inv.isScratch && !/#\d+/.test(inv.raw))
  .map((inv) => ({ at: inv.at, via: inv.via, command: clip(inv.raw) }));

const teamTask = (inv, verb) => inv.kind === 'chemx' && inv.argv[0] === 'team' && inv.argv[1] === 'task' && inv.argv[2] === verb;

const editOf = (inv) => {
  const isEdit = inv.kind === 'chemx' && EDIT_VERBS.has(inv.argv[0]);
  if (!isEdit) return null;
  const verb = inv.argv[0];
  const isNewFileWrite = verb === 'write' && !inv.argv.includes('--overwrite') && !inv.argv.includes('--append');
  const [file] = nonFlags(inv.argv.slice(1));
  const isCounted = Boolean(file) && !isNewFileWrite;
  return isCounted ? { at: inv.at, file: keyOf(inv, file), verb, via: inv.via } : null;
};

// A file the agent created itself with a plain write: it had nothing to lease, and later edits of it need none either.
const createdOf = (inv) => {
  const isWrite = inv.kind === 'chemx' && inv.argv[0] === 'write';
  const isNew = isWrite && !inv.argv.includes('--overwrite') && !inv.argv.includes('--append');
  const [file] = isNew ? nonFlags(inv.argv.slice(1)) : [];
  return file ? keyOf(inv, file) : null;
};

const acquireOf = (inv) => {
  const isAcquire = inv.kind === 'chemx' && inv.argv[0] === 'team' && inv.argv[1] === 'lock' && inv.argv[2] === 'acquire';
  const [file] = isAcquire ? nonFlags(inv.argv.slice(3)) : [];
  return file ? { at: inv.at, file: keyOf(inv, file) } : null;
};

/**
 * Edits with no earlier lease. taken: that handle's feed lease events [{ file, at }].
 * A lease with no timestamp on either side counts as earlier (the order is unknown, so no accusation).
 */
export const editsWithoutLease = (invs, taken = []) => {
  const acquires = [...invs.map(acquireOf).filter(Boolean), ...taken];
  const isBefore = (lease, edit) => lease.at === null || edit.at === null || lease.at <= edit.at + LEASE_SLACK_MS;
  const seen = new Set();
  const created = new Set(invs.map(createdOf).filter(Boolean));
  const result = [];
  for (const edit of invs.map(editOf).filter(Boolean)) {
    const isOwnFile = created.has(edit.file);
    const isLeased = isOwnFile || acquires.some((lease) => lease.file === edit.file && isBefore(lease, edit));
    const key = `${edit.file}\u0000${edit.verb}`;
    const isNew = !seen.has(key);
    seen.add(key);
    const isGap = !isLeased && isNew;
    if (isGap) result.push(edit);
  }
  return result;
};

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
  const files = [...String(taskText).matchAll(/(?:^|\n)\s*(?:File|Target|Files?)\s*:\s*(\S+)/gi)].map((m) => m[1]);
  const handle = /You are[^@\n]{0,40}(@[\w-]+)/.exec(taskText)?.[1];
  return [...new Set([...ids, ...files, ...(handle ? [handle] : [])])].slice(0, 12);
};

/**
 * Did the agent's final result address its task?
 * @returns {{ level: 'likely'|'possible'|null, signals: string[] }}
 */
export const hijackSignals = ({ taskText, finalOutput, finalText, workCalls, cost, medianCost }) => {
  const result = finalOutput ? JSON.stringify(finalOutput) : String(finalText ?? '');
  const tokens = taskTokens(taskText);
  const signals = [];
  const noResult = result.trim() === '';
  const offTask = !noResult && tokens.length > 0 && !tokens.some((t) => result.includes(t));
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
