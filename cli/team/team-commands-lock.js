import { requestFileLock, releaseFileLock } from './team-db.js';
import { formatLockHelpCard } from './team-format.js';
import { isPathTraversal } from '../path-scope.js';
import { resolveAgentIdentity, describeIdentityHint } from './agent-identity.js';
import { runLockCheck, runLockStatus, runLockList, runLockRenew } from './team-commands-lock-views.js';

const LOCK_ACTIONS = ['acquire', 'release', 'unlock', 'check', 'status', 'list', 'renew'];

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

export const handleLockCommand = (db, nonFlagPositional, flags, isCli, cwd = process.cwd()) => {
  const isLockHelp = flags.help || nonFlagPositional.includes('--help') || nonFlagPositional.includes('-h') || nonFlagPositional.includes('help');
  if (isLockHelp) {
    if (isCli) process.stdout.write(formatLockHelpCard());
    return { help: true, actions: ['acquire', 'release', 'check', 'status', 'list', 'renew'] };
  }

  const { action, file } = parseLockAction(nonFlagPositional);
  const isList = action === 'list';
  if (isList) return runLockList(db, flags, isCli);

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
    else if (res.granted) process.stdout.write(`\x1b[32m✔\x1b[0m Acquired lock on ${file}\n`);
    else if (res.queued) process.stdout.write(`\x1b[33m⏳\x1b[0m ${res.requeued ? 'Still' : 'Enqueued'} in FIFO lock queue at position ${res.position} (held by ${res.currentHolder})\n`);
    else process.stderr.write(`\x1b[31m✕ Lock refused: ${res.reason}\x1b[0m\n`);
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
    else process.stderr.write(`\x1b[31m✕ Unlock failed: ${res.reason}\x1b[0m\n`);
  }
  return res;
};
