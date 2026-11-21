/**
 * The async check queue (`chemx team check <kind>`): enqueue and return at once. Identical queued
 * jobs coalesce (the later caller joins as a requester), a running job at the same tree joins too,
 * and a green result at the same tree fingerprint within the TTL answers from cache. Nothing here
 * runs a check: the drain worker (check-drainer.js) does, one job at a time.
 */

import { withImmediateTransaction } from './team-db-transaction.js';

export const CHECK_KINDS = Object.freeze(['typecheck', 'test', 'verify', 'build']);
export const CACHE_TTL_MS = 600_000;
const DEFAULT_PRIORITY = 2;

const parseResult = (text) => {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return {};
  }
};

export const rowToJob = (row) => (row ? { ...row, result: parseResult(row.result) } : null);

const addRequester = (db, jobId, agentId, taskId) => {
  db.prepare('INSERT OR IGNORE INTO check_requesters (job_id, agent_id, task_id) VALUES (?, ?, ?)').run(jobId, agentId, taskId || null);
};

const queuePosition = (db, jobId) => {
  const ahead = db.prepare("SELECT COUNT(*) AS n FROM check_jobs WHERE id < ? AND status IN ('queued', 'running')").get(jobId);
  return ahead.n + 1;
};

const findCachedGreen = (db, key, fingerprint, now, ttlMs) => {
  const row = db.prepare("SELECT * FROM check_jobs WHERE kind = ? AND cwd = ? AND command = ? AND tree_fp = ? AND status = 'done' AND finished_at >= ? ORDER BY id DESC LIMIT 1").get(key.kind, key.cwd, key.command, fingerprint, now - ttlMs);
  const job = rowToJob(row);
  const isFreshGreen = Boolean(job) && job.result.status === 'pass' && job.result.stale !== true;
  return isFreshGreen ? job : null;
};

const findRunning = (db, key, fingerprint) => db.prepare("SELECT * FROM check_jobs WHERE kind = ? AND cwd = ? AND command = ? AND status = 'running' AND tree_fp = ? ORDER BY id LIMIT 1").get(key.kind, key.cwd, key.command, fingerprint);

// The deep fingerprint (submodule working trees too) costs hundreds of ms in a big monorepo, so it is read only when a
// cache or join candidate exists, before the write transaction opens, and once. Without a deepFingerprint the caller
// vouches that its fingerprint is complete. A candidate the worker never deep-stamped is never trusted.
const deepVerifier = (db, key, fingerprint, now, ttlMs, deepFingerprint) => {
  const isOff = typeof deepFingerprint !== 'function';
  const hasCandidate = fingerprint !== '' && (Boolean(findRunning(db, key, fingerprint)) || Boolean(findCachedGreen(db, key, fingerprint, now, ttlMs)));
  const current = !isOff && hasCandidate ? deepFingerprint() : null;
  return (candidate) => isOff || (Boolean(current) && candidate.tree_fp_deep === current);
};

/**
 * Enqueues one check inside a single immediate transaction and returns
 * { action: 'queued' | 'coalesced' | 'joined' | 'cached', id, position, job }.
 * `fingerprint` is the shallow tree fingerprint; the optional `deepFingerprint` thunk verifies a cache or join candidate.
 */
export const enqueueCheck = (db, { kind, cwd, requester, taskId = null, fingerprint = '', deepFingerprint = null, now = Date.now(), ttlMs = CACHE_TTL_MS, command = kind }) => {
  const key = { kind, cwd, command };
  const isVerified = deepVerifier(db, key, fingerprint, now, ttlMs, deepFingerprint);
  return withImmediateTransaction(db, () => {
    const queued = db.prepare("SELECT * FROM check_jobs WHERE kind = ? AND cwd = ? AND command = ? AND status = 'queued' ORDER BY id LIMIT 1").get(kind, cwd, command);
    if (queued) {
      addRequester(db, queued.id, requester, taskId);
      return { action: 'coalesced', id: queued.id, position: queuePosition(db, queued.id), job: rowToJob(queued) };
    }
    const running = fingerprint === '' ? null : findRunning(db, key, fingerprint);
    const canJoin = Boolean(running) && isVerified(running);
    if (canJoin) {
      addRequester(db, running.id, requester, taskId);
      return { action: 'joined', id: running.id, position: 1, job: rowToJob(running) };
    }
    const cached = fingerprint ? findCachedGreen(db, key, fingerprint, now, ttlMs) : null;
    const canUseCache = Boolean(cached) && isVerified(cached);
    if (canUseCache) return { action: 'cached', id: cached.id, position: 0, job: cached };
    const info = db.prepare('INSERT INTO check_jobs (kind, cwd, command, tree_fp, run_at, priority, requested_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(kind, cwd, command, fingerprint, now, DEFAULT_PRIORITY, requester, now);
    const id = Number(info.lastInsertRowid);
    addRequester(db, id, requester, taskId);
    return { action: 'queued', id, position: queuePosition(db, id), job: rowToJob(db.prepare('SELECT * FROM check_jobs WHERE id = ?').get(id)) };
  });
};

export const getCheck = (db, id) => {
  const job = rowToJob(db.prepare('SELECT * FROM check_jobs WHERE id = ?').get(id));
  if (!job) return null;
  const requesters = db.prepare('SELECT agent_id, task_id, notified_at FROM check_requesters WHERE job_id = ? ORDER BY agent_id').all(id);
  return { ...job, requesters };
};

export const listChecks = (db, { limit = 20, status = null } = {}) => {
  const rows = status
    ? db.prepare('SELECT * FROM check_jobs WHERE status = ? ORDER BY id DESC LIMIT ?').all(status, limit)
    : db.prepare('SELECT * FROM check_jobs ORDER BY id DESC LIMIT ?').all(limit);
  return rows.map(rowToJob);
};

/**
 * Cancels a queued or running job and returns { ok, wasRunning, job }. A running job's worker notices the row
 * left 'running' (it polls) and aborts the executor, which kills the check's process tree; its result is discarded.
 * The row carries who cancelled, so the requesters can be told (check-delivery.js).
 */
export const cancelCheck = (db, id, { now = Date.now(), by = null } = {}) => withImmediateTransaction(db, () => {
  const row = db.prepare('SELECT * FROM check_jobs WHERE id = ?').get(id);
  if (!row) return { ok: false, reason: `No check #${id}.` };
  const isOpen = row.status === 'queued' || row.status === 'running';
  if (!isOpen) return { ok: false, reason: `Check #${id} is already ${row.status}.` };
  const result = JSON.stringify({ status: 'cancelled', cancelledBy: by, summaryLine: by ? `cancelled by ${by}` : 'cancelled' });
  db.prepare("UPDATE check_jobs SET status = 'cancelled', finished_at = ?, result = ? WHERE id = ?").run(now, result, id);
  return { ok: true, wasRunning: row.status === 'running', job: rowToJob({ ...row, status: 'cancelled', result }) };
});

export const countByStatus = (db) => {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM check_jobs GROUP BY status').all();
  return Object.fromEntries(rows.map((row) => [row.status, row.n]));
};
