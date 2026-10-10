/**
 * Chemical X Protocol: read and renew actions for `chemx team lock`.
 *   check <file>   read-only edit decision (findForeignLease); exit 0 clear, 2 locked
 *   status <file>  lease plus waiters in this project's db
 *   list           every live lease (unexpired, holder alive)
 *   renew <file>   extend the caller's own lease by one TTL; refused for anyone else
 */
import { findForeignLease } from '../edit-locks.js';
import { resolveSafePath } from '../path-scope.js';
import { getFileLockStatus, listActiveLeases, renewFileLock, adviseMissingPath } from './team-db-locks.js';
import { contentionOf } from './lease-cap.js';
import { clockTime } from './lease-lapse.js';
import { describeContention } from './lease-contention.js';

const EXIT_LOCKED = 2;
const EXIT_ERROR = 1;

const isoTime = (ms) => new Date(Number(ms)).toISOString();

const minutesLeft = (ms, now) => Math.max(0, Math.round((Number(ms) - now) / 60000));

const purposeNote = (purpose) => (purpose ? ` (${purpose})` : '');

const writeJson = (res) => process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);

// Non-blocking (#4544): a check, status or release on a path that does not exist still runs; this
// only says so, and names the path that does exist when there is one. Nothing is refused or changed.
export const missingPathWarning = (db, file, cwd) => {
  const advice = adviseMissingPath(db, file, { cwd });
  if (!advice) return null;
  const hint = advice.suggestion ? ` Did you mean ${advice.suggestion}?` : '';
  return `warning: ${file} does not exist (looked for ${advice.absPath}).${hint}`;
};

const warnMissing = (db, file, cwd, isCli) => {
  const warning = missingPathWarning(db, file, cwd);
  const hasWarning = Boolean(warning);
  const shouldPrint = hasWarning && isCli;
  if (shouldPrint) process.stderr.write(`\x1b[33m${warning}\x1b[0m\n`);
  return hasWarning ? { warning } : {};
};

const setExit = (isCli, code) => {
  if (isCli) process.exitCode = code;
};

const describeHeld = (status, agentId) => {
  const lease = status?.lease;
  const isOwn = Boolean(lease) && lease.locked_by === agentId;
  return isOwn ? { heldByYou: true, expires_at: lease.expires_at, purpose: lease.purpose || '' } : null;
};

export const runLockCheck = (db, file, agentId, flags, isCli, cwd) => {
  const absPath = resolveSafePath(file, cwd);
  const lease = findForeignLease(cwd, absPath, agentId);
  const isLocked = Boolean(lease);
  const held = isLocked ? null : describeHeld(getFileLockStatus(db, file, { cwd }), agentId);
  const lockedRes = isLocked ? { locked_by: lease.lockedBy, purpose: lease.purpose, expires_at: lease.expiresAt } : {};
  const warned = warnMissing(db, file, cwd, isCli && !flags.isJson);
  const res = { file, clear: !isLocked, ...lockedRes, ...(held ?? {}), ...warned };
  setExit(isCli, isLocked ? EXIT_LOCKED : 0);
  const isQuiet = !isCli;
  if (isQuiet) return res;
  if (flags.isJson) {
    writeJson(res);
  } else if (isLocked) {
    process.stdout.write(`locked by ${lease.lockedBy}${purposeNote(lease.purpose)} until ${isoTime(lease.expiresAt)}\n`);
  } else {
    const ownNote = held ? ` (you hold it until ${isoTime(held.expires_at)})` : '';
    process.stdout.write(`clear${ownNote}\n`);
  }
  return res;
};

export const runLockStatus = (db, file, flags, isCli, cwd) => {
  const status = getFileLockStatus(db, file, { cwd });
  const contention = status?.lease ? contentionOf(db, status.lease, Date.now()) : null;
  const warned = warnMissing(db, file, cwd, isCli && !flags.isJson);
  const res = { file, ...warned, ...status, ...(contention ? { renewalCapAt: contention.capAt, renewalCapped: contention.isCapped } : {}) };
  const isQuiet = !isCli;
  if (isQuiet) return res;
  if (flags.isJson) {
    writeJson(res);
    return res;
  }
  const lease = status?.lease;
  const hasLease = Boolean(lease);
  const head = hasLease
    ? `${lease.file_path}: locked by ${lease.locked_by}${purposeNote(lease.purpose)} until ${isoTime(lease.expires_at)}`
    : `${file}: unlocked`;
  process.stdout.write(`${head}\n`);
  const waiters = status?.waiters ?? [];
  waiters.forEach((w, i) => process.stdout.write(`  ${i + 1}. ${w.agent_id} waiting since ${clockTime(w.requested_at)}\n`));
  const isContested = hasLease && waiters.length > 0;
  if (isContested) process.stdout.write(`  ${describeContention(contentionOf(db, lease, Date.now()))}\n`);
  return res;
};

const contestedNote = (contention) => (contention.waiters.length > 0 ? `  ${describeContention(contention)}` : '');

export const runLockList = (db, flags, isCli) => {
  const now = Date.now();
  const leases = listActiveLeases(db, now);
  const contested = new Map(leases.map((lease) => [lease.file_path, contentionOf(db, lease, now)]));
  const contentionFields = ({ waiters, capAt, isCapped }) => (waiters.length > 0 ? { waiters: waiters.map((w) => w.agent_id), renewalCapAt: capAt, renewalCapped: isCapped } : {});
  const res = { leases: leases.map(({ file_path, locked_by, purpose, expires_at, pid }) => ({ file_path, locked_by, purpose, expires_at, pid, ...contentionFields(contested.get(file_path)) })) };
  const isQuiet = !isCli;
  if (isQuiet) return res;
  if (flags.isJson) {
    writeJson(res);
    return res;
  }
  const isEmpty = leases.length === 0;
  if (isEmpty) process.stdout.write('No live locks.\n');
  for (const lease of leases) {
    process.stdout.write(`${lease.file_path}  ${lease.locked_by}${purposeNote(lease.purpose)}  until ${isoTime(lease.expires_at)} (${minutesLeft(lease.expires_at, now)}m)${contestedNote(contested.get(lease.file_path))}\n`);
  }
  return res;
};

const RENEW_REFUSALS = {
  no_lease: 'no lease to renew; acquire it with chemx team lock acquire',
  not_holder: 'held by another agent; only the holder can renew',
  expired: 'your lease expired; acquire it again with chemx team lock acquire'
};

export const runLockRenew = (db, file, agentId, flags, isCli, cwd) => {
  const res = renewFileLock(db, file, agentId, { cwd });
  const isRenewed = Boolean(res.renewed);
  setExit(isCli, isRenewed ? 0 : EXIT_ERROR);
  const isQuiet = !isCli;
  if (isQuiet) return res;
  if (flags.isJson) {
    writeJson(res);
    return res;
  }
  if (isRenewed) {
    process.stdout.write(`\x1b[32m✔\x1b[0m Renewed lock on ${res.file_path} until ${isoTime(res.expires_at)}\n`);
    return res;
  }
  const holderNote = res.lease?.locked_by ? ` (held by ${res.lease.locked_by})` : '';
  process.stderr.write(`\x1b[31m✕ Renew refused: ${RENEW_REFUSALS[res.reason] ?? res.reason}${holderNote}\x1b[0m\n`);
  return res;
};
