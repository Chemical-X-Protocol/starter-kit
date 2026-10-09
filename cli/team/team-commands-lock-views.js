/**
 * Chemical X Protocol: read and renew actions for `chemx team lock`.
 *   check <file>   read-only edit decision (findForeignLease); exit 0 clear, 2 locked
 *   status <file>  lease plus waiters in this project's db
 *   list           every live lease (unexpired, holder alive)
 *   renew <file>   extend the caller's own lease by one TTL; refused for anyone else
 */
import { findForeignLease } from '../edit-locks.js';
import { resolveSafePath } from '../path-scope.js';
import { getFileLockStatus, listActiveLeases, renewFileLock } from './team-db-locks.js';

const EXIT_LOCKED = 2;
const EXIT_ERROR = 1;

const isoTime = (ms) => new Date(Number(ms)).toISOString();

const minutesLeft = (ms, now) => Math.max(0, Math.round((Number(ms) - now) / 60000));

const purposeNote = (purpose) => (purpose ? ` (${purpose})` : '');

const writeJson = (res) => process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);

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
  const res = { file, clear: !isLocked, ...lockedRes, ...(held ?? {}) };
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
  const res = { file, ...status };
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
  waiters.forEach((w, i) => process.stdout.write(`  ${i + 1}. ${w.agent_id} waiting\n`));
  return res;
};

export const runLockList = (db, flags, isCli) => {
  const now = Date.now();
  const leases = listActiveLeases(db, now);
  const res = { leases: leases.map(({ file_path, locked_by, purpose, expires_at, pid }) => ({ file_path, locked_by, purpose, expires_at, pid })) };
  const isQuiet = !isCli;
  if (isQuiet) return res;
  if (flags.isJson) {
    writeJson(res);
    return res;
  }
  const isEmpty = leases.length === 0;
  if (isEmpty) process.stdout.write('No live locks.\n');
  for (const lease of leases) {
    process.stdout.write(`${lease.file_path}  ${lease.locked_by}${purposeNote(lease.purpose)}  until ${isoTime(lease.expires_at)} (${minutesLeft(lease.expires_at, now)}m)\n`);
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
