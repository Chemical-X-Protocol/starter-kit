import { requestFileLock, releaseFileLock } from './team-db.js';
import { formatLockHelpCard } from './team-format.js';
import { resolveAgentIdentity, describeIdentityHint } from './agent-identity.js';
import { runLockCheck, runLockStatus, runLockList, runLockRenew, missingPathWarning } from './team-commands-lock-views.js';
import { runLockCheckStaged } from './team-commands-lock-staged.js';
import { checkLockTarget, checkPathList } from './lock-targets.js';
import { RENEWAL_NOTE, lockLine, summarize } from './lock-lines.js';

const LOCK_ACTIONS = ['acquire', 'release', 'unlock', 'check', 'check-staged', 'status', 'list', 'renew'];

// The first positional names the action when it is one; otherwise every positional is a file (default
// acquire). So `lock list` lists, and a file literally named "list" needs `lock acquire list`.
const parseLockAction = (positionals) => {
  const first = positionals[0];
  const isAction = LOCK_ACTIONS.includes(first);
  if (!isAction) return { action: 'acquire', files: positionals };
  const isRelease = first === 'unlock';
  return { action: isRelease ? 'release' : first, files: positionals.slice(1) };
};

const rejectTraversal = (db, file, isCli, cwd) => {
  const target = checkLockTarget(db, file, cwd);
  if (!target.error) return null;
  if (isCli) process.stderr.write(`\x1b[31m✕ ${file} refused: ${target.message}\x1b[0m\n`);
  return { error: target.error };
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

const SINGLE_PATH_ACTIONS = ['check', 'status', 'renew'];

// check, status and renew answer for one file; an extra path is refused, never silently dropped.
const runSinglePathAction = (db, action, files, flags, isCli, cwd) => {
  const isExtra = files.length > 1;
  if (isExtra) {
    if (isCli) process.stderr.write(`\x1b[31m✕ lock ${action} takes one path, got ${files.length}: run it once per path\x1b[0m\n`);
    if (isCli) process.exitCode = 1;
    return { error: 'one_path_only' };
  }
  const traversal = rejectTraversal(db, files[0], isCli, cwd);
  const isRejected = Boolean(traversal);
  if (isRejected) return traversal;
  return runFileAction(db, action, files[0], flags, isCli, cwd);
};

const acquireOne = (db, file, agentId, flags, cwd) => {
  const target = checkLockTarget(db, file, cwd);
  if (target.error) return { error: target.error, message: target.message };
  const listLike = checkPathList(file, cwd);
  if (listLike) return listLike;
  const res = requestFileLock(db, file, agentId, {
    purpose: flags.purpose,
    priority: flags.priority,
    pid: flags.pid ? Number(flags.pid) : 0,
    requireExisting: !flags.allowNew,
    cwd
  });
  return target.repo === undefined ? res : { ...res, repo: target.repo };
};

// One line per path in the order given, the renewal note once when anything was granted; a refused
// path sets exit 1 (queued is not a refusal). --json prints the whole outcome instead.
const writeAcquireReport = (files, results, summary, outcome, isJson) => {
  const hasRefusal = summary.refused > 0;
  if (hasRefusal) process.exitCode = 1;
  if (isJson) {
    process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
    return;
  }
  files.forEach((file, i) => process.stdout.write(`${lockLine(file, results[i])}\n`));
  const hasGrant = summary.granted > 0;
  if (hasGrant) process.stdout.write(`${RENEWAL_NOTE}\n`);
};

// A single path returns the plain result; several return { results: [{ file, ...result }], summary }.
const runAcquire = (db, requested, flags, isCli, cwd) => {
  const files = [...new Set(requested)];
  const identity = resolveAgentIdentity(flags.as);
  writeIdentityHint(identity, isCli, flags.isJson);
  const results = files.map((file) => acquireOne(db, file, identity.id, flags, cwd));
  const summary = summarize(results);
  const isSingle = files.length === 1;
  const outcome = isSingle ? results[0] : { results: files.map((file, i) => ({ file, ...results[i] })), summary };
  if (isCli) writeAcquireReport(files, results, summary, outcome, flags.isJson);
  return outcome;
};

export const handleLockCommand = (db, nonFlagPositional, flags, isCli, cwd = process.cwd()) => {
  const isLockHelp = flags.help || nonFlagPositional.includes('--help') || nonFlagPositional.includes('-h') || nonFlagPositional.includes('help');
  if (isLockHelp) {
    if (isCli) process.stdout.write(formatLockHelpCard());
    return { help: true, actions: ['acquire', 'release', 'check', 'check-staged', 'status', 'list', 'renew'] };
  }

  const { action, files } = parseLockAction(nonFlagPositional);
  const isList = action === 'list';
  if (isList) return runLockList(db, flags, isCli);
  const isCheckStaged = action === 'check-staged';
  if (isCheckStaged) return runLockCheckStaged(nonFlagPositional.slice(1), flags, isCli, cwd);

  const hasFiles = files.length > 0;
  if (!hasFiles) {
    if (isCli) process.stderr.write('\x1b[31m✕ File path required: chemx team lock [acquire|release|check|status|renew] <filePath>... (or: chemx team lock list)\x1b[0m\n');
    return { error: 'filePath required' };
  }

  const isRelease = action === 'release';
  if (isRelease) return handleUnlockCommand(db, files, flags, isCli, cwd);
  const isAcquire = action === 'acquire';
  if (isAcquire) return runAcquire(db, files, flags, isCli, cwd);
  return runSinglePathAction(db, action, files, flags, isCli, cwd);
};

const releaseOne = (db, file, agentId, cwd) => {
  const target = checkLockTarget(db, file, cwd);
  if (target.error) return { error: target.error, message: target.message };
  const res = releaseFileLock(db, file, agentId, { cwd });
  const warning = res.success ? null : missingPathWarning(db, file, cwd);
  return warning ? { ...res, warning } : res;
};

// The line for one released path: stdout when the lease is gone or the queue left, stderr when not.
const releaseLine = (file, res, isMulti) => {
  const subject = isMulti ? ` (${file})` : '';
  const warning = res.warning ? ` ${res.warning}` : '';
  if (res.error) return { isOk: false, text: `\x1b[31m✕ ${file} refused: ${res.message}\x1b[0m` };
  if (res.dequeued) return { isOk: true, text: `\x1b[32m✔\x1b[0m Left the queue for ${file} (no lock was held)` };
  if (res.success) return { isOk: true, text: `\x1b[32m✔\x1b[0m Released lock on ${file}` };
  return { isOk: false, text: `\x1b[31m✕ Unlock failed${subject}: ${res.message ?? res.reason}${warning}\x1b[0m` };
};

const writeReleaseReport = (files, results, outcome, isJson) => {
  if (isJson) return process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
  const isMulti = files.length > 1;
  for (const [i, file] of files.entries()) {
    const line = releaseLine(file, results[i], isMulti);
    (line.isOk ? process.stdout : process.stderr).write(`${line.text}\n`);
  }
};

export const handleUnlockCommand = (db, nonFlagPositional, flags, isCli, cwd = process.cwd()) => {
  const isUnlockHelp = flags.help || nonFlagPositional.includes('--help') || nonFlagPositional.includes('-h') || nonFlagPositional.includes('help');
  if (isUnlockHelp) {
    if (isCli) process.stdout.write(formatLockHelpCard());
    return { help: true, actions: ['release'] };
  }

  const files = [...new Set(nonFlagPositional)];
  const hasFiles = files.length > 0;
  if (!hasFiles) {
    if (isCli) process.stderr.write('\x1b[31m✕ File path required: chemx team unlock <filePath>...\x1b[0m\n');
    return { error: 'filePath required' };
  }

  const identity = resolveAgentIdentity(flags.as);
  writeIdentityHint(identity, isCli, flags.isJson);
  const results = files.map((file) => releaseOne(db, file, identity.id, cwd));
  const isSingle = files.length === 1;
  const outcome = isSingle ? results[0] : { results: files.map((file, i) => ({ file, ...results[i] })) };
  if (isCli) writeReleaseReport(files, results, outcome, flags.isJson);
  return outcome;
};
