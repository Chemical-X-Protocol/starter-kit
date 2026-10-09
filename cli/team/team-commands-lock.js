import { requestFileLock, releaseFileLock } from './team-db.js';
import { formatLockHelpCard } from './team-format.js';
import { isPathTraversal } from '../path-scope.js';
import { resolveAgentIdentity, describeIdentityHint } from './agent-identity.js';
import { runLockCheck, runLockStatus, runLockList, runLockRenew } from './team-commands-lock-views.js';
import { runLockCheckStaged } from './team-commands-lock-staged.js';
import { clockTime } from './lease-lapse.js';
import { DEFAULT_TTL_MS } from './team-db-lock-promotion.js';

const LOCK_ACTIONS = ['acquire', 'release', 'unlock', 'check', 'check-staged', 'status', 'list', 'renew'];

// The first positional names the action when it is one; otherwise it is the file (default acquire).
// So `lock list` lists, and a file literally named "list" needs `lock acquire list`.
const parseLockAction = (positionals) => {
  const first = positionals[0];
  const isAction = LOCK_ACTIONS.includes(first);
  if (!isAction) return { action: 'acquire', file: first };
  const isRelease = first === 'unlock';
  return { action: isRelease ? 'release' : first, file: positionals[1] };
};

const rejectTraversal = (file, isCli, cwd) => {
  const isTraversal = isPathTraversal(file, cwd);
  if (!isTraversal) return null;
  if (isCli) process.stderr.write('\x1b[31m✕ Path traversal rejected: file path must be within workspace\x1b[0m\n');
  return { error: 'path_traversal' };
};

const runFileAction = (db, action, file, flags, isCli, cwd) => {
  const identity = resolveAgentIdentity(flags.as);
  const isStatus = action === 'status';
  if (isStatus) return runLockStatus(db, file, flags, isCli, cwd);
  writeIdentityHint(identity, isCli, flags.isJson);
  const isCheck = action === 'check';
  if (isCheck) return runLockCheck(db, file, identity.id, flags, isCli, cwd);
  return runLockRenew(db, file, identity.id, flags, isCli, cwd);
};

const writeIdentityHint = (identity, isCli, isJson) => {
  const hint = describeIdentityHint(identity);
  const shouldHint = isCli && !isJson && Boolean(hint);
  if (shouldHint) process.stderr.write(`\x1b[2m${hint}\x1b[0m\n`);
};

// The acting agent for a CLI call; anonymous callers get a per-process id plus a hint.
export const resolveCliAgent = (flags, isCli) => {
  const identity = resolveAgentIdentity(flags.as);
  writeIdentityHint(identity, isCli, flags.isJson);
  return identity.id;
};

const RENEWAL_NOTE = `Any chemx command run as this handle extends it to ${DEFAULT_TTL_MS / 60000} minutes from then; with no chemx activity it lapses. If someone queues for it, renewal stops after the cap (10 minutes by default) since your last edit of the file (docs/team-locks.md).`;

// The acquire line: when it expires, what keeps it alive, and a lapse it replaces.
const describeGrant = (file, res) => {
  const until = clockTime(res.lease.expires_at);
  const lapse = res.previousLapse ? ` (your earlier lease on it expired at ${clockTime(res.previousLapse.expiredAt)})` : '';
  return `\x1b[32m✔\x1b[0m Acquired lock on ${file}${lapse}. It expires at ${until}. ${RENEWAL_NOTE}\n`;
};

// What the waiter is told about the holder notice (#2566): exact, never more than was sent.
const describeNotice = (res) => {
  const isNotified = Boolean(res.holderNotified);
  if (!isNotified) return `Could not notify ${res.currentHolder}; ask them to release it.`;
  const wording = res.noticeSent ? 'was notified' : 'was already notified';
  return `${res.notifiedHolder} ${wording} (they see it when they check their inbox).`;
};

export const handleLockCommand = (db, nonFlagPositional, flags, isCli, cwd = process.cwd()) => {
  const isLockHelp = flags.help || nonFlagPositional.includes('--help') || nonFlagPositional.includes('-h') || nonFlagPositional.includes('help');
  if (isLockHelp) {
    if (isCli) process.stdout.write(formatLockHelpCard());
    return { help: true, actions: ['acquire', 'release', 'check', 'check-staged', 'status', 'list', 'renew'] };
  }

  const { action, file } = parseLockAction(nonFlagPositional);
  const isList = action === 'list';
  if (isList) return runLockList(db, flags, isCli);
  const isCheckStaged = action === 'check-staged';
  if (isCheckStaged) return runLockCheckStaged(nonFlagPositional.slice(1), flags, isCli, cwd);

  if (!file) {
    if (isCli) process.stderr.write('\x1b[31m✕ File path required: chemx team lock [acquire|release|check|status|renew] <filePath> (or: chemx team lock list)\x1b[0m\n');
    return { error: 'filePath required' };
  }

  const isRelease = action === 'release';
  if (isRelease) {
    return handleUnlockCommand(db, [file], flags, isCli, cwd);
  }

  const traversal = rejectTraversal(file, isCli, cwd);
  const isRejected = Boolean(traversal);
  if (isRejected) return traversal;

  const isAcquire = action === 'acquire';
  if (!isAcquire) return runFileAction(db, action, file, flags, isCli, cwd);

  const identity = resolveAgentIdentity(flags.as);
  writeIdentityHint(identity, isCli, flags.isJson);
  const res = requestFileLock(db, file, identity.id, {
    purpose: flags.purpose,
    priority: flags.priority,
    pid: flags.pid ? Number(flags.pid) : 0,
    cwd
  });

  if (isCli) {
    if (flags.isJson) process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    else if (res.granted) process.stdout.write(describeGrant(file, res));
    else if (res.queued) process.stdout.write(`\x1b[33m⏳\x1b[0m ${res.requeued ? 'Still' : 'Enqueued'} in FIFO lock queue at position ${res.position} (held by ${res.currentHolder}). ${describeNotice(res)}\n`);
    else process.stderr.write(`\x1b[31m✕ Lock refused: ${res.message || res.reason}\x1b[0m\n`);
  }
  return res;
};

export const handleUnlockCommand = (db, nonFlagPositional, flags, isCli, cwd = process.cwd()) => {
  const isUnlockHelp = flags.help || nonFlagPositional.includes('--help') || nonFlagPositional.includes('-h') || nonFlagPositional.includes('help');
  if (isUnlockHelp) {
    if (isCli) process.stdout.write(formatLockHelpCard());
    return { help: true, actions: ['release'] };
  }

  const file = nonFlagPositional[0];
  if (!file) {
    if (isCli) process.stderr.write('\x1b[31m✕ File path required: chemx team unlock <filePath>\x1b[0m\n');
    return { error: 'filePath required' };
  }

  const traversal = rejectTraversal(file, isCli, cwd);
  const isRejected = Boolean(traversal);
  if (isRejected) return traversal;

  const identity = resolveAgentIdentity(flags.as);
  writeIdentityHint(identity, isCli, flags.isJson);
  const res = releaseFileLock(db, file, identity.id, { cwd });
  const isReleased = Boolean(res.success);
  if (isCli) {
    if (flags.isJson) process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    else if (isReleased) process.stdout.write(`\x1b[32m✔\x1b[0m Released lock on ${file}\n`);
    else process.stderr.write(`\x1b[31m✕ Unlock failed: ${res.message ?? res.reason}\x1b[0m\n`);
  }
  return res;
};
